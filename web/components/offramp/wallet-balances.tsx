"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { erc20Abi } from "viem";
import { useReadContracts } from "wagmi";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { formatUnits } from "@/lib/money";
import { useWallet } from "@/lib/use-wallet";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The signed-in MELO wallet's USDC on every network this deployment serves. */
export function WalletBalances() {
  const { address, signedIn, settling } = useWallet();
  const [copied, setCopied] = useState(false);
  const balances = useReadContracts({
    contracts: SUPPORTED_CHAINS.map((c) => ({
      chainId: c.id,
      address: c.usdc.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address!] as const,
    })),
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  if (!signedIn) {
    return <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">Sign in to see your wallet balance.</p>;
  }
  if (settling || !address) {
    return <div className="h-24 animate-pulse rounded-xl bg-ink/5 motion-reduce:animate-none" />;
  }

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {SUPPORTED_CHAINS.map((chain, i) => {
          const result = balances.data?.[i];
          const units = result?.status === "success" ? (result.result as bigint) : null;
          return (
            <li key={chain.id} className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">USDC on {chain.name}</span>
              <span className="font-display text-2xl font-extrabold tracking-[-0.03em] text-ink tabular-nums">
                {balances.isPending ? (
                  <span className="inline-block h-7 w-20 animate-pulse rounded-md bg-ink/5 align-middle motion-reduce:animate-none" />
                ) : units === null ? (
                  <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                ) : (
                  formatUnits(units, chain.usdc.erc20Decimals, 2)
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2">
        <span className="min-w-0 truncate font-mono text-xs text-ink" title={address}>
          {short(address)}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-ink transition-colors hover:bg-white active:scale-[0.96]"
            aria-label="Copy wallet address"
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`${SUPPORTED_CHAINS[0]!.explorerUrl}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-ink transition-colors hover:bg-white"
          >
            Explorer <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </span>
      </div>
    </div>
  );
}
