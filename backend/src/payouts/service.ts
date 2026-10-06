import { keccak256, toBytes, type Address, type Hex } from "viem";

import { OUTCOME, type EscrowSettler } from "../chain/escrow.ts";
import { withTransaction, type Db, type Queryable } from "../db/pool.ts";
import type { FieldCipher } from "../lib/crypto.ts";
import { PayoutRejected, type PayoutOrder, type PayoutProvider, type PayoutStatus } from "./provider.ts";

/** How long an attestation stays valid onchain after signing. */
const ATTESTATION_TTL_SECONDS = 15 * 60;

interface PayoutRow {
  id: string;
  deposit_id: string;
  provider: string;
  /** Null only when the provider refused the order, which leaves the payout failed. */
  provider_order_id: string | null;
  status: PayoutStatus;
  created_at: Date;
  settle_tx_hash: Hex | null;
  user_id: string;
  chain_id: number;
  escrow: Address;
  intent_id: Hex;
  deposit_status: string;
}

const PAYOUT_SELECT = `
  select p.id, p.deposit_id, p.provider, p.provider_order_id, p.status, p.created_at, p.settle_tx_hash,
         d.user_id, d.chain_id, d.escrow, d.intent_id, d.status as deposit_status
  from payouts p join deposits d on d.id = p.deposit_id`;

export type PollResult = { done: false } | { done: true; status: Exclude<PayoutStatus, "pending"> };
export type SettleResult = { done: false } | { done: true; escrow: "released" | "refunded" };

/**
 * Runs the fiat leg after a confirmed deposit and settles the escrow from its outcome.
 * Every step is safe to retry: the worker may run any of them more than once.
 */
export class PayoutService {
  readonly #db: Db;
  readonly #provider: PayoutProvider;
  readonly #settler: EscrowSettler | null;
  readonly #now: () => Date;
  readonly #cipher: FieldCipher | null;

  /** `cipher` decrypts the recipient account for providers that pay a real bank. */
  constructor(
    db: Db,
    provider: PayoutProvider,
    settler: EscrowSettler | null,
    now = () => new Date(),
    cipher: FieldCipher | null = null,
  ) {
    this.#db = db;
    this.#provider = provider;
    this.#settler = settler;
    this.#now = now;
    this.#cipher = cipher;
  }

