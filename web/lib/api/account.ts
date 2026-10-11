"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";

import { formatUnits, parseUnits } from "@/lib/money";
import { ApiError, isApiErrorCode } from "./errors";
import type { IntentStatus, PayoutStatus } from "@/lib/offramp/model";
import { setBackendActivitySource, setBackendQuoteSource } from "./mock-api";
import type { IntentView, WireQuote } from "./types";

/** MELO backend (backend/). Unset means account features stay off and the flow uses the mock API. */
export const BACKEND_URL = process.env.NEXT_PUBLIC_MELO_BACKEND_URL?.replace(/\/$/, "");

/** Mirrors the backend's BankAccountView; never includes the full account number. */
export interface SavedBankAccount {
  id: string;
  institutionCode: string;
  institutionName: string;
  accountName: string;
  accountLast4: string;
  verifiedAt: string;
  usableFrom: string;
  usable: boolean;
}

export type OnboardingStep = "wallet" | "bank-account";

export interface Me {
  id: string;
  email: string | null;
  displayName: string | null;
  walletAddress: `0x${string}` | null;
  bankAccount: SavedBankAccount | null;
  onboarding: { complete: boolean; nextStep: OnboardingStep | null; completedAt: string | null };
}

export class BackendError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Maps a backend error onto the flow's error codes so screens show the matching state. */
export function toFlowApiError(error: BackendError): ApiError {
  const code = isApiErrorCode(error.code) ? error.code : error.status === 0 ? "network" : "validation";
  return new ApiError(code, error.message, { status: error.status });
}

export async function backendFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      // The API rejects a JSON content-type with an empty body (e.g. POST /v1/quotes/:id/deposit).
      headers: {
        ...init?.headers,
        authorization: `Bearer ${token}`,
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BackendError(0, "network", "Couldn't reach MELO. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new BackendError(res.status, body?.error?.code ?? "internal", body?.error?.message ?? res.statusText);
  }
  return body as T;
}

function useAuthedFetch() {
  const { getAccessToken } = usePrivy();
  return async <T,>(path: string, init?: RequestInit) => {
    const token = await getAccessToken();
    if (!token) throw new BackendError(401, "unauthenticated", "Sign in again.");
    return backendFetch<T>(path, token, init);
  };
}

const meKey = (userId: string | undefined) => ["me", userId] as const;

/**
 * The signed-in user's MELO account. The first call creates the account and links
 * their Privy wallet on the backend.
 */
export function useMe() {
  const { ready, authenticated, user } = usePrivy();
  const authedFetch = useAuthedFetch();
  const hasWallet = !!user?.wallet?.address;
  return useQuery({
    queryKey: meKey(user?.id),
    enabled: !!BACKEND_URL && ready && authenticated,
    retry: (count, err) => !(err instanceof BackendError && err.status >= 400 && err.status < 500) && count < 2,
    // Until the backend has linked the wallet Privy just created, check again shortly.
    refetchInterval: (query) => (query.state.data && !query.state.data.walletAddress && hasWallet ? 1500 : false),
    queryFn: () => authedFetch<Me>("/v1/me"),
  });
}

export interface BankInput {
  institutionCode: string;
  accountNumber: string;
}

