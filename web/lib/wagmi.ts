import { createConfig } from "@privy-io/wagmi";
import type { Chain } from "viem";
import { http, type Transport } from "wagmi";
import { chainRelayUrl, SUPPORTED_CHAINS } from "./chains";

const chains = SUPPORTED_CHAINS.map((c) => c.wagmiChain) as [Chain, ...Chain[]];

/** Privy drives the connector state; chains must match `privyConfig.supportedChains`. */
export const wagmiConfig = createConfig({
  chains,
  transports: Object.fromEntries(SUPPORTED_CHAINS.map((c) => [c.id, http(chainRelayUrl(c))])) as Record<
    number,
    Transport
  >,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
