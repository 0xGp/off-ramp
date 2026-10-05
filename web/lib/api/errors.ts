import { API_ERROR_CODES, type ApiErrorCode } from "./types";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly requestId?: string;

  constructor(code: ApiErrorCode, message: string, init: { status?: number; requestId?: string } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = init.status;
    this.requestId = init.requestId;
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

/** User-facing copy per error code. Screens may override with more context. */
export const ERROR_COPY: Record<ApiErrorCode, string> = {
  validation: "Some details look wrong. Check them and try again.",
  "quote-expired": "This quote expired. Get a new one to continue.",
  "no-route": "No payout partner can take this cash-out right now.",
  "provider-unavailable": "Our payout partner isn't responding. Try again in a few minutes.",
  "payout-unknown": "We're still confirming whether the payout arrived.",
  "chain-pending": "Waiting for the escrow deposit to confirm onchain.",
  "attestation-rejected": "The payment evidence couldn't be verified.",
  "reconciliation-required": "This cash-out needs a manual check.",
  "not-found": "We couldn't find that cash-out.",
  network: "Can't reach MELO right now. Check your connection and try again.",
};

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError("network", error instanceof Error ? error.message : ERROR_COPY.network);
}
