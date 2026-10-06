import type { Address, Hex } from "viem";

import type { TreasuryFunder } from "../chain/treasury.ts";
import type { Db } from "../db/pool.ts";

/** Don't start a transfer this close to the order deadline; it might land after it. */
const MIN_TIME_LEFT_MS = 60_000;
/** After the deadline plus this, an unseen transfer is abandoned (the order has expired). */
const GIVE_UP_AFTER_DEADLINE_MS = 10 * 60_000;
/** A Base USDC transfer costs well under this; below it the treasury can't pay gas. */
const MIN_GAS_WEI = 10_000_000_000_000n; // 0.00001 ETH

export type FundResult =
  | { done: false }
  | { done: true; outcome: "funded"; txHash: Hex }
  | { done: true; outcome: "skipped" | "abandoned"; reason: string }
  | { done: true; outcome: "not-needed" };

interface FundingRow {
  status: string;
  user_id: string;
  provider_order_id: string | null;
  funding_address: Address | null;
  funding_amount_units: string | null;
  funding_valid_until: Date | null;
  funding_tx_hash: Hex | null;
  funding_raw_tx: Hex | null;
  funded_at: Date | null;
  funding_skipped: string | null;
}

/**
 * Sends Paycrest the USDC for an order from the treasury float on Base. Never pays twice:
 * the single transfer per payout is signed and recorded before broadcast, and is never
 * re-signed. If it can't be sent or doesn't land, the order expires and the escrow refunds.
 */
export class PayoutFunding {
  readonly #db: Db;
  readonly #funder: TreasuryFunder;
  readonly #capUnits: bigint;
  readonly #now: () => Date;

  constructor(db: Db, funder: TreasuryFunder, capUnits: bigint, now = () => new Date()) {
    this.#db = db;
    this.#funder = funder;
    this.#capUnits = capUnits;
    this.#now = now;
  }

  async fund(payoutId: string): Promise<FundResult> {
    const row = await this.#row(payoutId);
    if (!row.funding_address || !row.funding_amount_units || !row.funding_valid_until) {
      return { done: true, outcome: "not-needed" };
    }
    if (row.funded_at && row.funding_tx_hash) return { done: true, outcome: "funded", txHash: row.funding_tx_hash };
    if (row.funding_skipped) return { done: true, outcome: "skipped", reason: row.funding_skipped };

    if (row.funding_tx_hash && row.funding_raw_tx) return this.#track(payoutId, row);
    if (row.status !== "pending") return { done: true, outcome: "not-needed" };

    const amount = BigInt(row.funding_amount_units);
    const deadline = row.funding_valid_until.getTime();
    if (amount > this.#capUnits) return this.#skip(payoutId, row, "over-cap");
    if (deadline - this.#now().getTime() < MIN_TIME_LEFT_MS) return this.#skip(payoutId, row, "too-late");
    const { usdcUnits, ethWei } = await this.#funder.balances();
    if (usdcUnits < amount) return this.#skip(payoutId, row, "treasury-usdc-low");
    if (ethWei < MIN_GAS_WEI) return this.#skip(payoutId, row, "treasury-gas-low");

    const signed = await this.#funder.signTransfer(row.funding_address, amount);
    const claimed = await this.#db.query(
      `update payouts set funding_tx_hash = $2, funding_raw_tx = $3, updated_at = $4
       where id = $1 and funding_tx_hash is null and funding_skipped is null`,
      [payoutId, signed.hash, signed.raw, this.#now()],
    );
    if (!claimed.rowCount) return { done: false };
    await this.#audit(row, "payout.funding_sent", {
      payoutId,
      orderId: row.provider_order_id,
      txHash: signed.hash,
      to: row.funding_address,
      amountUnits: amount.toString(),
    });
    await this.#funder.broadcast(signed.raw);
    return { done: false };
  }

  async #track(payoutId: string, row: FundingRow): Promise<FundResult> {
    const hash = row.funding_tx_hash!;
    const receipt = await this.#funder.receipt(hash);
    if (receipt.status === "success") {
      await this.#db.query(`update payouts set funded_at = $2, updated_at = $2 where id = $1 and funded_at is null`, [
        payoutId,
        this.#now(),
      ]);
      await this.#audit(row, "payout.funded", { payoutId, orderId: row.provider_order_id, txHash: hash });
      return { done: true, outcome: "funded", txHash: hash };
    }
    if (receipt.status === "reverted") return this.#skip(payoutId, row, "funding-reverted");
    if (this.#now().getTime() > row.funding_valid_until!.getTime() + GIVE_UP_AFTER_DEADLINE_MS) {
      return this.#skip(payoutId, row, "funding-not-mined");
    }
    // Never push a transfer after the deadline: it would reach an expired order.
    if (receipt.status === "unknown" && this.#now().getTime() < row.funding_valid_until!.getTime()) {
      await this.#funder.broadcast(row.funding_raw_tx!);
    }
    return { done: false };
  }

  async #skip(payoutId: string, row: FundingRow, reason: string): Promise<FundResult> {
    await this.#db.query(`update payouts set funding_skipped = $2, updated_at = $3 where id = $1 and funding_skipped is null`, [
      payoutId,
      reason,
      this.#now(),
    ]);
    await this.#audit(row, "payout.funding_skipped", { payoutId, orderId: row.provider_order_id, reason });
    const outcome = reason.startsWith("funding-") ? "abandoned" : "skipped";
    return { done: true, outcome, reason };
  }

  async #audit(row: FundingRow, kind: string, data: object) {
    await this.#db.query(`insert into audit_events (user_id, kind, data) values ($1, $2, $3)`, [row.user_id, kind, data]);
  }

  async #row(payoutId: string): Promise<FundingRow> {
    const { rows } = await this.#db.query<FundingRow>(
      `select p.status, d.user_id, p.provider_order_id, p.funding_address, p.funding_amount_units, p.funding_valid_until,
              p.funding_tx_hash, p.funding_raw_tx, p.funded_at, p.funding_skipped
       from payouts p join deposits d on d.id = p.deposit_id where p.id = $1`,
      [payoutId],
    );
    if (!rows[0]) throw new Error(`payout ${payoutId} not found`);
    return rows[0];
  }
}
