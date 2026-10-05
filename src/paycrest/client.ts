import { AppError } from "../lib/errors.ts";

/**
 * Paycrest aggregator API. Docs: https://docs.paycrest.io/api-reference/introduction (accessed 2026-09-30).
 * Institutions and account verification are keyless; order creation (phase 4) needs a KYB-issued key.
 */
const TIMEOUT_MS = 10_000;
const INSTITUTIONS_TTL_MS = 60 * 60 * 1000;

export interface Institution {
  code: string;
  name: string;
}

export interface BankDirectory {
  listInstitutions(): Promise<Institution[]>;
  /** Returns the account holder name as registered at the bank. */
  verifyAccount(institutionCode: string, accountNumber: string): Promise<string>;
}

export interface SellRate {
  /** NGN per USDC as a decimal string, e.g. "1347.65". */
  rate: string;
  /** Up to three providers, best first; passed to `destination.providerIds` at order creation. */
  providerIds: string[];
}

export interface RateSource {
  /** Off-ramp (sell side) rate for `amount` USDC on `network`. */
  sellRate(network: string, amount: string): Promise<SellRate>;
}

interface Envelope<T> {
  status?: string;
  message?: string;
  data?: T;
}

export class PaycrestClient implements BankDirectory, RateSource {
  readonly #baseUrl: string;
  #institutions: { at: number; value: Promise<Institution[]> } | null = null;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async #call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new AppError("provider-unavailable", "Paycrest is unreachable.");
    }

    let body: Envelope<T> = {};
    try {
      body = (await response.json()) as Envelope<T>;
    } catch {
      // Gateway errors return HTML or empty bodies.
    }

    if (response.status >= 500 || response.status === 429) {
      throw new AppError("provider-unavailable", "Paycrest is temporarily unavailable.");
    }
    if (!response.ok || body.status !== "success" || body.data === undefined) {
      throw new AppError("validation", body.message ?? "Paycrest rejected the request.");
    }
    return body.data;
  }

  listInstitutions(): Promise<Institution[]> {
    const cached = this.#institutions;
    if (cached && Date.now() - cached.at < INSTITUTIONS_TTL_MS) return cached.value;

    const value = this.#call<{ code: string; name: string }[]>("/institutions/NGN").then((rows) =>
      rows.map(({ code, name }) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
    );
    this.#institutions = { at: Date.now(), value };
    value.catch(() => {
      if (this.#institutions?.value === value) this.#institutions = null;
    });
    return value;
  }

  async verifyAccount(institutionCode: string, accountNumber: string): Promise<string> {
    const data = await this.#call<unknown>("/verify-account", {
      method: "POST",
      body: JSON.stringify({ institution: institutionCode, accountIdentifier: accountNumber }),
    });
    const name =
      typeof data === "string"
        ? data
        : typeof data === "object" && data && "accountName" in data && typeof data.accountName === "string"
          ? data.accountName
          : null;
    if (!name?.trim()) throw new AppError("validation", "We couldn't find that account at this bank.");
    // "OK" means the corridor has no name lookup; payouts need a confirmed name, so it can't be saved.
    if (name.trim() === "OK") {
      throw new AppError("validation", "This bank can't confirm account names right now. Try another bank.");
    }
    return name.trim();
  }

  async sellRate(network: string, amount: string): Promise<SellRate> {
    let data: { sell?: { rate?: unknown; providerIds?: unknown } };
    try {
      data = await this.#call(`/rates/${network}/USDC/${amount}/NGN`);
    } catch (error) {
      if (error instanceof AppError && error.code === "validation") {
        throw new AppError("no-route", "No payout partner can fill this amount right now. Try a different amount.");
      }
      throw error;
    }
    const sell = data.sell;
    if (typeof sell?.rate !== "string") {
      throw new AppError("provider-unavailable", "Paycrest returned an unexpected rate.");
    }
    const providerIds = Array.isArray(sell.providerIds)
      ? sell.providerIds.filter((id): id is string => typeof id === "string")
      : [];
    return { rate: sell.rate, providerIds };
  }
}
