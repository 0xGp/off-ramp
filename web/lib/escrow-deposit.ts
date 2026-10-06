"use client";

import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { erc20Abi, isAddressEqual, parseAbi, type Address, type Hex } from "viem";
import { getAccount, readContract, switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { ApiError } from "@/lib/api/errors";
import { BackendError, backendFetch, toFlowApiError } from "@/lib/api/account";
import { getChain, IS_MAINNET } from "@/lib/chains";
import { formatUnits } from "@/lib/money";
import { wagmiConfig } from "@/lib/wagmi";

/** The parts of MeloEscrow (contracts/contracts/MeloEscrow.sol) the app calls. */
const escrowAbi = parseAbi([
  "struct DepositTerms { bytes32 intentId; address depositor; address token; uint256 amount; address payee; bytes32 recipientCommitment; uint64 quoteExpiry; uint64 refundAfter; }",
  "function deposit(DepositTerms terms, bytes quoteSignature)",
]);

/** Mirrors the backend's DepositView; uint values arrive as decimal strings. */
export interface BackendDeposit {
  id: string;
  quoteId: string;
  chainId: number;
  escrow: Address;
  status: "awaiting_deposit" | "escrowed";
  terms: {
    intentId: Hex;
    depositor: Address;
    token: Address;
    amount: string;
    payee: Address;
    recipientCommitment: Hex;
    quoteExpiry: string;
    refundAfter: string;
  };
  signature: Hex;
  txHash: Hex | null;
}

export type DepositPhase = "preparing" | "switching" | "approving" | "depositing" | "confirming";

/** A wallet-side problem the user can act on, as opposed to an API error. */
export class DepositError extends Error {
  constructor(
    readonly code: "wrong-wallet" | "insufficient-funds" | "reverted",
    message: string,
  ) {
    super(message);
  }
}

const CONFIRM_ATTEMPTS = 5;

/**
 * Locks the quoted USDC in MeloEscrow from the signed-in Privy wallet: MELO signs the
 * DepositTerms, the wallet approves (only if the allowance is short) and deposits, and the
 * backend confirms the `Deposited` event before the flow moves on.
 */
export function useEscrowDeposit() {
  const { getAccessToken } = usePrivy();

  return useCallback(
    async (quoteId: string, onPhase: (phase: DepositPhase) => void) => {
      const call = async <T>(path: string, init?: RequestInit) => {
        const token = await getAccessToken();
        if (!token) throw new ApiError("validation", "Sign in again to continue.", { status: 401 });
        try {
          return await backendFetch<T>(path, token, init);
        } catch (error) {
          throw error instanceof BackendError ? toFlowApiError(error) : error;
        }
      };

      onPhase("preparing");
      const { deposit } = await call<{ deposit: BackendDeposit }>(`/v1/quotes/${quoteId}/deposit`, { method: "POST" });
      if (deposit.status === "escrowed" && deposit.txHash) return { deposit, txHash: deposit.txHash };

      // A deposit already sent from this browser only needs confirming; sending it again would revert.
      const sentKey = `melo:deposit-tx:${deposit.id}`;
      const sent = window.localStorage.getItem(sentKey) as Hex | null;
      if (sent) {
        onPhase("confirming");
        return confirmWithBackend(deposit.id, sent);
      }

      const chain = getChain(deposit.chainId);
      const amount = BigInt(deposit.terms.amount);
      const account = getAccount(wagmiConfig);
      if (!account.address || !isAddressEqual(account.address, deposit.terms.depositor)) {
        throw new DepositError("wrong-wallet", "Your MELO wallet isn't the active wallet. Sign out and back in, then try again.");
      }

      if (account.chainId !== deposit.chainId) {
        onPhase("switching");
        await switchChain(wagmiConfig, { chainId: deposit.chainId as typeof chain.id });
      }
      const chainId = deposit.chainId as (typeof wagmiConfig)["chains"][number]["id"];

      const [balance, allowance] = await Promise.all([
        readContract(wagmiConfig, {
          chainId,
          address: deposit.terms.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        }),
        readContract(wagmiConfig, {
          chainId,
          address: deposit.terms.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, deposit.escrow],
        }),
      ]);
      if (balance < amount) {
        throw new DepositError(
          "insufficient-funds",
          `You need ${formatUnits(amount, 6, 2)} USDC on ${chain.name} but have ${formatUnits(balance, 6, 2)}. ` +
            (IS_MAINNET
              ? `Send USDC on ${chain.name} to your MELO wallet${chain.gasToken === "USDC" ? ", plus a little extra for the network fee" : ""}.`
              : `Get test USDC at faucet.circle.com${chain.gasToken === "USDC" ? " (it also pays the network fee)" : ""}.`),
        );
      }

      if (allowance < amount) {
        onPhase("approving");
        const approval = await writeContract(wagmiConfig, {
          chainId,
          address: deposit.terms.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [deposit.escrow, amount],
        });
        const approved = await waitForTransactionReceipt(wagmiConfig, { chainId, hash: approval });
        if (approved.status !== "success") throw new DepositError("reverted", "The USDC approval failed onchain.");
      }

      onPhase("depositing");
      const { terms } = deposit;
      const txHash = await writeContract(wagmiConfig, {
        chainId,
        address: deposit.escrow,
        abi: escrowAbi,
        functionName: "deposit",
        args: [
          {
            ...terms,
            amount,
            quoteExpiry: BigInt(terms.quoteExpiry),
            refundAfter: BigInt(terms.refundAfter),
          },
          deposit.signature,
        ],
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { chainId, hash: txHash });
      if (receipt.status !== "success") {
        throw new DepositError("reverted", "The deposit failed onchain, so no USDC was locked. Get a new quote and try again.");
      }
      window.localStorage.setItem(sentKey, txHash);

      onPhase("confirming");
      const result = await confirmWithBackend(deposit.id, txHash);
      window.localStorage.removeItem(sentKey);
      return result;

      async function confirmWithBackend(depositId: string, hash: Hex) {
        for (let attempt = 1; ; attempt++) {
          try {
            const confirmed = await call<{ deposit: BackendDeposit }>(`/v1/deposits/${depositId}/confirm`, {
              method: "POST",
              body: JSON.stringify({ txHash: hash }),
            });
            return { deposit: confirmed.deposit, txHash: hash };
          } catch (error) {
            // The backend's RPC can trail the wallet's by a block or two.
            if (!(error instanceof ApiError && error.code === "chain-pending") || attempt >= CONFIRM_ATTEMPTS) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          }
        }
      }
    },
    [getAccessToken],
  );
}
