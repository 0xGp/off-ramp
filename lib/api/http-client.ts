import { ApiError, ERROR_COPY, isApiErrorCode } from "./errors";
import type {
  AuthorizeIntentRequest,
  Bank,
  CreatedIntent,
  CreateIntentRequest,
  IntentView,
  MeloApi,
  QuoteOffer,
  Recipient,
  RequestOptions,
  ResolvedAccount,
} from "./types";

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; requestId?: unknown };
}

function newCorrelationId() {
  return `corr_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** Client for MELO's versioned HTTP API. Used when NEXT_PUBLIC_MELO_API_URL is set. */
export function createHttpApi(baseUrl: string): MeloApi {
  const root = baseUrl.replace(/\/$/, "");

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Correlation-ID": newCorrelationId(),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal,
        credentials: "include",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError("network", ERROR_COPY.network);
    }

    const requestId = response.headers.get("X-Request-ID") ?? undefined;
    if (response.ok) return (await response.json()) as T;

    let envelope: ErrorEnvelope = {};
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      // Non-JSON error body; fall back to status mapping below.
    }
    const code = isApiErrorCode(envelope.error?.code)
      ? envelope.error.code
      : response.status === 404
        ? "not-found"
        : response.status === 400 || response.status === 422
          ? "validation"
          : "network";
    const message = typeof envelope.error?.message === "string" ? envelope.error.message : ERROR_COPY[code];
    throw new ApiError(code, message, {
      status: response.status,
      requestId: typeof envelope.error?.requestId === "string" ? envelope.error.requestId : requestId,
    });
  }

  return {
    kind: "http",
    listBanks: (options) => request<Bank[]>("GET", "/v1/banks", undefined, options),
    resolveAccount: (recipient: Recipient, options) =>
      request<ResolvedAccount>("POST", "/v1/recipients/resolve", recipient, options),
    createIntent: (body: CreateIntentRequest, options) => request<CreatedIntent>("POST", "/v1/intents", body, options),
    requestQuote: (intentId, options) =>
      request<QuoteOffer>("POST", `/v1/intents/${encodeURIComponent(intentId)}/quotes`, {}, options),
    authorizeIntent: (intentId, body: AuthorizeIntentRequest, options) =>
      request<IntentView>("POST", `/v1/intents/${encodeURIComponent(intentId)}/authorization`, body, options),
    getIntent: (intentId, options) => request<IntentView>("GET", `/v1/intents/${encodeURIComponent(intentId)}`, undefined, options),
    listActivity: (options) => request<IntentView[]>("GET", "/v1/activity", undefined, options),
  };
}
