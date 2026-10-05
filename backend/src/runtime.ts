import { runMigrations } from "graphile-worker";

import { PrivyProfileLookup, PrivyTokenVerifier } from "./auth/privy.ts";
import { BankAccountService } from "./bank-accounts/service.ts";
import type { Config } from "./config.ts";
import { migrate } from "./db/migrate.ts";
import { createPool, type Db } from "./db/pool.ts";
import { FieldCipher } from "./lib/crypto.ts";
import { parseUnits, USDC_DECIMALS } from "./lib/money.ts";
import { PaycrestClient } from "./paycrest/client.ts";
import { QuoteService } from "./quotes/service.ts";
import { UserService } from "./users/service.ts";

/** Brings the schema (ours and graphile-worker's) up to date before serving. */
export async function prepareDatabase(db: Db): Promise<void> {
  await migrate(db);
  await runMigrations({ pgPool: db });
}

export function createServices(config: Config, db: Db = createPool(config.DATABASE_URL)) {
  const directory = new PaycrestClient(config.PAYCREST_BASE_URL);
  const profiles = config.PRIVY_APP_SECRET ? new PrivyProfileLookup(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET) : null;
  const bankAccounts = new BankAccountService(db, directory, new FieldCipher(config.DATA_ENCRYPTION_KEY), {
    freshAuthSeconds: config.FRESH_AUTH_SECONDS,
    changeCooldownHours: config.BANK_CHANGE_COOLDOWN_HOURS,
  });
  return {
    db,
    directory,
    verifier: new PrivyTokenVerifier(config.PRIVY_APP_ID, config.PRIVY_VERIFICATION_KEY),
    users: new UserService(db, profiles),
    bankAccounts,
    quotes: new QuoteService(db, directory, bankAccounts, {
      ttlSeconds: config.QUOTE_TTL_SECONDS,
      feeBps: config.MELO_FEE_BPS,
      minUnits: parseUnits(config.QUOTE_MIN_USDC, USDC_DECIMALS)!,
      maxUnits: parseUnits(config.QUOTE_MAX_USDC, USDC_DECIMALS)!,
    }),
  };
}
