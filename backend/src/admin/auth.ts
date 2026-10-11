import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;

/** `scrypt$<salt b64>$<hash b64>`; the format ADMIN_PASSWORD_HASH expects. */
export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, KEY_BYTES, SCRYPT).toString("base64")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

const SESSION_SECONDS = 8 * 60 * 60;
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_IP = 5;
/** Caps guessing from many addresses at once. */
const MAX_FAILURES_TOTAL = 30;

/** One shared admin password; sessions are stateless HMAC-signed expiry times. */
export class AdminAuth {
  readonly #passwordHash: string;
  readonly #secret: string;
  readonly #now: () => number;
  readonly #failures = new Map<string, { count: number; resetAt: number }>();

  constructor(passwordHash: string, sessionSecret: string, now = () => Date.now()) {
    this.#passwordHash = passwordHash;
    this.#secret = sessionSecret;
    this.#now = now;
  }

  readonly maxAgeSeconds = SESSION_SECONDS;

  /** Refuses without checking once this IP, or everyone together, failed too often recently. */
  login(password: string, ip: string): { token: string } | { error: "rate-limited" | "invalid" } {
    const now = this.#now();
    for (const [key, entry] of this.#failures) if (entry.resetAt <= now) this.#failures.delete(key);
    const mine = this.#failures.get(ip)?.count ?? 0;
    const total = this.#failures.get("*")?.count ?? 0;
    if (mine >= MAX_FAILURES_PER_IP || total >= MAX_FAILURES_TOTAL) return { error: "rate-limited" };

    if (!verifyPassword(password, this.#passwordHash)) {
      for (const key of [ip, "*"]) {
        const entry = this.#failures.get(key) ?? { count: 0, resetAt: now + WINDOW_MS };
        entry.count += 1;
        this.#failures.set(key, entry);
      }
      return { error: "invalid" };
    }
    this.#failures.delete(ip);
    const expires = Math.floor(now / 1000) + SESSION_SECONDS;
    return { token: `${expires}.${this.#sign(String(expires))}` };
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const [expires, signature] = token.split(".");
    if (!expires || !signature || !/^\d+$/.test(expires)) return false;
    const expected = Buffer.from(this.#sign(expires));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    return Number(expires) * 1000 > this.#now();
  }

  #sign(value: string): string {
    return createHmac("sha256", this.#secret).update(`melo-admin:${value}`).digest("base64url");
  }
}
