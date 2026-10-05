import { mkdir, writeFile } from "node:fs/promises";

import { network } from "hardhat";
import { getAddress, isAddress, type Address } from "viem";

import { DEPLOY_CONFIG } from "./deploy-config.js";

// Role addresses are public and passed via env; private keys stay in the Hardhat keystore.
//   ESCROW_OWNER=0x...            (multisig outside testnet; must call acceptOwnership)
//   QUOTE_SIGNER_ADDRESS=0x...
//   ATTESTOR_ADDRESSES=0x...,0x...
//   ATTESTOR_THRESHOLD=1
// On testnets, unset roles fall back to the deployer so a single throwaway key can run
// the whole flow. Rotate them later with setQuoteSigner / setAttestor / transferOwnership.
const TESTNETS = new Set(["default", "arcTestnet", "baseSepolia"]);

const { viem, networkName } = await network.create();
const isLocal = networkName === "default";
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const deployerAddress = getAddress(deployer.account.address);

function requireAddress(name: string): Address {
  const value = process.env[name];
  if (!value && TESTNETS.has(networkName)) {
    console.warn(`${name} not set; using deployer ${deployerAddress} (testnet only)`);
    return deployerAddress;
  }
  if (!value || !isAddress(value)) throw new Error(`${name} must be set to an address`);
  return getAddress(value);
}

// Local rehearsal: in-memory chain with a mock USDC; nothing is written to deployments/.
const config = isLocal
  ? {
      name: "Local rehearsal",
      chainId: await publicClient.getChainId(),
      usdc: (await viem.deployContract("MockUSDC")).address,
      maxAmount: 1_000_000_000n,
      minMaxFeePerGas: undefined,
      explorer: "",
    }
  : DEPLOY_CONFIG[networkName];
if (!config) throw new Error(`No deploy config for network "${networkName}"`);

const chainId = await publicClient.getChainId();
if (chainId !== config.chainId) throw new Error(`RPC chain ${chainId} does not match ${config.chainId}`);

const owner = requireAddress("ESCROW_OWNER");
const quoteSigner = requireAddress("QUOTE_SIGNER_ADDRESS");
const attestors = (process.env.ATTESTOR_ADDRESSES || (TESTNETS.has(networkName) ? deployerAddress : ""))
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean)
  .map((a) => {
    if (!isAddress(a)) throw new Error(`Invalid attestor address ${a}`);
    return getAddress(a);
  });
const threshold = BigInt(process.env.ATTESTOR_THRESHOLD ?? "1");
if (attestors.length === 0) throw new Error("ATTESTOR_ADDRESSES must list at least one address");

async function feeOverrides() {
  if (!config.minMaxFeePerGas) return {};
  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas > config.minMaxFeePerGas ? fees.maxFeePerGas : config.minMaxFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

console.log(`Deploying MeloEscrow to ${config.name} (${chainId}) from ${deployer.account.address}`);

const { contract: escrow, deploymentTransaction } = await viem.sendDeploymentTransaction(
  "MeloEscrow",
  [deployer.account.address, quoteSigner, attestors, threshold],
  await feeOverrides(),
);
const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
console.log(`MeloEscrow at ${escrow.address} (block ${receipt.blockNumber})`);

await publicClient.waitForTransactionReceipt({
  hash: await escrow.write.configureToken([config.usdc, config.maxAmount], await feeOverrides()),
});
console.log(`USDC ${config.usdc} accepted, cap ${config.maxAmount}`);

if (owner !== deployerAddress) {
  await publicClient.waitForTransactionReceipt({
    hash: await escrow.write.transferOwnership([owner], await feeOverrides()),
  });
  console.log(`Ownership offered to ${owner}; it must call acceptOwnership()`);
}

const record = {
  network: networkName,
  chainId,
  escrow: escrow.address,
  usdc: config.usdc,
  deployBlock: receipt.blockNumber.toString(),
  deployTx: deploymentTransaction.hash,
  owner,
  quoteSigner,
  attestors,
  threshold: threshold.toString(),
  maxAmount: config.maxAmount.toString(),
  explorer: `${config.explorer}/address/${escrow.address}`,
  deployedAt: new Date().toISOString(),
};

if (isLocal) {
  console.log("Local rehearsal finished:", record);
  process.exit(0);
}

await mkdir("deployments", { recursive: true });
await writeFile(`deployments/${chainId}.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(`Wrote deployments/${chainId}.json. Run \`npm run export\` to refresh exports/.`);
