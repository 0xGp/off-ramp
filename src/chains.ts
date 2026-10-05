/**
 * Chains a user can deposit from. Escrow addresses come from contracts/deployments/{chainId}.json;
 * USDC addresses match web/lib/chains.ts. Mainnet parameters are NEEDS_VALIDATION: don't add from memory.
 */
export interface DepositChain {
  id: number;
  name: string;
  usdc: `0x${string}`;
  escrow: `0x${string}`;
}

export const DEPOSIT_CHAINS: Record<number, DepositChain> = {
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

/** Paycrest orders are funded from the MELO treasury on Base, whichever chain the user deposits on. */
export const PAYOUT_NETWORK = "base";
