import { randomBytes } from "node:crypto";

import { concat, getAddress, isAddressEqual, keccak256, toHex, type Address, type Hex } from "viem";

import type { DepositReader, DepositTerms, QuoteSigner } from "../chain/escrow.ts";
import { DEPOSIT_CHAINS } from "../chains.ts";
import { withTransaction, type Db } from "../db/pool.ts";
import { AppError } from "../lib/errors.ts";
import type { User } from "../users/service.ts";

export interface DepositPolicy {
  refundDelayMinutes: number;
  payee: Address;
}

/** uint values as decimal strings so they survive JSON; the wallet converts them back to bigint. */
export interface DepositView {
  id: string;
  quoteId: string;
  chainId: number;
  escrow: Address;
  status: "awaiting_deposit" | "escrowed" | "released" | "refunded";
  terms: {
    intentId: Hex;
    depositor: Address;
    token: Address;
    amount: string;
    payee: Address;
    recipientCommitment: Hex;
    quoteExpiry: string;
    refundAfter: string;
  };
  signature: Hex;
  txHash: Hex | null;
  escrowedAt: string | null;
}

interface DepositRow {
  id: string;
  quote_id: string;
  chain_id: number;
  escrow: Address;
  intent_id: Hex;
  depositor: Address;
  token: Address;
  amount_units: string;
  payee: Address;
  recipient_commitment: Hex;
  quote_expiry: Date;
  refund_after: Date;
  signature: Hex;
  status: DepositView["status"];
  tx_hash: Hex | null;
  escrowed_at: Date | null;
}

const COLUMNS = `id, quote_id, chain_id, escrow, intent_id, depositor, token, amount_units, payee,
  recipient_commitment, quote_expiry, refund_after, signature, status, tx_hash, escrowed_at`;

const seconds = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));

function view(row: DepositRow): DepositView {
  return {
    id: row.id,
    quoteId: row.quote_id,
    chainId: row.chain_id,
    escrow: row.escrow,
    status: row.status,
    terms: {
      intentId: row.intent_id,
      depositor: row.depositor,
      token: row.token,
      amount: row.amount_units,
      payee: row.payee,
      recipientCommitment: row.recipient_commitment,
      quoteExpiry: seconds(row.quote_expiry).toString(),
      refundAfter: seconds(row.refund_after).toString(),
    },
    signature: row.signature,
    txHash: row.tx_hash,
    escrowedAt: row.escrowed_at?.toISOString() ?? null,
  };
}

export class DepositService {
  readonly #db: Db;
  readonly #signer: QuoteSigner | null;
  readonly #reader: DepositReader;
  readonly #policy: DepositPolicy | null;
  readonly #now: () => Date;

  constructor(
    db: Db,
    signer: QuoteSigner | null,
    reader: DepositReader,
    policy: DepositPolicy | null,
    now = () => new Date(),
  ) {
    this.#db = db;
    this.#signer = signer;
    this.#reader = reader;
    this.#policy = policy;
    this.#now = now;
  }

