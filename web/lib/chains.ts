import { defineChain, type Chain } from "viem";
import { arcTestnet as viemArcTestnet, baseSepolia as viemBaseSepolia } from "viem/chains";

export interface MeloChain {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  /** What the wallet pays network fees in. */
  gasToken: "USDC" | "ETH";
  usdc: { address: `0x${string}`; erc20Decimals: 6 };
  /** MeloEscrow from contracts/deployments; null until deployed on this chain. */
  escrow: `0x${string}` | null;
  wagmiChain: Chain;
}

/**
 * Arc Testnet values from https://docs.arc.io/arc/references/connect-to-arc (accessed 2026-09-30).
 * viem's bundled Arc Testnet ships older `*.arc.network` endpoints, and wallets use these URLs
 * verbatim in `wallet_addEthereumChain`, so they're overridden with the official values.
 */
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.io";
const ARC_TESTNET_EXPLORER = "https://explorer.testnet.arc.io";

export const arcTestnet: MeloChain = {
  id: 5042002,
  name: "Arc Testnet",
  rpcUrl: ARC_TESTNET_RPC,
  explorerUrl: ARC_TESTNET_EXPLORER,
  gasToken: "USDC",
  usdc: { address: "0x3600000000000000000000000000000000000000", erc20Decimals: 6 },
  escrow: "0x8C4D6fDe62399ffAC59f94748aD7971d146D7C85",
  wagmiChain: defineChain({
    ...viemArcTestnet,
    rpcUrls: {
      default: {
        http: [ARC_TESTNET_RPC, "https://rpc.blockdaemon.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io"],
        webSocket: ["wss://rpc.testnet.arc.io"],
      },
    },
    blockExplorers: { default: { name: "Arc Explorer", url: ARC_TESTNET_EXPLORER } },
  }),
};

/** Circle's Base Sepolia USDC; chain ID and decimals verified against https://sepolia.base.org (2026-09-30). */
export const baseSepolia: MeloChain = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  explorerUrl: "https://sepolia.basescan.org",
  gasToken: "ETH",
  usdc: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", erc20Decimals: 6 },
  escrow: "0x8C4D6fDe62399ffAC59f94748aD7971d146D7C85",
  wagmiChain: viemBaseSepolia,
};

/** Mainnet parameters are NEEDS_VALIDATION per the handbook; do not add them from memory. */
export const SUPPORTED_CHAINS = [arcTestnet, baseSepolia] as const;
export const DEFAULT_CHAIN = arcTestnet;

export function getChain(chainId: number | null | undefined): MeloChain {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? DEFAULT_CHAIN;
}

export function isSupportedChainId(chainId: number | null | undefined): boolean {
  return SUPPORTED_CHAINS.some((c) => c.id === chainId);
}
