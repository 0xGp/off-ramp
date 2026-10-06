/** Codes shared with the web client's error envelope (`web/lib/api/errors.ts`). */
export type ErrorCode =
  | "unauthenticated"
  | "reauth-required"
  | "validation"
  | "not-found"
  | "account-incomplete"
  | "no-route"
  | "quote-expired"
  | "chain-pending"
  | "provider-unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  "reauth-required": 401,
  validation: 422,
  "not-found": 404,
  "account-incomplete": 409,
  "no-route": 422,
  "quote-expired": 409,
  "chain-pending": 409,
  "provider-unavailable": 503,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
  }
}

export function envelope(error: AppError) {
  return { error: { code: error.code, message: error.message } };
}
