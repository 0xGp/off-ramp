// Moves treasury USDC between Base and Arc mainnet with CCTP v2 + Circle's Forwarding Service
// (Circle submits the destination mint, so the recipient needs no gas). REAL FUNDS.
//
//   node --env-file=.env.production scripts/cctp-transfer.ts --from base --to arc --recipient 0x... --amount 1
//   ...add --yes to actually send (default is a dry run that only prints the plan).
//
// Sources: https://developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service,
// https://docs.arc.io/arc/references/contract-addresses (accessed 2026-10-06).
import { parseArgs } from "node:util";

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  pad,
  parseAbi,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, base } from "viem/chains";

import { formatUnits, parseUnits, USDC_DECIMALS } from "../src/lib/money.ts";

const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
/** "cctp-forward" magic, hook version 0, no extra data. */
const FORWARD_HOOK: Hex = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const IRIS = "https://iris-api.circle.com";
const MAX_AMOUNT_UNITS = 25_000_000n;

interface Side {
  chain: Chain;
  rpc: string;
  domain: number;
  usdc: `0x${string}`;
  /** Arc drops transactions below a 20 gwei maxFeePerGas. */
  minMaxFeePerGas?: bigint;
}

const SIDES: Record<string, Side> = {
  base: {
    chain: base,
    rpc: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    domain: 6,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  arc: {
    chain: arc,
    rpc: process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io",
    domain: 26,
    usdc: "0x3600000000000000000000000000000000000000",
    minMaxFeePerGas: 20_000_000_000n,
  },
};

const messengerAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    recipient: { type: "string" },
    amount: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

const from = SIDES[values.from ?? ""];
const to = SIDES[values.to ?? ""];
if (!from || !to || from === to) throw new Error("--from and --to must be base or arc, and differ");
if (!values.recipient || !isAddress(values.recipient)) throw new Error("--recipient must be an address");
const amount = parseUnits(values.amount ?? "", USDC_DECIMALS);
if (!amount || amount <= 0n || amount > MAX_AMOUNT_UNITS) {
  throw new Error(`--amount must be a USDC amount up to ${formatUnits(MAX_AMOUNT_UNITS, USDC_DECIMALS)}`);
}
const key = process.env.TREASURY_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("TREASURY_PRIVATE_KEY is not set");

const recipient = getAddress(values.recipient);
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: from.chain, transport: http(from.rpc) });
const walletClient = createWalletClient({ account, chain: from.chain, transport: http(from.rpc) });

// Fast transfer where the source offers it (Base); Arc's finality is already instant.
const feeRes = await fetch(`${IRIS}/v2/burn/USDC/fees/${from.domain}/${to.domain}?forward=true`);
if (!feeRes.ok) throw new Error(`Circle fee API ${feeRes.status}`);
const fees = (await feeRes.json()) as { finalityThreshold: number; minimumFee: number; forwardFee: { high: number } }[];
const tier = fees.find((f) => f.finalityThreshold === 1000) ?? fees.find((f) => f.finalityThreshold === 2000);
if (!tier) throw new Error("Circle fee API returned no usable tier");
// minimumFee is in basis points; round the protocol fee up so maxFee always covers it.
const protocolFee = (amount * BigInt(Math.ceil(tier.minimumFee * 100)) + 999_999n) / 1_000_000n;
const maxFee = BigInt(tier.forwardFee.high) + protocolFee;
const total = amount + maxFee;

const [usdcBalance, nativeBalance] = await Promise.all([
  publicClient.readContract({ address: from.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.getBalance({ address: account.address }),
]);

console.log(`From:      treasury ${account.address} on ${from.chain.name} (domain ${from.domain})`);
console.log(`To:        ${recipient} on ${to.chain.name} (domain ${to.domain})`);
console.log(`Arrives:   ${formatUnits(amount, USDC_DECIMALS)} USDC`);
console.log(`Max fee:   ${formatUnits(maxFee, USDC_DECIMALS)} USDC (forwarding + protocol, finality ${tier.finalityThreshold})`);
console.log(`Burns:     ${formatUnits(total, USDC_DECIMALS)} USDC`);
console.log(`Treasury:  ${formatUnits(usdcBalance, USDC_DECIMALS)} USDC, native balance ${nativeBalance}`);
if (usdcBalance < total) throw new Error("treasury USDC balance is too low for this transfer");
if (from.chain.id === base.id && nativeBalance === 0n) throw new Error("treasury has no ETH on Base for gas");
if (!values.yes) {
  console.log("\nDry run. Re-run with --yes to send.");
  process.exit(0);
}

async function feeOverrides() {
  if (!from.minMaxFeePerGas) return {};
  const f = await publicClient.estimateFeesPerGas();
  return {
    maxFeePerGas: f.maxFeePerGas > from.minMaxFeePerGas ? f.maxFeePerGas : from.minMaxFeePerGas,
    maxPriorityFeePerGas: f.maxPriorityFeePerGas,
  };
}

const allowance = await publicClient.readContract({
  address: from.usdc,
  abi: erc20Abi,
  functionName: "allowance",
  args: [account.address, TOKEN_MESSENGER_V2],
});
if (allowance < total) {
  const approveHash = await walletClient.writeContract({
    address: from.usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [TOKEN_MESSENGER_V2, total],
    ...(await feeOverrides()),
  });
  const r = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  if (r.status !== "success") throw new Error(`approve reverted: ${approveHash}`);
  console.log(`approve:   ${approveHash}`);
}

const burnHash = await walletClient.writeContract({
  address: TOKEN_MESSENGER_V2,
  abi: messengerAbi,
  functionName: "depositForBurnWithHook",
  args: [total, to.domain, pad(recipient, { size: 32 }), from.usdc, pad("0x", { size: 32 }), maxFee, tier.finalityThreshold, FORWARD_HOOK],
  ...(await feeOverrides()),
});
const burn = await publicClient.waitForTransactionReceipt({ hash: burnHash });
if (burn.status !== "success") throw new Error(`burn reverted: ${burnHash}`);
console.log(`burn:      ${burnHash}`);

process.stdout.write("waiting for Circle to mint on the destination");
for (let i = 0; i < 600; i++) {
  const res = await fetch(`${IRIS}/v2/messages/${from.domain}?transactionHash=${burnHash}`);
  if (res.ok) {
    const data = (await res.json()) as { messages?: { status?: string; forwardTxHash?: string }[] };
    const forwardTx = data.messages?.[0]?.forwardTxHash;
    if (forwardTx) {
      console.log(`\nmint:      ${forwardTx} on ${to.chain.name}`);
      process.exit(0);
    }
  }
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(`\nStill waiting after 30 min. Track it: ${IRIS}/v2/messages/${from.domain}?transactionHash=${burnHash}`);
