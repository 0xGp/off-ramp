/**
 * Frontend view of the handbook's intent lifecycle. Status is always a backend
 * projection; the UI renders it and never infers settlement on its own.
 */

export type IntentStatus =
  | "CREATED"
  | "QUOTE_AVAILABLE"
  | "USER_APPROVAL_REQUIRED"
  | "ESCROW_PENDING"
  | "ESCROWED"
  | "FIAT_PAYMENT_PENDING"
  | "PAYMENT_VERIFYING"
  | "PAYMENT_VERIFIED"
  | "RELEASE_PENDING"
  | "SETTLED"
  | "QUOTE_EXPIRED"
  | "PAYOUT_FAILED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "RECONCILIATION_REQUIRED";

export type PayoutStatus = "NOT_STARTED" | "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED" | "UNKNOWN";

export type Tone = "neutral" | "progress" | "success" | "warning" | "danger";

export const STATUS_META: Record<IntentStatus, { label: string; tone: Tone }> = {
  CREATED: { label: "Draft", tone: "neutral" },
  QUOTE_AVAILABLE: { label: "Quote ready", tone: "neutral" },
  USER_APPROVAL_REQUIRED: { label: "Awaiting your approval", tone: "neutral" },
  ESCROW_PENDING: { label: "Escrow pending", tone: "progress" },
  ESCROWED: { label: "USDC in escrow", tone: "progress" },
  FIAT_PAYMENT_PENDING: { label: "Payout processing", tone: "progress" },
  PAYMENT_VERIFYING: { label: "Verifying payment", tone: "progress" },
  PAYMENT_VERIFIED: { label: "Payment verified", tone: "success" },
  RELEASE_PENDING: { label: "Releasing escrow", tone: "progress" },
  SETTLED: { label: "Settled", tone: "success" },
  QUOTE_EXPIRED: { label: "Quote expired", tone: "warning" },
  PAYOUT_FAILED: { label: "Payout failed", tone: "danger" },
  REFUND_PENDING: { label: "Refund pending", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  RECONCILIATION_REQUIRED: { label: "Needs attention", tone: "danger" },
};

export const TERMINAL_STATUSES: IntentStatus[] = ["SETTLED", "REFUNDED"];

/** Settled or refunded never change; needs-attention can, but only via reconciliation. */
export function isTerminal(status: IntentStatus) {
  return TERMINAL_STATUSES.includes(status);
}

export interface Quote {
  inputAmount: bigint;
  inputDecimals: number;
  inputAsset: "USDC";
  fiatCurrency: "NGN";
  fiatDecimals: number;
  grossFiat: bigint;
  providerFee: bigint;
  meloFee: bigint;
  netFiat: bigint;
  rateDisplay: string;
  issuedAt: number;
  expiresAt: number;
  reservation: "INDICATIVE" | "RESERVED";
}

/** Redux-safe quote: bigint fields carried as base-unit decimal strings. */
export type SerializedQuote = {
  [K in keyof Quote]: Quote[K] extends bigint ? string : Quote[K];
};

const BIGINT_FIELDS = ["inputAmount", "grossFiat", "providerFee", "meloFee", "netFiat"] as const;

export function serializeQuote(quote: Quote): SerializedQuote {
  const out = { ...quote } as unknown as SerializedQuote;
  for (const key of BIGINT_FIELDS) out[key] = quote[key].toString();
  return out;
}

export function deserializeQuote(quote: SerializedQuote): Quote {
  const out = { ...quote } as unknown as Quote;
  for (const key of BIGINT_FIELDS) out[key] = BigInt(quote[key]);
  return out;
}

export interface IntentProjection {
  status: IntentStatus;
  payoutStatus: PayoutStatus;
  confirmations: number;
}
