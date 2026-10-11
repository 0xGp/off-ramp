import { runMigrations } from "graphile-worker";

import { ActivityService } from "./activity/service.ts";
import { AdminAuth } from "./admin/auth.ts";
import { OnchainBalances } from "./admin/balances.ts";
import { AdminService } from "./admin/service.ts";
import { PrivyProfileLookup, PrivyTokenVerifier } from "./auth/privy.ts";
import { BankAccountService } from "./bank-accounts/service.ts";
import { QuoteSigner, RpcDepositReader, RpcEscrowSettler } from "./chain/escrow.ts";
import { RpcTreasuryFunder } from "./chain/treasury.ts";
import { PayoutFunding } from "./payouts/funding.ts";
import { PaycrestPayoutProvider } from "./payouts/paycrest.ts";
import { SimulatedPayoutProvider } from "./payouts/provider.ts";
import { PayoutService } from "./payouts/service.ts";
import { ARC_MAINNET, ARC_TESTNET, BASE_SEPOLIA, DEPOSIT_CHAINS } from "./chains.ts";
import { DepositService } from "./deposits/service.ts";
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
  const cipher = new FieldCipher(config.DATA_ENCRYPTION_KEY);
  const bankAccounts = new BankAccountService(db, directory, cipher, {
    freshAuthSeconds: config.FRESH_AUTH_SECONDS,
    changeCooldownHours: config.BANK_CHANGE_COOLDOWN_HOURS,
  });
  const rpcUrls = {
    [ARC_MAINNET]: config.ARC_MAINNET_RPC_URL,
    [ARC_TESTNET]: config.ARC_TESTNET_RPC_URL,
    [BASE_SEPOLIA]: config.BASE_SEPOLIA_RPC_URL,
  };
  const payoutProvider =
    config.PAYOUT_PROVIDER === "paycrest"
      ? new PaycrestPayoutProvider({
          baseUrl: config.PAYCREST_BASE_URL,
          apiKey: config.PAYCREST_API_KEY!,
          refundAddress: (config.PAYCREST_REFUND_ADDRESS ?? config.ESCROW_PAYEE_ADDRESS)!,
        })
      : new SimulatedPayoutProvider({ delaySeconds: config.SIM_PAYOUT_SECONDS, outcome: config.SIM_PAYOUT_OUTCOME });
  const treasury = config.TREASURY_PRIVATE_KEY
    ? new RpcTreasuryFunder(config.TREASURY_PRIVATE_KEY as `0x${string}`, config.BASE_RPC_URL)
    : null;
  const funding =
    config.PAYOUT_FUNDING === "on" && treasury
      ? new PayoutFunding(db, treasury, parseUnits(config.PAYOUT_FUNDING_MAX_USDC, USDC_DECIMALS)!)
      : null;
  const settler = config.ATTESTOR_PRIVATE_KEY
    ? new RpcEscrowSettler(config.ATTESTOR_PRIVATE_KEY as `0x${string}`, rpcUrls)
    : null;
  const admin =
    config.ADMIN_PASSWORD_HASH && config.ADMIN_SESSION_SECRET
      ? {
          auth: new AdminAuth(config.ADMIN_PASSWORD_HASH, config.ADMIN_SESSION_SECRET),
          service: new AdminService(
            db,
            new OnchainBalances({
              treasury,
              fundingCapUsdc: funding ? config.PAYOUT_FUNDING_MAX_USDC : null,
              attestor: settler?.address ?? null,
              chains: Object.values(DEPOSIT_CHAINS).map((chain) => ({
                chain,
                rpcUrls: rpcUrls[chain.id as keyof typeof rpcUrls],
              })),
            }),
          ),
        }
      : null;
  const quotes = new QuoteService(db, directory, bankAccounts, {
    ttlSeconds: config.QUOTE_TTL_SECONDS,
    feeBps: config.MELO_FEE_BPS,
    minUnits: parseUnits(config.QUOTE_MIN_USDC, USDC_DECIMALS)!,
    maxUnits: parseUnits(config.QUOTE_MAX_USDC, USDC_DECIMALS)!,
  });
  return {
    db,
    directory,
    activity: new ActivityService(db, quotes),
    admin,
    funding,
    payouts: new PayoutService(
      db,
      payoutProvider,
      settler,
      undefined,
      payoutProvider.name === "paycrest" ? cipher : null,
    ),
    verifier: new PrivyTokenVerifier(config.PRIVY_APP_ID, config.PRIVY_VERIFICATION_KEY),
    users: new UserService(db, profiles),
    bankAccounts,
    quotes,
    deposits: new DepositService(
      db,
      config.QUOTE_SIGNER_PRIVATE_KEY ? new QuoteSigner(config.QUOTE_SIGNER_PRIVATE_KEY as `0x${string}`) : null,
      new RpcDepositReader(rpcUrls),
      config.ESCROW_PAYEE_ADDRESS
        ? { payee: config.ESCROW_PAYEE_ADDRESS as `0x${string}`, refundDelayMinutes: config.DEPOSIT_REFUND_DELAY_MINUTES }
        : null,
    ),
  };
}
