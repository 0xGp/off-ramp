"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { OnboardingGate } from "@/components/onboarding-gate";
import { useBackendQuotes } from "@/lib/api/account";
import { PRIVY_APP_ID, privyConfig } from "@/lib/privy";
import { useEnsureEmbeddedWallet, useFollowSelectedChain } from "@/lib/use-wallet";
import { wagmiConfig } from "@/lib/wagmi";
import { makeStore, type AppStore } from "@/store";
import { hydrate, type PersistedOfframp } from "@/store/offramp-slice";

const SESSION_KEY = "melo.offramp.v2";

/** Session-scoped so a refresh mid-flow keeps progress. The bank account number is never persisted. */
function OfframpSession({ store }: { store: AppStore }) {
  useEffect(() => {
    let saved: Partial<PersistedOfframp> | null = null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      saved = raw ? (JSON.parse(raw) as Partial<PersistedOfframp>) : null;
    } catch {
      saved = null;
    }
    store.dispatch(hydrate(saved));

    let last = store.getState().offramp;
    return store.subscribe(() => {
      const current = store.getState().offramp;
      if (current === last) return;
      last = current;
      const { preview, chainId, amount, draftKey, intentId, offer, receiptsSeen } = current;
      const persisted: PersistedOfframp = { preview, chainId, amount, draftKey, intentId, offer, receiptsSeen };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(persisted));
      } catch {
        // Storage can be unavailable (private mode, quota); the flow still works in memory.
      }
    });
  }, [store]);

  return null;
}

function WalletSession() {
  const { error } = useEnsureEmbeddedWallet();
  useFollowSelectedChain();
  useBackendQuotes();
  if (!error) return null;
  return (
    <p role="alert" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg">
      Wallet setup failed: {error}
    </p>
  );
}

function MissingPrivyAppId() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6 text-ink">
      <h1 className="text-xl font-semibold">Privy isn&apos;t configured</h1>
      <p className="text-sm text-muted-foreground">
        Set <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code> in <code className="font-mono">web/.env.local</code>{" "}
        and restart the dev server.
      </p>
    </main>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );

  if (!PRIVY_APP_ID) return <MissingPrivyAppId />;

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <Provider store={store}>
            <OfframpSession store={store} />
            <WalletSession />
            <OnboardingGate />
            {children}
          </Provider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
