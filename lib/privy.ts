import type { PrivyClientConfig } from "@privy-io/react-auth";
import { DEFAULT_CHAIN, SUPPORTED_CHAINS } from "./chains";

/** Public app ID from the Privy dashboard. The app secret lives only in the backend. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * ADR-0012: Google is the only login method, and every user gets a Privy embedded EVM wallet.
 * The same address is used on Arc and Base.
 */
export const privyConfig: PrivyClientConfig = {
  loginMethods: ["google"],
  embeddedWallets: {
    ethereum: { createOnLogin: "all-users" },
    showWalletUIs: true,
  },
  defaultChain: DEFAULT_CHAIN.wagmiChain,
  supportedChains: SUPPORTED_CHAINS.map((c) => c.wagmiChain),
  appearance: {
    theme: "light",
    accentColor: "#1b1d17",
    landingHeader: "Sign in to MELO",
    walletChainType: "ethereum-only",
  },
};
