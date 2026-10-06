import { defineChain, type Chain } from "viem";
import { arc as viemArc, arcTestnet as viemArcTestnet, baseSepolia as viemBaseSepolia } from "viem/chains";

export interface MeloChain {
  id: number;
  name: string;
  rpcUrl: string;
  /** Tried in order by the relay when `rpcUrl` fails. */
  fallbackRpcUrls: readonly string[];
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
  fallbackRpcUrls: ["https://rpc.quicknode.testnet.arc.io"],
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
  fallbackRpcUrls: [],
  explorerUrl: "https://sepolia.basescan.org",
  gasToken: "ETH",
  usdc: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", erc20Decimals: 6 },
  escrow: "0x8C4D6fDe62399ffAC59f94748aD7971d146D7C85",
  wagmiChain: viemBaseSepolia,
};

/**
 * Arc mainnet values from https://docs.arc.io/arc/references/connect-to-arc (accessed 2026-10-06).
 * dRPC (https://drpc.org/chainlist/arc-mainnet-rpc) is primary for the relay; Circle's endpoint backs it up.
 */
const ARC_MAINNET_RPC = "https://rpc.mainnet.arc.io";
const ARC_MAINNET_DRPC = "https://arc.drpc.org";
const ARC_MAINNET_EXPLORER = "https://explorer.arc.io";

export const arcMainnet: MeloChain = {
  id: 5042,
  name: "Arc",
  rpcUrl: ARC_MAINNET_DRPC,
  fallbackRpcUrls: [ARC_MAINNET_RPC, "https://rpc.quicknode.mainnet.arc.io"],
  explorerUrl: ARC_MAINNET_EXPLORER,
  gasToken: "USDC",
  usdc: { address: "0x3600000000000000000000000000000000000000", erc20Decimals: 6 },
  escrow: "0x52e991BeAbEB2DBF9D7090Dcba8AC943D6Ce1A30",
  wagmiChain: defineChain({
    ...viemArc,
    rpcUrls: {
      default: {
        http: [ARC_MAINNET_RPC, "https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io"],
        webSocket: ["wss://rpc.quicknode.mainnet.arc.io"],
      },
    },
    blockExplorers: { default: { name: "Arc Explorer", url: ARC_MAINNET_EXPLORER } },
  }),
};

/** `NEXT_PUBLIC_MELO_NETWORK=mainnet` serves Arc mainnet only; anything else serves the testnets. */
export const IS_MAINNET = process.env.NEXT_PUBLIC_MELO_NETWORK === "mainnet";
export const SUPPORTED_CHAINS: readonly MeloChain[] = IS_MAINNET ? [arcMainnet] : [arcTestnet, baseSepolia];
export const DEFAULT_CHAIN: MeloChain = SUPPORTED_CHAINS[0]!;

/**
 * In the browser, chain calls go through app/api/chain/[chainId] on our own origin: ad blockers
 * and Brave Shields block public RPC hosts like rpc.mainnet.arc.io. The server uses `rpcUrl`.
 */
export function chainRelayUrl(chain: MeloChain): string {
  return typeof window === "undefined" ? chain.rpcUrl : `${window.location.origin}/api/chain/${chain.id}`;
}

export function getChain(chainId: number | null | undefined): MeloChain {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? DEFAULT_CHAIN;
}

export function isSupportedChainId(chainId: number | null | undefined): boolean {
  return SUPPORTED_CHAINS.some((c) => c.id === chainId);
}