  async #payout(payoutId: string): Promise<PayoutRow> {
    const { rows } = await this.#db.query<PayoutRow>(`${PAYOUT_SELECT} where p.id = $1`, [payoutId]);
    if (!rows[0]) throw new Error(`payout ${payoutId} not found`);
    return rows[0];
  }

  /** Creates the provider order for an escrowed deposit; returns the payout id. */
  async start(depositId: string): Promise<string> {
    const existing = await this.#db.query<{ id: string }>(`select id from payouts where deposit_id = $1`, [depositId]);
    if (existing.rows[0]) return existing.rows[0].id;

    const { rows } = await this.#db.query<{
      status: string;
      user_id: string;
      payout_units: string;
      net_fiat_minor: string;
      rate: string;
      provider_ids: string[];
      institution_code: string;
      account_name: string;
      account_number_ciphertext: Buffer;
    }>(
      `select d.status, d.user_id, q.payout_units, q.net_fiat_minor, q.rate, q.provider_ids,
              b.institution_code, b.account_name, b.account_number_ciphertext
       from deposits d
       join quotes q on q.id = d.quote_id
       join bank_accounts b on b.id = q.bank_account_id
       where d.id = $1`,
      [depositId],
    );
    const deposit = rows[0];
    if (!deposit) throw new Error(`deposit ${depositId} not found`);
    if (deposit.status !== "escrowed") throw new Error(`deposit ${depositId} is ${deposit.status}, not escrowed`);

    // A crash between create and insert can leave an orphan provider order. That is safe only
    // because orders pay out after we fund them, and nothing funds an order we have no row for.
    let order: PayoutOrder | null = null;
    let rejection: string | null = null;
    try {
      order = await this.#provider.create({
        reference: depositId,
        amountUnits: BigInt(deposit.payout_units),
        rate: deposit.rate,
        providerIds: deposit.provider_ids,
        // The quote's account, not today's: the escrow commitment was made to this one.
        recipient: this.#cipher
          ? {
              institution: deposit.institution_code,
              accountIdentifier: this.#cipher.decrypt(deposit.account_number_ciphertext),
              accountName: deposit.account_name,
            }
          : null,
      });
    } catch (error) {
      if (!(error instanceof PayoutRejected)) throw error;
      rejection = error.message;
    }

    const now = this.#now();
    return withTransaction(this.#db, async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `insert into payouts
           (deposit_id, provider, provider_order_id, amount_units, fiat_minor, status, failure_reason, completed_at,
            funding_address, funding_amount_units, funding_valid_until, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         on conflict (deposit_id) do nothing
         returning id`,
        [
          depositId,
          this.#provider.name,
          order?.orderId ?? null,
          deposit.payout_units,
          deposit.net_fiat_minor,
          rejection ? "failed" : "pending",
          rejection,
          rejection ? now : null,
          order?.funding?.address ?? null,
          order?.funding?.amountUnits ?? null,
          order?.funding?.validUntil ?? null,
          now,
        ],
      );
      const payoutId = inserted.rows[0]?.id;
      if (!payoutId) {
        return (await tx.query<{ id: string }>(`select id from payouts where deposit_id = $1`, [depositId])).rows[0]!.id;
      }
      await tx.query(`insert into audit_events (user_id, kind, data) values ($1, $2, $3)`, [
        deposit.user_id,
        rejection ? "payout.failed" : "payout.created",
        {
          payoutId,
          depositId,
          provider: this.#provider.name,
          orderId: order?.orderId ?? null,
          ...(rejection ? { reason: rejection } : {}),
          ...(order?.funding
            ? {
                fundingAddress: order.funding.address,
                fundingAmountUnits: order.funding.amountUnits.toString(),
                fundingValidUntil: order.funding.validUntil.toISOString(),
              }
            : {}),
        },
      ]);
      return payoutId;
    });
  }

  async poll(payoutId: string): Promise<PollResult> {
    const payout = await this.#payout(payoutId);
    if (payout.status !== "pending") return { done: true, status: payout.status };

    const status = await this.#provider.status({ orderId: payout.provider_order_id!, createdAt: payout.created_at });
    if (status === "pending") return { done: false };

    await withTransaction(this.#db, (tx) => this.#complete(tx, payout, status));
    return { done: true, status };
  }

  /** Moves a pending payout to its final status once; the audit event is written only by the winner. */
  async #complete(tx: Queryable, payout: PayoutRow, status: Exclude<PayoutStatus, "pending">): Promise<boolean> {
    const updated = await tx.query(
      `update payouts set status = $2, completed_at = $3, updated_at = $3 where id = $1 and status = 'pending'`,
      [payout.id, status, this.#now()],
    );
    if (!updated.rowCount) return false;
    await tx.query(`insert into audit_events (user_id, kind, data) values ($1, $2, $3)`, [
      payout.user_id,
      `payout.${status}`,
      { payoutId: payout.id, depositId: payout.deposit_id, provider: payout.provider, orderId: payout.provider_order_id },
    ]);
    return true;
  }

  /**
   * Records a verified provider webhook (once per delivery body) and, for a final outcome on a
   * pending payout, completes it and queues the escrow settlement.
   */
  async recordProviderEvent(input: {
    provider: string;
    event: string;
    orderId: string | null;
    status: string | null;
    bodySha256: string;
    data: unknown;
    outcome: Exclude<PayoutStatus, "pending"> | null;
  }): Promise<{ duplicate: boolean; payoutId: string | null; completed: boolean }> {
    return withTransaction(this.#db, async (tx) => {
      const payouts = input.orderId
        ? await tx.query<{ id: string }>(`select id from payouts where provider = $1 and provider_order_id = $2`, [
            input.provider,
            input.orderId,
          ])
        : { rows: [] };
      const payoutId = payouts.rows[0]?.id ?? null;

      const inserted = await tx.query(
        `insert into provider_events (provider, event, order_id, status, body_sha256, data, payout_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (body_sha256) do nothing`,
        [input.provider, input.event, input.orderId, input.status, input.bodySha256, input.data, payoutId],
      );
      if (!inserted.rowCount) return { duplicate: true, payoutId, completed: false };
      if (!payoutId || !input.outcome) return { duplicate: false, payoutId, completed: false };

      const { rows } = await tx.query<PayoutRow>(`${PAYOUT_SELECT} where p.id = $1 for update of p`, [payoutId]);
      const completed = await this.#complete(tx, rows[0]!, input.outcome);
      if (completed) {
        await tx.query(`select graphile_worker.add_job('escrow_settle', $1::json, job_key := $2)`, [
          JSON.stringify({ payoutId }),
          `settle:${payoutId}`,
        ]);
      }
      return { duplicate: false, payoutId, completed };
    });
  }

  /**
   * Releases the escrow to the payee after a successful payout, or refunds the depositor after a
   * failed one. Reads the escrow first so a retry never submits twice.
   */
  async settle(payoutId: string): Promise<SettleResult> {
    if (!this.#settler) throw new Error("No attestor configured (ATTESTOR_PRIVATE_KEY)");
    const payout = await this.#payout(payoutId);
    if (payout.status === "pending") throw new Error(`payout ${payoutId} has no outcome yet`);
    if (payout.deposit_status === "released" || payout.deposit_status === "refunded") {
      return { done: true, escrow: payout.deposit_status };
    }

    const onchain = await this.#settler.escrowStatus(payout.chain_id, payout.escrow, payout.intent_id);
    if (onchain === "released" || onchain === "refunded") {
      await this.#recordSettlement(payout, onchain);
      return { done: true, escrow: onchain };
    }
    if (onchain !== "escrowed") throw new Error(`escrow for ${payout.intent_id} is ${onchain}`);

    if (payout.settle_tx_hash) {
      const receipt = await this.#settler.receipt(payout.chain_id, payout.settle_tx_hash);
      if (receipt.status === "pending") return { done: false };
      if (receipt.status === "success") {
        // The receipt is final but the read above can trail it; check again on the next run.
        return { done: false };
      }
      // Reverted (e.g. the attestation expired before inclusion): clear it and submit afresh.
      await this.#db.query(`update payouts set settle_tx_hash = null, updated_at = now() where id = $1`, [payoutId]);
    }

    const outcome = payout.status === "succeeded" ? OUTCOME.PAYOUT_SUCCEEDED : OUTCOME.PAYOUT_FAILED;
    const nowSeconds = BigInt(Math.floor(this.#now().getTime() / 1000));
    const txHash = await this.#settler.submit(payout.chain_id, payout.escrow, {
      intentId: payout.intent_id,
      outcome,
      evidenceHash: keccak256(toBytes(`${payout.provider}:${payout.provider_order_id}:${payout.status}`)),
      expiry: nowSeconds + BigInt(ATTESTATION_TTL_SECONDS),
    });
    await this.#db.query(`update payouts set settle_tx_hash = $2, updated_at = now() where id = $1`, [payoutId, txHash]);
    return { done: false };
  }

  async #recordSettlement(payout: PayoutRow, escrow: "released" | "refunded") {
    await withTransaction(this.#db, async (tx) => {
      const updated = await tx.query(
        `update deposits set status = $2 where id = $1 and status = 'escrowed'`,
        [payout.deposit_id, escrow],
      );
      await tx.query(`update payouts set settled_at = coalesce(settled_at, $2), updated_at = $2 where id = $1`, [
        payout.id,
        this.#now(),
      ]);
      if (updated.rowCount) {
        await tx.query(`insert into audit_events (user_id, kind, data) values ($1, $2, $3)`, [
          payout.user_id,
          `deposit.${escrow}`,
          { depositId: payout.deposit_id, intentId: payout.intent_id, txHash: payout.settle_tx_hash },
        ]);
      }
    });
  }
}
