import type { Address } from "viem";

export type ChainDeployConfig = {
  name: string;
  chainId: number;
  usdc: Address;
  /** Per-deposit cap in USDC base units (6 decimals). */
  maxAmount: bigint;
  /** Arc drops transactions below a 20 gwei maxFeePerGas without an error. */
  minMaxFeePerGas?: bigint;
  explorer: string;
};

export const DEPLOY_CONFIG: Record<string, ChainDeployConfig> = {
  arcTestnet: {
    name: "Arc Testnet",
    chainId: 5042002,
    usdc: "0x3600000000000000000000000000000000000000",
    maxAmount: 1_000_000_000n,
    minMaxFeePerGas: 20_000_000_000n,
    explorer: "https://explorer.testnet.arc.io",
  },
  baseSepolia: {
    name: "Base Sepolia",
    chainId: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    maxAmount: 1_000_000_000n,
    explorer: "https://sepolia.basescan.org",
  },
};
