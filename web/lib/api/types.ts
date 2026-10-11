/**
 * Frontend view of MELO's API contract. Shapes follow the handbook's draft
 * endpoint inventory and typed error list; the contract is `IDEA` status until
 * the backend publishes a versioned OpenAPI schema. Amounts are base-unit
 * decimal strings on the wire.
 */
import type { IntentProjection, IntentStatus, SerializedQuote } from "@/lib/offramp/model";

export const API_ERROR_CODES = [
  "validation",
  "quote-expired",
  "no-route",
  "provider-unavailable",
  "payout-unknown",
  "chain-pending",
  "attestation-rejected",
  "reconciliation-required",
  "not-found",
  "network",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface Bank {
  code: string;
  name: string;
}

export interface Recipient {
  bankCode: string;
  accountNumber: string;
}

export interface CreateIntentRequest {
  inputAsset: "USDC";
  inputAmount: string;
  chainId: number;
  fiatCurrency: "NGN";
  recipient: Recipient;
  walletAddress: string | null;
}

export interface CreatedIntent {
  intentId: string;
  status: IntentStatus;
}

export type WireQuote = SerializedQuote & { quoteId: string };

/** EIP-712 payload built by the backend; uint fields are decimal strings. */
export interface AuthorizationTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, string>;
}

export interface QuoteOffer {
  quote: WireQuote;
  authorization: AuthorizationTypedData;
}

export interface AuthorizeIntentRequest {
  quoteId: string;
  signature: string;
  signer: string;
  /** Set when the USDC is already locked onchain; the backend has confirmed this deposit. */
  escrowTxHash?: string;
}

export interface ResolvedAccount {
  accountName: string;
  /** False when the name check was unavailable and a development placeholder was used. */
  verified: boolean;
}

export interface IntentView {
  id: string;
  /** Chain the user's escrow deposit lives on. */
  chainId: number;
  authorizedAt: number;
  quote: WireQuote;
  recipient: { bankCode: string; bankName: string; accountLast4: string; accountName: string };
  escrowTxHash: string;
  escrowContract: string;
  providerReference: string;
  correlationId: string;
  /** In-browser simulation (signed out); real cash-outs come from the MELO backend. */
  simulated: boolean;
  projection: IntentProjection;
}

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface MeloApi {
  readonly kind: "mock" | "http";
  listBanks(options?: RequestOptions): Promise<Bank[]>;
  resolveAccount(recipient: Recipient, options?: RequestOptions): Promise<ResolvedAccount>;
  createIntent(request: CreateIntentRequest, options?: RequestOptions): Promise<CreatedIntent>;
  requestQuote(intentId: string, options?: RequestOptions): Promise<QuoteOffer>;
  authorizeIntent(intentId: string, request: AuthorizeIntentRequest, options?: RequestOptions): Promise<IntentView>;
  getIntent(intentId: string, options?: RequestOptions): Promise<IntentView>;
  listActivity(options?: RequestOptions): Promise<IntentView[]>;
}