/** Bank name check through the backend; nothing is stored. */
export function useVerifyBankAccount() {
  const authedFetch = useAuthedFetch();
  return useMutation({
    mutationFn: (input: BankInput) =>
      authedFetch<{ accountName: string; institutionName: string }>("/v1/bank-accounts/verify", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

/** Mirrors the backend's QuoteView. Amounts are base-unit strings (USDC 6 dp, NGN kobo). */
export interface BackendQuote {
  id: string;
  chainId: number;
  token: string;
  amount: string;
  decimals: number;
  fee: string;
  feeBps: number;
  payoutAmount: string;
  rate: string;
  fiat: { currency: "NGN"; decimals: number; gross: string; fee: string; net: string };
  payTo: { institutionName: string; accountName: string; accountLast4: string };
  issuedAt: string;
  expiresAt: string;
}

export function toWireQuote(q: BackendQuote): WireQuote {
  const rate = parseUnits(q.rate.replace(/^(\d+\.\d{0,6}).*$/, "$1"), 6);
  return {
    quoteId: q.id,
    inputAmount: q.amount,
    inputDecimals: q.decimals,
    inputAsset: "USDC",
    fiatCurrency: q.fiat.currency,
    fiatDecimals: q.fiat.decimals,
    grossFiat: q.fiat.gross,
    providerFee: "0",
    meloFee: q.fiat.fee,
    netFiat: q.fiat.net,
    rateDisplay: rate === null ? `1 USDC = ₦${q.rate}` : `1 USDC = ₦${formatUnits(rate, 6, 2)}`,
    issuedAt: Date.parse(q.issuedAt),
    expiresAt: Date.parse(q.expiresAt),
    reservation: "INDICATIVE",
  };
}

/** Mirrors the backend's ActivityView: a cash-out whose USDC reached the escrow. */
interface BackendActivity {
  id: string;
  chainId: number;
  escrow: string;
  depositStatus: "escrowed" | "released" | "refunded";
  depositTxHash: string;
  escrowedAt: string;
  quote: BackendQuote;
  payout: { status: "pending" | "succeeded" | "failed"; providerOrderId: string; fiatMinor: string; settleTxHash: string | null } | null;
}

function activityStatus(a: BackendActivity): IntentStatus {
  if (a.depositStatus === "released") return "SETTLED";
  if (a.depositStatus === "refunded") return "REFUNDED";
  switch (a.payout?.status) {
    case "pending":
      return "FIAT_PAYMENT_PENDING";
    case "succeeded":
      return "RELEASE_PENDING";
    case "failed":
      return "REFUND_PENDING";
    default:
      return "ESCROWED";
  }
}

const PAYOUT_STATUS = { pending: "PENDING", succeeded: "SUCCEEDED", failed: "FAILED" } as const satisfies Record<
  string,
  PayoutStatus
>;

function toIntentView(a: BackendActivity): IntentView {
  const quote = toWireQuote(a.quote);
  return {
    id: a.id,
    chainId: a.chainId,
    authorizedAt: Date.parse(a.escrowedAt),
    // The Paycrest order's naira amount is what was actually sent; the quote's is indicative.
    quote: a.payout ? { ...quote, netFiat: a.payout.fiatMinor } : quote,
    recipient: {
      bankCode: "",
      bankName: a.quote.payTo.institutionName,
      accountLast4: a.quote.payTo.accountLast4,
      accountName: a.quote.payTo.accountName,
    },
    escrowTxHash: a.depositTxHash,
    escrowContract: a.escrow,
    providerReference: a.payout?.providerOrderId ?? "—",
    correlationId: a.id,
    simulated: false,
    projection: {
      status: activityStatus(a),
      payoutStatus: a.payout ? PAYOUT_STATUS[a.payout.status] : "NOT_STARTED",
      confirmations: 1,
    },
  };
}

/** While signed in, quotes and activity come from the backend instead of the in-browser simulation. */
export function useBackendQuotes() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const enabled = !!BACKEND_URL && ready && authenticated;
  useEffect(() => {
    if (!enabled) return;
    const get = async <T,>(path: string, signal?: AbortSignal) => {
      const token = await getAccessToken();
      if (!token) throw new ApiError("validation", "Sign in again to continue.", { status: 401 });
      try {
        return await backendFetch<T>(path, token, { signal });
      } catch (error) {
        throw error instanceof BackendError ? toFlowApiError(error) : error;
      }
    };
    setBackendActivitySource({
      list: async (signal) => (await get<{ activity: BackendActivity[] }>("/v1/activity", signal)).activity.map(toIntentView),
      get: async (id, signal) =>
        toIntentView((await get<{ activity: BackendActivity }>(`/v1/activity/${encodeURIComponent(id)}`, signal)).activity),
    });
    setBackendQuoteSource(async ({ chainId, amount }, signal) => {
      const token = await getAccessToken();
      if (!token) throw new ApiError("validation", "Sign in again to get a quote.", { status: 401 });
      try {
        const { quote } = await backendFetch<{ quote: BackendQuote }>("/v1/quotes", token, {
          method: "POST",
          body: JSON.stringify({ chainId, amount }),
          signal,
        });
        return { quote: toWireQuote(quote), payTo: quote.payTo };
      } catch (error) {
        throw error instanceof BackendError ? toFlowApiError(error) : error;
      }
    });
    return () => {
      setBackendQuoteSource(null);
      setBackendActivitySource(null);
    };
  }, [enabled, getAccessToken]);
}

/** Saves the payout account; the response is the updated account, so the cache is replaced with it. */
export function useSaveBankAccount() {
  const { user } = usePrivy();
  const authedFetch = useAuthedFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BankInput) =>
      authedFetch<Me>("/v1/me/bank-account", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: (me) => queryClient.setQueryData(meKey(user?.id), me),
  });
}
