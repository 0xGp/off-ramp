import { importSPKI, jwtVerify, type CryptoKey } from "jose";
import { getAddress, isAddress } from "viem";

import { AppError } from "../lib/errors.ts";

/**
 * Privy access tokens are ES256 JWTs: `iss` = "privy.io", `aud` = app ID, `sub` = user DID.
 * Docs: https://docs.privy.io/authentication/user-authentication/access-tokens (accessed 2026-09-30).
 * Verified locally against the dashboard verification key, so no Privy call per request.
 */
export interface AuthClaims {
  userDid: string;
  sessionId: string | null;
  issuedAt: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthClaims>;
}

export class PrivyTokenVerifier implements TokenVerifier {
  readonly #appId: string;
  readonly #key: Promise<CryptoKey>;

  constructor(appId: string, verificationKeyPem: string) {
    this.#appId = appId;
    this.#key = importSPKI(verificationKeyPem.replace(/\\n/g, "\n"), "ES256");
  }

  async verify(token: string): Promise<AuthClaims> {
    try {
      const { payload } = await jwtVerify(token, await this.#key, {
        issuer: "privy.io",
        audience: this.#appId,
        algorithms: ["ES256"],
      });
      if (!payload.sub || typeof payload.iat !== "number") throw new Error("missing claims");
      return {
        userDid: payload.sub,
        sessionId: typeof payload.sid === "string" ? payload.sid : null,
        issuedAt: payload.iat,
      };
    } catch {
      throw new AppError("unauthenticated", "Your session has expired. Sign in again.");
    }
  }
}

export interface PrivyProfile {
  /** The user's Privy embedded Ethereum wallet (checksummed), or null if none exists yet. */
  walletAddress: string | null;
  email: string | null;
  name: string | null;
}

export interface ProfileLookup {
  profile(userDid: string): Promise<PrivyProfile>;
}

interface PrivyLinkedAccount {
  type?: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  connector_type?: string;
  email?: string;
  name?: string | null;
}

/** GET /v1/users/{user_id} with app-secret basic auth (docs.privy.io/api-reference/users/get). */
export class PrivyProfileLookup implements ProfileLookup {
  readonly #appId: string;
  readonly #authorization: string;

  constructor(appId: string, appSecret: string) {
    this.#appId = appId;
    this.#authorization = `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`;
  }

  async profile(userDid: string): Promise<PrivyProfile> {
    let response: Response;
    try {
      response = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(userDid)}`, {
        headers: { Authorization: this.#authorization, "privy-app-id": this.#appId },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError("provider-unavailable", "Privy is unreachable.");
    }
    if (!response.ok) throw new AppError("provider-unavailable", `Privy user lookup failed (${response.status}).`);

    const user = (await response.json()) as { linked_accounts?: PrivyLinkedAccount[] };
    const accounts = user.linked_accounts ?? [];
    const wallet = accounts.find(
      (a) =>
        a.type === "wallet" &&
        a.chain_type === "ethereum" &&
        a.wallet_client_type === "privy" &&
        a.connector_type === "embedded",
    );
    const google = accounts.find((a) => a.type === "google_oauth");
    return {
      walletAddress: wallet?.address && isAddress(wallet.address) ? getAddress(wallet.address) : null,
      email: google?.email ?? null,
      name: google?.name ?? null,
    };
  }
}
