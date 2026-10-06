import { randomUUID } from "node:crypto";

export type PayoutStatus = "pending" | "succeeded" | "failed";

export interface PayoutRecipient {
  institution: string;
  /** Full account number, decrypted only to place the order; never logged or stored in clear. */
  accountIdentifier: string;
  accountName: string;
}

export interface PayoutOrderInput {
  /** Our deposit id; providers echo it back so orders can be reconciled. */
  reference: string;
  /** USDC base units sent to the provider. */
  amountUnits: bigint;
  /** NGN per USDC as quoted; Paycrest rejects orders whose rate drifted too far. */
  rate: string;
  providerIds: string[];
  recipient: PayoutRecipient | null;
}

/** Where and how much to send so the provider pays out; absent when nothing needs funding. */
export interface PayoutFunding {
  address: string;
  amountUnits: bigint;
  validUntil: Date;
}

export interface PayoutOrder {
  orderId: string;
  funding?: PayoutFunding;
}

/** The provider refused the order; retrying the same order would be refused again. */
export class PayoutRejected extends Error {}

export interface PayoutProvider {
  readonly name: string;
  create(order: PayoutOrderInput): Promise<PayoutOrder>;
  status(order: { orderId: string; createdAt: Date }): Promise<PayoutStatus>;
}

/**
 * Development stand-in for Paycrest, which has no testnet. Orders settle with a fixed
 * outcome after a delay; nothing is paid to any bank.
 */
export class SimulatedPayoutProvider implements PayoutProvider {
  readonly name = "simulated";
  readonly #delayMs: number;
  readonly #outcome: Exclude<PayoutStatus, "pending">;
  readonly #now: () => Date;

  constructor(opts: { delaySeconds: number; outcome: Exclude<PayoutStatus, "pending"> }, now = () => new Date()) {
    this.#delayMs = opts.delaySeconds * 1000;
    this.#outcome = opts.outcome;
    this.#now = now;
  }

  async create(): Promise<PayoutOrder> {
    return { orderId: `sim_${randomUUID()}` };
  }

  async status(order: { orderId: string; createdAt: Date }): Promise<PayoutStatus> {
    return this.#now().getTime() - order.createdAt.getTime() >= this.#delayMs ? this.#outcome : "pending";
  }
}
