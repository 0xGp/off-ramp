/**
 * SIMULATED BACKEND implementing the MeloApi contract. Used until
 * NEXT_PUBLIC_MELO_API_URL points at a real deployment.
 *
 * Live from Paycrest (public endpoints, proxied by /api/paycrest/*): the NGN bank
 * list, account-name checks and the USDC→NGN sell rate on Base.
 * When signed in to the MELO backend, quotes come from it instead (see setBackendQuoteSource).
 * Simulated: intents, escrow transactions and payout outcomes. They are fixtures, not evidence.
 * State lives in sessionStorage so a refresh behaves like a server round-trip.
 */
import { getChain } from "@/lib/chains";
import { formatUnits, parseUnits } from "@/lib/money";
import type { IntentProjection, IntentStatus, PayoutStatus } from "@/lib/offramp/model";
import { ApiError, isApiErrorCode } from "./errors";
import type {
  AuthorizationTypedData,
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
  WireQuote,
} from "./types";

export const SAMPLE_ESCROW_CONTRACT = "0x9f2a000000000000000000000000000000004b1c";

const USDC_DECIMALS = 6;
const NGN_DECIMALS = 2;
/** Paycrest rates are decimal strings; parsed at 6 places so no float ever touches money. */
const RATE_DECIMALS = 6;
const QUOTE_TTL_MS = 90_000;
const MELO_FEE_BPS = 30n;
const STORAGE_KEY = "melo.mock-backend.v1";

const DEV_PLACEHOLDER_NAMES = ["ADAEZE OKAFOR", "TUNDE BALOGUN", "HAUWA MUSA", "CHIDI NWOSU"];

async function callRoute<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("network", "Check your connection and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown } } & T;
  if (response.ok) return body;
  const code = isApiErrorCode(body.error?.code) ? body.error.code : "network";
  const message = typeof body.error?.message === "string" ? body.error.message : "Something went wrong.";
  throw new ApiError(code, message, { status: response.status });
}

let banksPromise: Promise<Bank[]> | null = null;
function loadBanks(signal?: AbortSignal): Promise<Bank[]> {
  banksPromise ??= callRoute<{ banks: Bank[] }>("/api/paycrest/institutions", { signal })
    .then((r) => r.banks)
    .catch((error) => {
      banksPromise = null;
      throw error;
    });
  return banksPromise;
}

const resolvedAccounts = new Map<string, ResolvedAccount>();

function devPlaceholderName(recipient: Recipient) {
  const seed = [...(recipient.bankCode + recipient.accountNumber)].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return DEV_PLACEHOLDER_NAMES[seed % DEV_PLACEHOLDER_NAMES.length];
}

