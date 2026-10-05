import { z } from "zod";

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

const usdcAmount = z.string().regex(/^\d+(\.\d{1,6})?$/, "must be a USDC decimal amount");

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_VERIFICATION_KEY: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PAYCREST_BASE_URL: z.string().url().default("https://api.paycrest.io/v2"),
  DATA_ENCRYPTION_KEY: base64Key,
  FRESH_AUTH_SECONDS: z.coerce.number().int().positive().default(300),
  BANK_CHANGE_COOLDOWN_HOURS: z.coerce.number().nonnegative().default(24),
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(15).max(600).default(90),
  /** PROPOSED pricing: must cover Paycrest's per-order transactionFee, which is only known at order creation. */
  MELO_FEE_BPS: z.coerce.number().int().min(0).max(500).default(30),
  QUOTE_MIN_USDC: usdcAmount.default("1"),
  /** Must not exceed the escrow's per-deposit cap (1000 USDC on the testnet deployments). */
  QUOTE_MAX_USDC: usdcAmount.default("1000"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Names only: values may be secrets.
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return parsed.data;
}
