import "server-only";

/**
 * Server-side access to Paycrest's public (keyless) aggregator endpoints.
 * Docs: https://docs.paycrest.io/api-reference/introduction (accessed 2026-09-30).
 * Order creation needs a KYB-issued API key and is not called from the web app.
 */
const PAYCREST_API = "https://api.paycrest.io/v2";
const TIMEOUT_MS = 10_000;

/** Paycrest orders are funded from MELO's treasury on Base, whichever chain the user deposits on. */
export const PAYOUT_NETWORK = "base";

export class PaycrestError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "rejected",
  ) {
    super(message);
  }
}

interface Envelope<T> {
  status?: string;
  message?: string;
  data?: T;
}

async function call<T>(path: string, init: RequestInit & { next?: { revalidate: number } } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${PAYCREST_API}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PaycrestError("Paycrest is unreachable.", "unavailable");
  }

  let body: Envelope<T> = {};
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    // Gateway errors return HTML or empty bodies.
  }

  if (response.status >= 500 || response.status === 429) {
    throw new PaycrestError("Paycrest is temporarily unavailable.", "unavailable");
  }
  if (!response.ok || body.status !== "success" || body.data === undefined) {
    throw new PaycrestError(body.message ?? "Paycrest rejected the request.", "rejected");
  }
  return body.data;
}

export interface PaycrestInstitution {
  code: string;
  name: string;
  type: string;
}

export async function getInstitutions(currency: "NGN"): Promise<PaycrestInstitution[]> {
  return call<PaycrestInstitution[]>(`/institutions/${currency}`, { next: { revalidate: 3600 } });
}

interface RateSide {
  rate: string;
  providerIds?: string[];
}

/** Sell side = stablecoin to fiat. `rate` is a decimal string of NGN per 1 USDC. */
export async function getSellRate(amount: string, currency: "NGN"): Promise<RateSide> {
  const data = await call<{ sell?: RateSide }>(
    `/rates/${PAYOUT_NETWORK}/USDC/${encodeURIComponent(amount)}/${currency}`,
    { cache: "no-store" },
  );
  if (!data.sell?.rate) throw new PaycrestError("No sell rate for this amount.", "rejected");
  return data.sell;
}

export async function verifyAccount(institution: string, accountIdentifier: string): Promise<string> {
  const data = await call<unknown>("/verify-account", {
    method: "POST",
    body: JSON.stringify({ institution, accountIdentifier }),
    cache: "no-store",
  });
  const name =
    typeof data === "string"
      ? data
      : typeof data === "object" && data && "accountName" in data && typeof data.accountName === "string"
        ? data.accountName
        : null;
  if (!name?.trim()) throw new PaycrestError("Paycrest returned no account name.", "rejected");
  // "OK" means the account exists but this corridor has no name lookup.
  if (name.trim() === "OK") throw new PaycrestError("Name lookup isn't available for this bank.", "unavailable");
  return name.trim();
}

export function errorResponse(error: unknown) {
  if (error instanceof PaycrestError) {
    return Response.json(
      {
        error: {
          code: error.kind === "unavailable" ? "provider-unavailable" : "validation",
          message: error.message,
        },
      },
      { status: error.kind === "unavailable" ? 503 : 422 },
    );
  }
  return Response.json({ error: { code: "network", message: "Unexpected error." } }, { status: 500 });
}
