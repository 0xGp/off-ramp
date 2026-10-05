import type { Address, Hex } from "viem";

export const MELO_ESCROW_DOMAIN_NAME = "MeloEscrow";
export const MELO_ESCROW_DOMAIN_VERSION = "1";

export const OUTCOME = {
  PAYOUT_SUCCEEDED: 1,
  PAYOUT_FAILED: 2,
} as const;

export const REFUND_REASON = {
  PAYOUT_FAILED: 0,
  TIMEOUT: 1,
} as const;

export const ESCROW_STATUS = ["NONE", "ESCROWED", "RELEASED", "REFUNDED"] as const;

export const depositTermsTypes = {
  DepositTerms: [
    { name: "intentId", type: "bytes32" },
    { name: "depositor", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "payee", type: "address" },
    { name: "recipientCommitment", type: "bytes32" },
    { name: "quoteExpiry", type: "uint64" },
    { name: "refundAfter", type: "uint64" },
  ],
} as const;

export const attestationTypes = {
  Attestation: [
    { name: "intentId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export type DepositTerms = {
  intentId: Hex;
  depositor: Address;
  token: Address;
  amount: bigint;
  payee: Address;
  recipientCommitment: Hex;
  quoteExpiry: bigint;
  refundAfter: bigint;
};

export type Attestation = {
  intentId: Hex;
  outcome: number;
  evidenceHash: Hex;
  expiry: bigint;
};

/** The domain binds signatures to one chain and one escrow deployment. */
export function meloEscrowDomain(chainId: number, verifyingContract: Address) {
  return {
    name: MELO_ESCROW_DOMAIN_NAME,
    version: MELO_ESCROW_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}
