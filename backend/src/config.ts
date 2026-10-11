import { z } from "zod";

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

const usdcAmount = z.string().regex(/^\d+(\.\d{1,6})?$/, "must be a USDC decimal amount");

/** One or more RPC URLs, comma-separated; later ones are fallbacks (see `rpcTransport`). */
const rpcUrls = z
  .string()
  .refine((v) => v.split(",").every((u) => URL.canParse(u.trim())), "must be comma-separated URLs");

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  /** `127.0.0.1` behind a local reverse proxy, so the API is only reachable through it. */
  HOST: z.string().min(1).default("0.0.0.0"),
  /** Trust X-Forwarded-For/-Proto from the reverse proxy (client IP for rate limits, https for cookies). */
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** `scrypt$<salt>$<hash>` from scripts/admin-password.ts. Unset disables /v1/admin. */
  ADMIN_PASSWORD_HASH: z
    .string()
    .regex(/^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/, "must come from scripts/admin-password.ts")
    .optional(),
  /** Signs admin session cookies; at least 32 random characters. */
  ADMIN_SESSION_SECRET: z.string().min(32).optional(),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_VERIFICATION_KEY: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PAYCREST_BASE_URL: z.string().url().default("https://api.paycrest.io/v2"),
  /** Sender API key for order creation (`API-Key` header). Mainnet only; spends real USDC. */
  PAYCREST_API_KEY: z.string().min(1).optional(),
  /** Sender API Secret: verifies `X-Paycrest-Signature` on webhooks. */
  PAYCREST_API_SECRET: z.string().min(1).optional(),
  DATA_ENCRYPTION_KEY: base64Key,
  FRESH_AUTH_SECONDS: z.coerce.number().int().positive().default(300),
  BANK_CHANGE_COOLDOWN_HOURS: z.coerce.number().nonnegative().default(24),
  /** The deposit must land onchain before this runs out; it covers the approve and deposit confirmations. */
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(15).max(600).default(180),
  /** PROPOSED pricing: must cover Paycrest's per-order transactionFee, which is only known at order creation. */
  MELO_FEE_BPS: z.coerce.number().int().min(0).max(500).default(30),
  QUOTE_MIN_USDC: usdcAmount.default("1"),
  /** Must not exceed the escrow's per-deposit cap (1000 USDC on the testnet deployments). */
  QUOTE_MAX_USDC: usdcAmount.default("1000"),
  /**
   * Must be the escrow's `quoteSigner`. Testnet only: in production this key lives in a KMS
   * and never in an env file. Unset disables deposits.
   */
  QUOTE_SIGNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
    .optional(),
  /** Receives released escrow funds (the MELO treasury). Unset disables deposits. */
  ESCROW_PAYEE_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be an address")
    .optional(),
  /** Refund opens this long after the quote expires; the contract allows 30 min to 24 h after the deposit. */
  DEPOSIT_REFUND_DELAY_MINUTES: z.coerce.number().int().min(45).max(1380).default(120),
  /**
   * Signs payout outcomes for `settle`. Testnet only: production attestor keys live in a KMS,
   * never in env. Unset leaves escrows untouched after payout (they refund after the delay).
   */
  ATTESTOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
    .optional(),
  /**
   * `paycrest` places real mainnet orders; they are paid only with PAYOUT_FUNDING=on, otherwise
   * they expire and the escrow is refunded. `simulated` touches no bank.
   */
  PAYOUT_PROVIDER: z.enum(["simulated", "paycrest"]).default("simulated"),
  /** Base address Paycrest refunds unpaid orders to; defaults to ESCROW_PAYEE_ADDRESS (the treasury). */
  PAYCREST_REFUND_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be an address")
    .optional(),
  SIM_PAYOUT_SECONDS: z.coerce.number().int().min(0).max(3600).default(15),
  SIM_PAYOUT_OUTCOME: z.enum(["succeeded", "failed"]).default("succeeded"),
  /**
   * MELO treasury on Base mainnet: pays Paycrest orders from its USDC float. REAL FUNDS.
   * Belongs in a KMS in production. Unset (or PAYOUT_FUNDING=off) means orders are never funded.
   */
  TREASURY_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
    .optional(),
  PAYOUT_FUNDING: z.enum(["off", "on"]).default("off"),
  /** Largest single order the treasury will fund automatically, in USDC. */
  PAYOUT_FUNDING_MAX_USDC: usdcAmount.default("5"),
  BASE_RPC_URL: rpcUrls.default("https://mainnet.base.org,https://base-rpc.publicnode.com"),
  /** Read by src/chains.ts at load; listed here so a bad value fails startup. */
  DEPOSIT_CHAIN_IDS: z
    .string()
    .regex(/^\d+(,\d+)*$/, "must be comma-separated chain ids")
    .optional(),
  ARC_MAINNET_RPC_URL: rpcUrls.default(
    "https://arc.drpc.org,https://rpc.mainnet.arc.io,https://rpc.quicknode.mainnet.arc.io",
  ),
  ARC_TESTNET_RPC_URL: rpcUrls.default("https://rpc.testnet.arc.io"),
  BASE_SEPOLIA_RPC_URL: rpcUrls.default("https://sepolia.base.org"),
}).superRefine((c, ctx) => {
  if (!!c.ADMIN_PASSWORD_HASH !== !!c.ADMIN_SESSION_SECRET) {
    ctx.addIssue({ code: "custom", path: ["ADMIN_SESSION_SECRET"], message: "set both ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET" });
  }
  if (c.PAYOUT_FUNDING === "on" && (c.PAYOUT_PROVIDER !== "paycrest" || !c.TREASURY_PRIVATE_KEY)) {
    ctx.addIssue({
      code: "custom",
      path: ["PAYOUT_FUNDING"],
      message: "needs PAYOUT_PROVIDER=paycrest and TREASURY_PRIVATE_KEY",
    });
  }
  if (c.PAYOUT_PROVIDER !== "paycrest") return;
  if (!c.PAYCREST_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["PAYCREST_API_KEY"], message: "required when PAYOUT_PROVIDER=paycrest" });
  }
  if (!c.PAYCREST_REFUND_ADDRESS && !c.ESCROW_PAYEE_ADDRESS) {
    ctx.addIssue({ code: "custom", path: ["PAYCREST_REFUND_ADDRESS"], message: "required when PAYOUT_PROVIDER=paycrest" });
  }
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` in an env file means unset, not an empty value.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    // Names only: values may be secrets.
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return parsed.data;
}
