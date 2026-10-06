import { randomBytes } from "node:crypto";

import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from "jose";

import { buildApp } from "../src/api/app.ts";
import { PrivyTokenVerifier, type PrivyProfile, type ProfileLookup } from "../src/auth/privy.ts";
import { BankAccountService } from "../src/bank-accounts/service.ts";
import { createPool, type Db } from "../src/db/pool.ts";
import { FieldCipher } from "../src/lib/crypto.ts";
import { AppError } from "../src/lib/errors.ts";
import type { BankDirectory, Institution, RateSource } from "../src/paycrest/client.ts";
import { QuoteService } from "../src/quotes/service.ts";
import { QuoteSigner, type DepositReader, type DepositReceipt } from "../src/chain/escrow.ts";
import { DepositService } from "../src/deposits/service.ts";
import type { PayoutProvider, PayoutStatus } from "../src/payouts/provider.ts";
import { PayoutService } from "../src/payouts/service.ts";
import { prepareDatabase } from "../src/runtime.ts";
import { UserService } from "../src/users/service.ts";

export const APP_ID = "test-app";
export const PAYEE = "0x000000000000000000000000000000000000bEEF";
export const WEBHOOK_SECRET = "test-paycrest-secret";
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:54329/melo_test";

export async function createSigner() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pem = await exportSPKI(publicKey);
  return {
    pem,
    privateKey,
    token: (opts: { sub: string; iat?: number; exp?: number; aud?: string; iss?: string; key?: CryptoKey }) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ sid: "session-1" })
        .setProtectedHeader({ alg: "ES256" })
        .setSubject(opts.sub)
        .setIssuer(opts.iss ?? "privy.io")
        .setAudience(opts.aud ?? APP_ID)
        .setIssuedAt(opts.iat ?? now)
        .setExpirationTime(opts.exp ?? now + 3600)
        .sign(opts.key ?? privateKey);
    },
  };
}

export class FakeDirectory implements BankDirectory, RateSource {
  institutions: Institution[] = [
    { code: "ABNGNGLA", name: "Access Bank" },
    { code: "GTBINGLA", name: "Guaranty Trust Bank" },
  ];
  names = new Map<string, string>([
    ["ABNGNGLA:0123456789", "ADAEZE OKAFOR"],
    ["GTBINGLA:9876543210", "ADAEZE OKAFOR"],
  ]);
  down = false;
  verifyCalls = 0;

  async listInstitutions() {
    if (this.down) throw new AppError("provider-unavailable", "Paycrest is temporarily unavailable.");
    return this.institutions;
  }

  rate = "1500.25";
  noRoute = false;
  rateCalls: { network: string; amount: string }[] = [];

  async sellRate(network: string, amount: string) {
    this.rateCalls.push({ network, amount });
    if (this.down) throw new AppError("provider-unavailable", "Paycrest is temporarily unavailable.");
    if (this.noRoute) throw new AppError("no-route", "No payout partner can fill this amount right now.");
    return { rate: this.rate, providerIds: ["prov-a", "prov-b"] };
  }

  async verifyAccount(code: string, account: string) {
    this.verifyCalls++;
    if (this.down) throw new AppError("provider-unavailable", "Paycrest is temporarily unavailable.");
    const name = this.names.get(`${code}:${account}`);
    if (!name) throw new AppError("validation", "We couldn't find that account at this bank.");
    return name;
  }
}

export class FakeChain implements DepositReader {
  receipts = new Map<string, DepositReceipt>();
  async receipt(_chainId: number, _escrow: string, txHash: string): Promise<DepositReceipt> {
    return this.receipts.get(txHash) ?? { status: "pending" };
  }
}

/** Paycrest-named provider whose orders stay pending until a webhook says otherwise. */
export class FakePaycrest implements PayoutProvider {
  readonly name = "paycrest";
  orders: string[] = [];
  async create(): Promise<{ orderId: string }> {
    const orderId = `pc-order-${this.orders.length + 1}-${randomBytes(4).toString("hex")}`;
    this.orders.push(orderId);
    return { orderId };
  }
  async status(): Promise<PayoutStatus> {
    return "pending";
  }
}

export class FakeProfiles implements ProfileLookup {
  profiles = new Map<string, Partial<PrivyProfile>>();
  calls = 0;
  async profile(did: string): Promise<PrivyProfile> {
    this.calls++;
    const p = this.profiles.get(did) ?? {};
    return { walletAddress: p.walletAddress ?? null, email: p.email ?? null, name: p.name ?? null };
  }
}

export async function resetDatabase(db: Db) {
  await db.query("drop schema if exists public cascade; drop schema if exists graphile_worker cascade; create schema public;");
  await prepareDatabase(db);
}

export async function createTestApp(opts: { now?: () => Date } = {}) {
  const db = createPool(TEST_DATABASE_URL);
  await resetDatabase(db);
  const signer = await createSigner();
  const directory = new FakeDirectory();
  const profiles = new FakeProfiles();
  const encryptionKey = randomBytes(32).toString("base64");
  const cipher = new FieldCipher(encryptionKey);
  const policy = { freshAuthSeconds: 300, changeCooldownHours: 24 };
  const bankAccounts = new BankAccountService(db, directory, cipher, policy, opts.now);
  const quotePolicy = { ttlSeconds: 90, feeBps: 30, minUnits: 1_000_000n, maxUnits: 1_000_000_000n };
  const quoteSigner = new QuoteSigner(`0x${randomBytes(32).toString("hex")}`);
  const chain = new FakeChain();
  const paycrest = new FakePaycrest();
  const payouts = new PayoutService(db, paycrest, null, opts.now);
  const app = await buildApp({
    db,
    directory,
    verifier: new PrivyTokenVerifier(APP_ID, signer.pem),
    users: new UserService(db, profiles),
    bankAccounts,
    quotes: new QuoteService(db, directory, bankAccounts, quotePolicy, opts.now),
    deposits: new DepositService(db, quoteSigner, chain, { payee: PAYEE, refundDelayMinutes: 120 }, opts.now),
    payouts,
    paycrestWebhookSecret: WEBHOOK_SECRET,
    corsOrigins: ["http://localhost:3000"],
    logger: false,
  });
  return { app, db, signer, directory, profiles, cipher, policy, quoteSigner, chain, paycrest, payouts };
}