/** Plain decimal string for an amount in base units, e.g. 50500000n → "50.5". */
function toDecimalString(units: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${units / base}${fraction ? `.${fraction}` : ""}`;
}

/** Seconds after authorization at which the simulated projection advances. */
const TIMELINE: { at: number; status: IntentStatus }[] = [
  { at: 0, status: "ESCROW_PENDING" },
  { at: 3, status: "ESCROWED" },
  { at: 6, status: "FIAT_PAYMENT_PENDING" },
  { at: 11, status: "PAYMENT_VERIFYING" },
  { at: 15, status: "PAYMENT_VERIFIED" },
  { at: 17, status: "RELEASE_PENDING" },
  { at: 20, status: "SETTLED" },
];

const PAYOUT_BY_STATUS: Partial<Record<IntentStatus, PayoutStatus>> = {
  FIAT_PAYMENT_PENDING: "PENDING",
  PAYMENT_VERIFYING: "PENDING",
  PAYMENT_VERIFIED: "SUCCEEDED",
  RELEASE_PENDING: "SUCCEEDED",
  SETTLED: "SUCCEEDED",
  PAYOUT_FAILED: "FAILED",
  REFUND_PENDING: "FAILED",
  REFUNDED: "FAILED",
  RECONCILIATION_REQUIRED: "UNKNOWN",
};

interface StoredIntent {
  id: string;
  createdAt: number;
  request: CreateIntentRequest;
  bankName: string;
  accountName: string;
  nonce: string;
  quote?: WireQuote;
  authorizedAt?: number;
  escrowTxHash: string;
  providerReference: string;
  correlationId: string;
}

interface Store {
  intents: Record<string, StoredIntent>;
  idempotency: Record<string, string>;
}

function load(): Store {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    // Fall through to an empty store.
  }
  return { intents: {}, idempotency: {} };
}

function save(store: Store) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable; the session continues in memory only for this call.
  }
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function randomHex(bytes: number) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function project(intent: StoredIntent, now: number): IntentProjection {
  if (!intent.authorizedAt) return { status: "USER_APPROVAL_REQUIRED", payoutStatus: "NOT_STARTED", confirmations: 0 };
  const elapsed = (now - intent.authorizedAt) / 1000;
  let status: IntentStatus = TIMELINE[0].status;
  for (const step of TIMELINE) if (elapsed >= step.at) status = step.status;
  return {
    status,
    payoutStatus: PAYOUT_BY_STATUS[status] ?? "NOT_STARTED",
    confirmations: status === "ESCROW_PENDING" ? 0 : 1,
  };
}

function toView(intent: StoredIntent, now: number): IntentView {
  if (!intent.quote) throw new ApiError("not-found", "This cash-out hasn't been quoted yet.", { status: 404 });
  return {
    id: intent.id,
    chainId: getChain(intent.request.chainId).id,
    authorizedAt: intent.authorizedAt ?? intent.createdAt,
    quote: intent.quote,
    recipient: {
      bankCode: intent.request.recipient.bankCode,
      bankName: intent.bankName,
      accountLast4: intent.request.recipient.accountNumber.slice(-4),
      accountName: intent.accountName,
    },
    escrowTxHash: intent.escrowTxHash,
    escrowContract: getChain(intent.request.chainId).escrow ?? SAMPLE_ESCROW_CONTRACT,
    providerReference: intent.providerReference,
    correlationId: intent.correlationId,
    simulated: true,
    projection: project(intent, now),
  };
}

type QuoteSource = (
  request: { chainId: number; amount: string },
  signal?: AbortSignal,
) => Promise<{ quote: WireQuote; payTo: { institutionName: string; accountName: string } }>;

/** The saved-account flow only carries the last four digits; the full number never leaves the backend. */
const MASKED_ACCOUNT = /^•+\d{4}$/;

/** Kept on globalThis so a hot reload of this module doesn't drop the registration. */
const registry = globalThis as typeof globalThis & { __meloBackendQuoteSource?: QuoteSource | null };

function backendQuoteSourceNow(): QuoteSource | null {
  return registry.__meloBackendQuoteSource ?? null;
}

/** Registered while signed in to the MELO backend; quotes then come from `POST /v1/quotes`. */
export function setBackendQuoteSource(source: QuoteSource | null) {
  registry.__meloBackendQuoteSource = source;
}

/**
 * Quotes from Paycrest's live sell rate on Base. Paycrest's protocol fee is paid by its
 * providers (priced into the rate), so the provider fee line is zero; MELO's fee is on top.
 */
async function buildQuote(inputAmount: bigint, now: number, signal?: AbortSignal): Promise<WireQuote> {
  const { rate } = await callRoute<{ rate: string }>(
    `/api/paycrest/rate?amount=${toDecimalString(inputAmount, USDC_DECIMALS)}`,
    { signal },
  ).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "validation") {
      throw new ApiError("no-route", "No payout provider can fill this amount right now.", { status: 422 });
    }
    throw error;
  });

  const [whole, fraction = ""] = rate.split(".");
  const ratePerUsdc = parseUnits(`${whole}.${fraction.slice(0, RATE_DECIMALS)}`, RATE_DECIMALS);
  if (ratePerUsdc === null || ratePerUsdc === 0n) {
    throw new ApiError("provider-unavailable", "The payout provider returned an unusable rate.", { status: 503 });
  }

  const scale = 10n ** BigInt(USDC_DECIMALS + RATE_DECIMALS - NGN_DECIMALS);
  const grossFiat = (inputAmount * ratePerUsdc) / scale;
  const meloFee = (grossFiat * MELO_FEE_BPS) / 10_000n;
  return {
    quoteId: `qt_${randomHex(4)}`,
    inputAmount: inputAmount.toString(),
    inputDecimals: USDC_DECIMALS,
    inputAsset: "USDC",
    fiatCurrency: "NGN",
    fiatDecimals: NGN_DECIMALS,
    grossFiat: grossFiat.toString(),
    providerFee: "0",
    meloFee: meloFee.toString(),
    netFiat: (grossFiat - meloFee).toString(),
    rateDisplay: `1 USDC = ₦${formatUnits(ratePerUsdc, RATE_DECIMALS, 2)}`,
    issuedAt: now,
    expiresAt: now + QUOTE_TTL_MS,
    reservation: "INDICATIVE",
  };
}

function buildAuthorization(intent: StoredIntent, quote: WireQuote): AuthorizationTypedData {
  const chain = getChain(intent.request.chainId);
  return {
    domain: {
      name: "MELO Escrow",
      version: "1",
      chainId: chain.id,
      verifyingContract: chain.escrow ?? SAMPLE_ESCROW_CONTRACT,
    },
    types: {
      IntentAuthorization: [
        { name: "intentId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "recipient", type: "string" },
        { name: "minNetFiat", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    primaryType: "IntentAuthorization",
    message: {
      intentId: intent.id,
      token: chain.usdc.address,
      amount: quote.inputAmount,
      recipient: `${intent.request.recipient.bankCode}:${intent.request.recipient.accountNumber.slice(-4)}`,
      minNetFiat: quote.netFiat,
      nonce: intent.nonce,
      expiry: Math.floor(quote.expiresAt / 1000).toString(),
    },
  };
}

/** The signed-in user's real cash-outs from the MELO backend (`GET /v1/activity`). */
type ActivitySource = {
  list(signal?: AbortSignal): Promise<IntentView[]>;
  get(id: string, signal?: AbortSignal): Promise<IntentView>;
};

const activityRegistry = globalThis as typeof globalThis & { __meloBackendActivity?: ActivitySource | null };

/** Registered while signed in; activity and tracking then show real cash-outs only. */
export function setBackendActivitySource(source: ActivitySource | null) {
  activityRegistry.__meloBackendActivity = source;
}

/** Simulated intents use `int_` ids; anything else is a backend deposit id. */
const isSimulatedId = (id: string) => id.startsWith("int_");

export function createMockApi(): MeloApi {
  return {
    kind: "mock",

    listBanks(options?: RequestOptions) {
      return loadBanks(options?.signal);
    },

    /**
     * Live Paycrest name check. If Paycrest is unreachable, development continues with a
     * placeholder name flagged `verified: false`; the real backend must refuse instead.
     */
    async resolveAccount(recipient: Recipient, options?: RequestOptions): Promise<ResolvedAccount> {
      if (!/^\d{10}$/.test(recipient.accountNumber)) {
        throw new ApiError("validation", "Enter a 10-digit NUBAN account number.", { status: 422 });
      }
      const key = `${recipient.bankCode}:${recipient.accountNumber}`;
      const cached = resolvedAccounts.get(key);
      if (cached) return cached;

      let resolved: ResolvedAccount;
      try {
        const { accountName } = await callRoute<{ accountName: string }>("/api/paycrest/verify-account", {
          method: "POST",
          body: JSON.stringify({ institution: recipient.bankCode, accountIdentifier: recipient.accountNumber }),
          signal: options?.signal,
        });
        resolved = { accountName, verified: true };
      } catch (error) {
        if (!(error instanceof ApiError) || error.code === "validation") {
          throw error instanceof ApiError
            ? new ApiError("validation", "We couldn't find that account at this bank.", { status: 422 })
            : error;
        }
        resolved = { accountName: devPlaceholderName(recipient), verified: false };
      }
      resolvedAccounts.set(key, resolved);
      return resolved;
    },

    async createIntent(request: CreateIntentRequest, options?: RequestOptions): Promise<CreatedIntent> {
      const store = load();
      const existing = options?.idempotencyKey ? store.idempotency[options.idempotencyKey] : undefined;
      if (existing && store.intents[existing]) return { intentId: existing, status: "CREATED" };

      const bank = (await loadBanks(options?.signal)).find((b) => b.code === request.recipient.bankCode);
      if (!bank) throw new ApiError("validation", "Choose a supported bank.", { status: 422 });
      const savedAccount = MASKED_ACCOUNT.test(request.recipient.accountNumber);
      if (savedAccount && !backendQuoteSourceNow()) {
        throw new ApiError("network", "Can't reach MELO to use your saved account. Try again shortly.");
      }
      // A saved account was name-checked by the backend when it was added; the quote returns that name.
      const { accountName } = savedAccount
        ? { accountName: "" }
        : await this.resolveAccount(request.recipient, options);

      const id = `int_${randomHex(5).toUpperCase()}`;
      store.intents[id] = {
        id,
        createdAt: Date.now(),
        request,
        bankName: bank.name,
        accountName,
        nonce: BigInt(`0x${randomHex(8)}`).toString(),
        escrowTxHash: `0x${randomHex(32)}`,
        providerReference: `prv_${randomHex(3).toUpperCase()}`,
        correlationId: `corr_${randomHex(3)}`,
      };
      if (options?.idempotencyKey) store.idempotency[options.idempotencyKey] = id;
      save(store);
      return { intentId: id, status: "CREATED" };
    },

    async requestQuote(intentId: string, options?: RequestOptions): Promise<QuoteOffer> {
      const intent = load().intents[intentId];
      if (!intent) throw new ApiError("not-found", "We couldn't find that cash-out.", { status: 404 });
      if (intent.authorizedAt) throw new ApiError("validation", "This cash-out is already authorized.", { status: 409 });
      const backendQuoteSource = backendQuoteSourceNow();
      const backend = backendQuoteSource
        ? await backendQuoteSource(
            {
              chainId: getChain(intent.request.chainId).id,
              amount: toDecimalString(BigInt(intent.request.inputAmount), USDC_DECIMALS),
            },
            options?.signal,
          )
        : null;
      const quote = backend?.quote ?? (await buildQuote(BigInt(intent.request.inputAmount), Date.now(), options?.signal));
      const store = load();
      const current = store.intents[intentId];
      if (!current) throw new ApiError("not-found", "We couldn't find that cash-out.", { status: 404 });
      current.quote = quote;
      if (backend) {
        current.bankName = backend.payTo.institutionName;
        current.accountName = backend.payTo.accountName;
      }
      save(store);
      return { quote, authorization: buildAuthorization(intent, quote) };
    },

    async authorizeIntent(intentId: string, request: AuthorizeIntentRequest, options?: RequestOptions) {
      await delay(500, options?.signal);
      const store = load();
      const intent = store.intents[intentId];
      if (!intent?.quote) throw new ApiError("not-found", "We couldn't find that cash-out.", { status: 404 });
      if (intent.quote.quoteId !== request.quoteId) {
        throw new ApiError("quote-expired", "A newer quote replaced this one. Review it and sign again.", { status: 409 });
      }
      if (intent.authorizedAt) return toView(intent, Date.now());
      // A confirmed onchain deposit already beat the quote expiry; the escrow contract enforced it.
      if (!request.escrowTxHash && Date.now() >= intent.quote.expiresAt) {
        throw new ApiError("quote-expired", "The quote expired before your signature arrived.", { status: 409 });
      }
      if (request.escrowTxHash) intent.escrowTxHash = request.escrowTxHash;
      intent.authorizedAt = Date.now();
      save(store);
      return toView(intent, Date.now());
    },

    async getIntent(intentId: string, options?: RequestOptions) {
      const backend = activityRegistry.__meloBackendActivity;
      if (backend && !isSimulatedId(intentId)) return backend.get(intentId, options?.signal);
      await delay(120, options?.signal);
      const intent = load().intents[intentId];
      if (!intent?.authorizedAt) throw new ApiError("not-found", "We couldn't find that cash-out.", { status: 404 });
      return toView(intent, Date.now());
    },

    async listActivity(options?: RequestOptions) {
      const backend = activityRegistry.__meloBackendActivity;
      if (backend) return backend.list(options?.signal);
      await delay(150, options?.signal);
      const now = Date.now();
      return Object.values(load().intents)
        .filter((i) => i.authorizedAt)
        .sort((a, b) => (b.authorizedAt ?? 0) - (a.authorizedAt ?? 0))
        .map((i) => toView(i, now));
    },
  };
}
