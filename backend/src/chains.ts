/**
 * Chains a user can deposit from. Escrow addresses come from contracts/deployments/{chainId}.json;
 * USDC addresses match web/lib/chains.ts and docs.arc.io/arc/references/contract-addresses.
 */
export interface DepositChain {
  id: number;
  name: string;
  usdc: `0x${string}`;
  escrow: `0x${string}`;
}

export const ARC_MAINNET = 5042;
export const ARC_TESTNET = 5042002;
export const BASE_SEPOLIA = 84532;

const KNOWN_CHAINS: Record<number, DepositChain> = {
  5042: {
    id: 5042,
    name: "Arc",
    usdc: "0x3600000000000000000000000000000000000000",
    escrow: "0x52e991BeAbEB2DBF9D7090Dcba8AC943D6Ce1A30",
  },
  5042002: {
    id: 5042002,
    name: "Arc Testnet",
    usdc: "0x3600000000000000000000000000000000000000",
    escrow: "0x8C4D6fDe62399ffAC59f94748aD7971d146D7C85",
  },
  84532: {
    id: 84532,
    name: "Base Sepolia",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    escrow: "0x8C4D6fDe62399ffAC59f94748aD7971d146D7C85",
  },
};

/** `DEPOSIT_CHAIN_IDS` (comma-separated) picks the enabled chains: testnets by default, `5042` in production. */
const enabledIds = (process.env.DEPOSIT_CHAIN_IDS ?? `${ARC_TESTNET},${BASE_SEPOLIA}`)
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => id in KNOWN_CHAINS);

export const DEPOSIT_CHAINS: Record<number, DepositChain> = Object.fromEntries(
  enabledIds.map((id) => [id, KNOWN_CHAINS[id]!]),
);

/** Paycrest orders are funded from the MELO treasury on Base, whichever chain the user deposits on. */
export const PAYOUT_NETWORK = "base";