  async #row(user: User, where: string, value: string): Promise<DepositRow | null> {
    const { rows } = await this.#db.query<DepositRow>(
      `select ${COLUMNS} from deposits where ${where} = $1 and user_id = $2`,
      [value, user.id],
    );
    return rows[0] ?? null;
  }

  async get(user: User, id: string): Promise<DepositView | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = await this.#row(user, "id", id);
    return row ? view(row) : null;
  }

  /** Signs DepositTerms for one of the user's quotes. Idempotent per quote. */
  async prepare(user: User, quoteId: string): Promise<DepositView> {
    if (!this.#signer || !this.#policy) {
      throw new AppError("provider-unavailable", "Deposits aren't enabled on this server yet.");
    }
    if (!/^[0-9a-f-]{36}$/i.test(quoteId)) throw new AppError("not-found", "Quote not found.");

    const existing = await this.#row(user, "quote_id", quoteId);
    if (existing) return view(existing);

    const { rows } = await this.#db.query<{
      chain_id: number;
      token: Address;
      amount_units: string;
      expires_at: Date;
      bank_status: string;
      usable_from: Date;
      account_fingerprint: Buffer;
    }>(
      `select q.chain_id, q.token, q.amount_units, q.expires_at,
              b.status as bank_status, b.usable_from, b.account_fingerprint
       from quotes q join bank_accounts b on b.id = q.bank_account_id
       where q.id = $1 and q.user_id = $2`,
      [quoteId, user.id],
    );
    const quote = rows[0];
    if (!quote) throw new AppError("not-found", "Quote not found.");

    const now = this.#now();
    if (quote.expires_at.getTime() <= now.getTime()) {
      throw new AppError("quote-expired", "This quote expired. Get a new one to continue.");
    }
    if (quote.bank_status !== "active" || quote.usable_from.getTime() > now.getTime()) {
      throw new AppError("quote-expired", "Your payout account changed since this quote. Get a new quote.");
    }
    if (!user.walletAddress) throw new AppError("account-incomplete", "Your wallet is still being set up.");

    const chain = DEPOSIT_CHAINS[quote.chain_id];
    if (!chain) throw new AppError("validation", "That network isn't supported.");

    const intentId = toHex(randomBytes(32));
    const terms: DepositTerms = {
      intentId,
      depositor: getAddress(user.walletAddress),
      token: getAddress(quote.token),
      amount: BigInt(quote.amount_units),
      payee: getAddress(this.#policy.payee),
      // Binds the deposit to the bank account without revealing it: the fingerprint is already a keyed HMAC.
      recipientCommitment: keccak256(concat([toHex(quote.account_fingerprint), intentId])),
      quoteExpiry: seconds(quote.expires_at),
      refundAfter: seconds(quote.expires_at) + BigInt(this.#policy.refundDelayMinutes * 60),
    };
    const signature = await this.#signer.sign(chain.id, chain.escrow, terms);

    const inserted = await this.#db.query<DepositRow>(
      `insert into deposits
         (user_id, quote_id, chain_id, escrow, intent_id, depositor, token, amount_units, payee,
          recipient_commitment, quote_expiry, refund_after, signature)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11), to_timestamp($12), $13)
       on conflict (quote_id) do nothing
       returning ${COLUMNS}`,
      [
        user.id,
        quoteId,
        chain.id,
        chain.escrow,
        terms.intentId,
        terms.depositor,
        terms.token,
        terms.amount.toString(),
        terms.payee,
        terms.recipientCommitment,
        terms.quoteExpiry.toString(),
        terms.refundAfter.toString(),
        signature,
      ],
    );
    // A concurrent request for the same quote won the insert; return its terms.
    const row = inserted.rows[0] ?? (await this.#row(user, "quote_id", quoteId));
    return view(row!);
  }

  /** Marks the deposit escrowed once its transaction emitted the matching `Deposited` event. */
  async confirm(user: User, id: string, txHash: Hex): Promise<DepositView> {
    const row = id.match(/^[0-9a-f-]{36}$/i) ? await this.#row(user, "id", id) : null;
    if (!row) throw new AppError("not-found", "Deposit not found.");
    if (row.status !== "awaiting_deposit") {
      if (row.tx_hash?.toLowerCase() === txHash.toLowerCase()) return view(row);
      throw new AppError("validation", "This deposit was already confirmed with another transaction.");
    }

    const receipt = await this.#reader.receipt(row.chain_id, row.escrow, txHash);
    if (receipt.status === "pending") {
      throw new AppError("chain-pending", "The deposit transaction isn't confirmed yet. Try again in a moment.");
    }
    if (receipt.status === "reverted") throw new AppError("validation", "The deposit transaction failed onchain.");

    const event = receipt.events.find((e) => e.intentId.toLowerCase() === row.intent_id);
    const matches =
      event &&
      isAddressEqual(event.depositor, row.depositor) &&
      isAddressEqual(event.token, row.token) &&
      isAddressEqual(event.payee, row.payee) &&
      event.amount === BigInt(row.amount_units) &&
      event.recipientCommitment.toLowerCase() === row.recipient_commitment.toLowerCase() &&
      event.refundAfter === seconds(row.refund_after);
    if (!matches) throw new AppError("validation", "That transaction isn't the deposit for this cash-out.");

    const updated = await withTransaction(this.#db, async (tx) => {
      const result = await tx.query<DepositRow>(
        `update deposits set status = 'escrowed', tx_hash = $2, block_number = $3, escrowed_at = $4
         where id = $1 and status = 'awaiting_deposit'
         returning ${COLUMNS}`,
        [row.id, txHash, receipt.blockNumber.toString(), this.#now()],
      );
      if (!result.rows[0]) return null;
      await tx.query(`insert into audit_events (user_id, kind, data) values ($1, 'deposit.escrowed', $2)`, [
        user.id,
        { depositId: row.id, intentId: row.intent_id, chainId: row.chain_id, txHash, amount: row.amount_units },
      ]);
      // Enqueued with the status change, so every escrowed deposit gets exactly one payout run.
      await tx.query(`select graphile_worker.add_job('payout_start', $1::json)`, [JSON.stringify({ depositId: row.id })]);
      return result.rows[0];
    });
    return view(updated ?? (await this.#row(user, "id", row.id))!);
  }
}
