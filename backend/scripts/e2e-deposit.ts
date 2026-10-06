/**
 * Development end-to-end check on Arc Testnet: live Paycrest quote → MELO-signed DepositTerms →
 * real approve + deposit into MeloEscrow → backend confirmation from the receipt.
 *
 * The depositor must sign the deposit itself, so this uses a test user whose wallet is the
 * quote signer's address (testnet deployer). Never run against production.
 *
 *   node --env-file=.env scripts/e2e-deposit.ts [amountUsdc]
 */
import { createPublicClient, createWalletClient, erc20Abi, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { escrowAbi } from "../src/chain/escrow.ts";
import { ARC_TESTNET, DEPOSIT_CHAINS } from "../src/chains.ts";
import { loadConfig } from "../src/config.ts";
import { FieldCipher } from "../src/lib/crypto.ts";
import { createServices, prepareDatabase } from "../src/runtime.ts";
import type { User } from "../src/users/service.ts";

const amount = process.argv[2] ?? "1";
const config = loadConfig();
if (!config.QUOTE_SIGNER_PRIVATE_KEY) throw new Error("QUOTE_SIGNER_PRIVATE_KEY is not set");

const chain = DEPOSIT_CHAINS[ARC_TESTNET]!;
const account = privateKeyToAccount(config.QUOTE_SIGNER_PRIVATE_KEY as Hex);
const transport = http(config.ARC_TESTNET_RPC_URL);
const arc = { id: chain.id, name: chain.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [config.ARC_TESTNET_RPC_URL] } } };
const publicClient = createPublicClient({ chain: arc, transport });
const wallet = createWalletClient({ account, chain: arc, transport });

const services = createServices(config);
const { db } = services;
await prepareDatabase(db);

const step = (label: string, data?: unknown) => console.log(`\n▸ ${label}`, data ?? "");

try {
  const { rows } = await db.query<{ id: string }>(
    `insert into users (privy_did, wallet_address, email, display_name)
     values ('did:melo:e2e-deployer', $1, 'e2e@melo.test', 'E2E Test')
     on conflict (privy_did) do update set wallet_address = excluded.wallet_address
     returning id`,
    [account.address],
  );
  const userId = rows[0]!.id;
  const bank = await db.query(`select 1 from bank_accounts where user_id = $1 and status = 'active'`, [userId]);
  if (bank.rowCount === 0) {
    const cipher = new FieldCipher(config.DATA_ENCRYPTION_KEY);
    await db.query(
      `insert into bank_accounts (user_id, institution_code, institution_name, account_name, account_last4,
         account_number_ciphertext, account_fingerprint, verified_at, usable_from, status)
       values ($1, 'E2ETEST', 'E2E Test Bank', 'E2E TEST', '0000', $2, $3, now(), now(), 'active')`,
      [userId, cipher.encrypt("0000000000"), cipher.fingerprint("E2ETEST", "0000000000")],
    );
  }
  const user: User = {
    id: userId,
    privyDid: "did:melo:e2e-deployer",
    walletAddress: account.address,
    email: "e2e@melo.test",
    displayName: "E2E Test",
    onboardedAt: null,
  } as User;
  step("Test user", { id: userId, wallet: account.address });

  const quote = await services.quotes.create(user, { chainId: chain.id, amount });
  step("Quote (live Paycrest rate)", {
    id: quote.id,
    amountUsdc: amount,
    rate: quote.rate,
    netNgnKobo: quote.fiat.net,
    expiresAt: quote.expiresAt,
  });

  const deposit = await services.deposits.prepare(user, quote.id);
  step("DepositTerms signed", { depositId: deposit.id, intentId: deposit.terms.intentId, refundAfter: deposit.terms.refundAfter });

  const units = BigInt(deposit.terms.amount);
  const allowance = await publicClient.readContract({
    address: chain.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, chain.escrow],
  });
  if (allowance < units) {
    const approveHash = await wallet.writeContract({
      address: chain.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [chain.escrow, units],
    });
    const approved = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    step("Approved", { tx: approveHash, status: approved.status });
  } else {
    step("Allowance already sufficient");
  }

  const t = deposit.terms;
  const txHash = await wallet.writeContract({
    address: chain.escrow,
    abi: escrowAbi,
    functionName: "deposit",
    args: [
      { ...t, amount: units, quoteExpiry: BigInt(t.quoteExpiry), refundAfter: BigInt(t.refundAfter) },
      deposit.signature,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  step("Deposit transaction", { tx: txHash, status: receipt.status, block: receipt.blockNumber });

  const confirmed = await services.deposits.confirm(user, deposit.id, txHash);
  step("Backend confirmation", { status: confirmed.status, escrowedAt: confirmed.escrowedAt });

  const escrow = await publicClient.readContract({
    address: chain.escrow,
    abi: parseAbi([
      "struct Escrow { address depositor; uint64 refundAfter; uint8 status; address token; address payee; uint256 amount; }",
      "function getEscrow(bytes32 intentId) view returns (Escrow)",
    ]),
    functionName: "getEscrow",
    args: [t.intentId],
  });
  step("Onchain escrow", { status: ["None", "Escrowed", "Released", "Refunded"][escrow.status], amount: escrow.amount });
  console.log(`Explorer: https://explorer.testnet.arc.io/tx/${txHash}`);

  // The running worker (npm run dev) picks up the payout job queued by the confirmation.
  step("Waiting for the worker: simulated payout, then settle on Arc…");
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    const { rows } = await db.query<{ deposit: string; payout: string | null; settle_tx_hash: string | null }>(
      `select d.status as deposit, p.status as payout, p.settle_tx_hash
       from deposits d left join payouts p on p.deposit_id = d.id where d.id = $1`,
      [deposit.id],
    );
    const state = rows[0]!;
    const line = `deposit=${state.deposit} payout=${state.payout ?? "not started"}${state.settle_tx_hash ? ` settleTx=${state.settle_tx_hash}` : ""}`;
    if (line !== last) console.log(`  ${line}`);
    last = line;
    if (state.deposit === "released" || state.deposit === "refunded") {
      console.log(`Settlement: https://explorer.testnet.arc.io/tx/${state.settle_tx_hash}`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!/released|refunded/.test(last)) console.log("Not settled within 2 minutes. Is the worker running (npm run dev)?");
} finally {
  await db.end();
}
