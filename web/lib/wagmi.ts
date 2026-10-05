import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arcTestnet, baseSepolia } from "./chains";

/** Privy drives the connector state; chains must match `privyConfig.supportedChains`. */
export const wagmiConfig = createConfig({
  chains: [arcTestnet.wagmiChain, baseSepolia.wagmiChain],
  transports: {
    [arcTestnet.id]: http(arcTestnet.rpcUrl),
    [baseSepolia.id]: http(baseSepolia.rpcUrl),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
