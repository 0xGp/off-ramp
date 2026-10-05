"use client";

import { useEffect, useRef, useState } from "react";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, useSwitchChain } from "wagmi";
import { useAppSelector } from "@/store/hooks";
import { getChain, type MeloChain } from "./chains";

/** The network the user chose to pay from. */
export function useSelectedChain(): MeloChain {
  return getChain(useAppSelector((s) => s.offramp.chainId));
}

/** App-level view of the signed-in user's wallet, independent of the auth library. */
export function useWallet() {
  const { ready, authenticated } = usePrivy();
  const { address, chainId, status } = useAccount();
  const selected = useSelectedChain();
  const connected = authenticated && status === "connected" && !!address;
  return {
    address: connected ? address : undefined,
    chainId: connected ? chainId : undefined,
    connected,
    signedIn: ready && authenticated,
    /** Connected and on the network selected for this cash-out. */
    onSelectedChain: connected && chainId === selected.id,
    /** True while Privy restores the session or the embedded wallet is being created or connected. */
    settling: !ready || (authenticated && !connected) || status === "reconnecting" || status === "connecting",
  };
}

/**
 * Every signed-in user must end up with a Privy embedded EVM wallet that wagmi treats as active.
 * `createOnLogin` doesn't fire on every login path (and the dashboard default is off), so this
 * creates the wallet when it's missing instead of relying on that setting.
 */
export function useEnsureEmbeddedWallet() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const creating = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const hasEmbedded = !!user?.linkedAccounts.some(
    (a) => a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum",
  );
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  useEffect(() => {
    if (!ready || !authenticated || !user || hasEmbedded || creating.current) return;
    creating.current = true;
    createWallet()
      .catch((err: unknown) => {
        // Another tab or Privy's own createOnLogin may have won the race.
        if (!(err instanceof Error && /already has/i.test(err.message))) {
          setError(err instanceof Error ? err.message : "Couldn't create your wallet.");
        }
      })
      .finally(() => {
        creating.current = false;
      });
  }, [ready, authenticated, user, hasEmbedded, createWallet]);

  useEffect(() => {
    if (walletsReady && embedded && address?.toLowerCase() !== embedded.address.toLowerCase()) {
      void setActiveWallet(embedded);
    }
  }, [walletsReady, embedded, address, setActiveWallet]);

  return { error };
}

/**
 * The embedded wallet switches networks without a prompt, so it simply follows
 * the network the user picked.
 */
export function useFollowSelectedChain() {
  const { connected, chainId } = useWallet();
  const selected = useSelectedChain();
  const { switchChain, isPending, isError, variables } = useSwitchChain();
  // Don't retry a chain that already failed; the step UI offers a manual switch.
  const failedForSelected = isError && variables?.chainId === selected.id;

  useEffect(() => {
    if (connected && chainId !== undefined && chainId !== selected.id && !isPending && !failedForSelected) {
      switchChain({ chainId: selected.id });
    }
  }, [connected, chainId, selected.id, isPending, failedForSelected, switchChain]);
}
