import { formatUnits, parseUnits, USDC_DECIMALS } from "../lib/money.ts";
import { PAYOUT_NETWORK } from "../chains.ts";
import {
  PayoutRejected,
  type PayoutOrder,
  type PayoutOrderInput,
  type PayoutProvider,
  type PayoutStatus,
} from "./provider.ts";

const TIMEOUT_MS = 15_000;

interface Envelope<T> {
  status?: string;
  message?: string;
  data?: T;
}

interface CreatedOrder {
  id: string;
  providerAccount?: { receiveAddress?: string; amountToTransfer?: string; validUntil?: string; network?: string };
}

/**
 * Paycrest sender API v2 (https://docs.paycrest.io/implementation-guides/sender-api-integration,
 * accessed 2026-10-06). Mainnet only: an order is paid out once `amountToTransfer` USDC reaches
 * `receiveAddress` on Base; funding is a separate, explicit step owned by the treasury.
 */
export class PaycrestPayoutProvider implements PayoutProvider {
  readonly name = "paycrest";
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #refundAddress: string;
  readonly #fetch: typeof fetch;

  constructor(opts: { baseUrl: string; apiKey: string; refundAddress: string }, fetchImpl: typeof fetch = fetch) {
    this.#baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.#apiKey = opts.apiKey;
    this.#refundAddress = opts.refundAddress;
    this.#fetch = fetchImpl;
  }

  async create(order: PayoutOrderInput): Promise<PayoutOrder> {
    if (!order.recipient) throw new Error("Paycrest orders need the recipient's bank details");
    const body = {
      amount: formatUnits(order.amountUnits, USDC_DECIMALS),
      rate: order.rate,
      reference: order.reference,
      source: { type: "crypto", currency: "USDC", network: PAYOUT_NETWORK, refundAddress: this.#refundAddress },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: { ...order.recipient, memo: "MELO cash-out" },
        ...(order.providerIds.length ? { providerIds: order.providerIds.slice(0, 3) } : {}),
      },
    };
    const created = await this.#call<CreatedOrder>("/sender/orders", { method: "POST", body: JSON.stringify(body) });
    const account = created.providerAccount;
    if (!created.id || !account?.receiveAddress || !account.amountToTransfer || !account.validUntil) {
      throw new Error("Paycrest returned an order without funding instructions");
    }
    if (account.network && account.network !== PAYOUT_NETWORK) {
      throw new Error(`Paycrest asked for funding on ${account.network}, expected ${PAYOUT_NETWORK}`);
    }
    const amountUnits = parseUnits(account.amountToTransfer, USDC_DECIMALS);
    const validUntil = new Date(account.validUntil);
    if (amountUnits === null || Number.isNaN(validUntil.getTime())) {
      throw new Error("Paycrest returned unreadable funding instructions");
    }
    return { orderId: created.id, funding: { address: account.receiveAddress, amountUnits, validUntil } };
  }

  async status(order: { orderId: string }): Promise<PayoutStatus> {
    const data = await this.#call<{ status?: string }>(`/sender/orders/${encodeURIComponent(order.orderId)}`);
    return paycrestStatus(data.status);
  }

  async #call<T>(path: string, init: RequestInit = {}): Promise<T> {
    // Network failures and timeouts propagate as plain errors so the worker retries them.
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "API-Key": this.#apiKey,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body: Envelope<T> = {};
    try {
      body = (await response.json()) as Envelope<T>;
    } catch {
      // Gateway errors return HTML or empty bodies.
    }
    if (response.status >= 500 || response.status === 429) {
      throw new Error(`Paycrest ${path} unavailable (${response.status})`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Paycrest rejected the API key (${response.status})`);
    }
    if (!response.ok || body.status !== "success" || body.data === undefined) {
      throw new PayoutRejected(body.message ?? `Paycrest refused the request (${response.status})`);
    }
    return body.data;
  }
}

/** Off-ramp: final only at `settled`; `refunded`/`expired` mean the naira never left. */
export function paycrestStatus(status: string | undefined): PayoutStatus {
  switch (status) {
    case "settled":
      return "succeeded";
    case "refunded":
    case "expired":
      return "failed";
    default:
      return "pending";
  }
}
