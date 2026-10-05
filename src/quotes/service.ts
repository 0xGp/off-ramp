import type { BankAccountService } from "../bank-accounts/service.ts";
import { DEPOSIT_CHAINS, PAYOUT_NETWORK } from "../chains.ts";
import type { Db } from "../db/pool.ts";
import { AppError } from "../lib/errors.ts";
import { bpsOf, formatUnits, NGN_DECIMALS, parseRate, parseUnits, toFiatMinor, USDC_DECIMALS } from "../lib/money.ts";
import type { RateSource } from "../paycrest/client.ts";
import type { User } from "../users/service.ts";

export interface QuotePolicy {
  ttlSeconds: number;
  feeBps: number;
  minUnits: bigint;
  maxUnits: bigint;
}

export interface QuoteView {
  id: string;
  chainId: number;
  token: string;
  /** USDC base units the user deposits. */
  amount: string;
  decimals: number;
  /** MELO's fee in USDC base units, kept from the deposit. */
  fee: string;
  feeBps: number;
  /** USDC base units MELO's treasury sends to Paycrest. */
  payoutAmount: string;
  rate: string;
  fiat: {
    currency: "NGN";
    decimals: number;
    gross: string;
    fee: string;
    /** Indicative: Paycrest settles at its rate when the order is created. */
    net: string;
  };
  payTo: { institutionName: string; accountName: string; accountLast4: string };
  issuedAt: string;
  expiresAt: string;
}

interface QuoteRow {
  id: string;
  chain_id: number;
  token: string;
  amount_units: string;
  fee_units: string;
  payout_units: string;
  fee_bps: number;
  rate: string;
  gross_fiat_minor: string;
  fee_fiat_minor: string;
  net_fiat_minor: string;
  issued_at: Date;
  expires_at: Date;
  institution_name: string;
  account_name: string;
  account_last4: string;
}

const SELECT = `
  select q.id, q.chain_id, q.token, q.amount_units, q.fee_units, q.payout_units, q.fee_bps, q.rate,
         q.gross_fiat_minor, q.fee_fiat_minor, q.net_fiat_minor, q.issued_at, q.expires_at,
         b.institution_name, b.account_name, b.account_last4
  from quotes q join bank_accounts b on b.id = q.bank_account_id`;

function view(row: QuoteRow): QuoteView {
  return {
    id: row.id,
    chainId: row.chain_id,
    token: row.token,
    amount: row.amount_units,
    decimals: USDC_DECIMALS,
    fee: row.fee_units,
    feeBps: row.fee_bps,
    payoutAmount: row.payout_units,
    rate: row.rate,
    fiat: {
      currency: "NGN",
      decimals: NGN_DECIMALS,
      gross: row.gross_fiat_minor,
      fee: row.fee_fiat_minor,
      net: row.net_fiat_minor,
    },
    payTo: { institutionName: row.institution_name, accountName: row.account_name, accountLast4: row.account_last4 },
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export class QuoteService {
  readonly #db: Db;
  readonly #rates: RateSource;
  readonly #bankAccounts: BankAccountService;
  readonly #policy: QuotePolicy;
  readonly #now: () => Date;

  constructor(db: Db, rates: RateSource, bankAccounts: BankAccountService, policy: QuotePolicy, now = () => new Date()) {
    this.#db = db;
    this.#rates = rates;
    this.#bankAccounts = bankAccounts;
    this.#policy = policy;
    this.#now = now;
  }

  async create(user: User, input: { chainId: number; amount: string }): Promise<QuoteView> {
    const chain = DEPOSIT_CHAINS[input.chainId];
    if (!chain) throw new AppError("validation", "That network isn't supported.");

    if (!user.walletAddress) throw new AppError("account-incomplete", "Your wallet is still being set up.");
    const bank = await this.#bankAccounts.getActive(user.id);
    if (!bank) throw new AppError("account-incomplete", "Add a payout bank account first.");
    if (!bank.usable) {
      throw new AppError("account-incomplete", `Your new bank account can receive payouts from ${bank.usableFrom}.`);
    }

    const amount = parseUnits(input.amount, USDC_DECIMALS);
    if (amount === null) throw new AppError("validation", "Enter an amount with at most 6 decimal places.");
    const { minUnits, maxUnits, feeBps } = this.#policy;
    if (amount < minUnits || amount > maxUnits) {
      throw new AppError(
        "validation",
        `Enter between ${formatUnits(minUnits, USDC_DECIMALS)} and ${formatUnits(maxUnits, USDC_DECIMALS)} USDC.`,
      );
    }

    const fee = bpsOf(amount, feeBps);
    const payout = amount - fee;
    // Priced on what the treasury will actually send Paycrest, since rates can vary with order size.
    const quoted = await this.#rates.sellRate(PAYOUT_NETWORK, formatUnits(payout, USDC_DECIMALS));
    const rate = parseRate(quoted.rate);
    if (!rate) throw new AppError("provider-unavailable", "Paycrest returned an unexpected rate.");

    const gross = toFiatMinor(amount, rate);
    const net = toFiatMinor(payout, rate);
    const issuedAt = this.#now();
    const expiresAt = new Date(issuedAt.getTime() + this.#policy.ttlSeconds * 1000);

    const { rows } = await this.#db.query<{ id: string }>(
      `insert into quotes
         (user_id, bank_account_id, chain_id, token, amount_units, fee_units, payout_units, fee_bps,
          payout_network, fiat_currency, rate, gross_fiat_minor, fee_fiat_minor, net_fiat_minor,
          provider_ids, issued_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'NGN', $10, $11, $12, $13, $14, $15, $16)
       returning id`,
      [
        user.id,
        bank.id,
        chain.id,
        chain.usdc,
        amount.toString(),
        fee.toString(),
        payout.toString(),
        feeBps,
        PAYOUT_NETWORK,
        rate.text,
        gross.toString(),
        (gross - net).toString(),
        net.toString(),
        quoted.providerIds,
        issuedAt,
        expiresAt,
      ],
    );
    return (await this.get(user, rows[0]!.id))!;
  }

  async get(user: User, id: string): Promise<QuoteView | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await this.#db.query<QuoteRow>(`${SELECT} where q.id = $1 and q.user_id = $2`, [id, user.id]);
    return rows[0] ? view(rows[0]) : null;
  }
}
