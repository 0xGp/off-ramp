// Sends USDC on Arc mainnet from the admin (DEPLOYER_PRIVATE_KEY in .env.mainnet).
//   node --env-file=.env.mainnet scripts/send-usdc.ts --to 0x... --amount 0.2 [--yes]
// Dry run unless --yes. Capped at 5 USDC per run.
import { parseArgs } from "node:util";

import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseUnits, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const USDC = "0x3600000000000000000000000000000000000000";
const MAX_UNITS = 5_000_000n;
const MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

const { values } = parseArgs({
  options: { to: { type: "string" }, amount: { type: "string" }, yes: { type: "boolean", default: false } },
});
if (!values.to || !values.amount) throw new Error("usage: --to 0x... --amount 0.2 [--yes]");
const to = getAddress(values.to);
const amount = parseUnits(values.amount, 6);
if (amount <= 0n || amount > MAX_UNITS) throw new Error("amount must be between 0 and 5 USDC");

const rpcUrl = process.env.ARC_MAINNET_RPC_URL;
const key = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!rpcUrl || !key) throw new Error("ARC_MAINNET_RPC_URL and DEPLOYER_PRIVATE_KEY must be set");

const chain = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, account, transport: http(rpcUrl) });

if ((await publicClient.getChainId()) !== 5042) throw new Error("RPC is not Arc mainnet");
const balanceOf = (a: `0x${string}`) =>
  publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });

const before = await balanceOf(account.address);
console.log(`from ${account.address}: ${formatUnits(before, 6)} USDC`);
console.log(`send ${formatUnits(amount, 6)} USDC to ${to}`);
if (before < amount + 10_000n) throw new Error("balance too low (keep at least 0.01 USDC for gas)");
if (!values.yes) {
  console.log("dry run; add --yes to send");
  process.exit(0);
}

const fees = await publicClient.estimateFeesPerGas();
const hash = await wallet.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "transfer",
  args: [to, amount],
  maxFeePerGas: fees.maxFeePerGas > MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : MIN_MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`transfer reverted: ${hash}`);
console.log(`sent: https://explorer.arc.io/tx/${hash}`);
console.log(`recipient now ${formatUnits(await balanceOf(to), 6)} USDC`);
