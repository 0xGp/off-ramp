"use client";

import { Eye, Lock, ShieldCheck, Undo2 } from "lucide-react";
import { formatUnits, parseUnits, shortHex } from "@/lib/money";
import { USDC_DECIMALS } from "@/lib/offramp/limits";
import { deserializeQuote } from "@/lib/offramp/model";
import { useSelectedChain, useWallet } from "@/lib/use-wallet";
import { useAppSelector } from "@/store/hooks";
import { DetailRow, formatNgn, Panel } from "./primitives";
const PROTECTIONS = [
  { icon: Lock, text: "USDC sits in escrow, not with MELO or the provider." },
  { icon: ShieldCheck, text: "Released only after the naira payout is verified." },
  { icon: Undo2, text: "Refunded to your wallet if the payout fails." },
];

/** Desktop-only rail that keeps the draft in view while the step content changes. */
export function FlowSummary() {
  const { amount, recipient, offer, preview, hydrated } = useAppSelector((s) => s.offramp);
  const wallet = useWallet();
  const chain = useSelectedChain();
  const units = parseUnits(amount, USDC_DECIMALS);
  const quote = offer ? deserializeQuote(offer.quote) : null;

  return (
    <aside className="hidden lg:sticky lg:top-40 lg:flex lg:flex-col lg:gap-4" aria-label="Cash-out summary">
      <Panel className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">Recipient gets</p>
        <p className="font-display text-[2rem] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
          {quote ? formatNgn(quote.netFiat, quote.fiatDecimals) : <span className="text-ink/25">₦—</span>}
        </p>
        <dl className="mt-3 divide-y divide-ink/10 border-t border-ink/10">
          <DetailRow
            label="You send"
            value={hydrated && units !== null && units > 0n ? `${formatUnits(units, USDC_DECIMALS)} USDC` : "—"}
          />
          <DetailRow label="Rate" value={quote?.rateDisplay ?? "After details"} />
          <DetailRow label="To" value={recipient?.accountName ?? "—"} strong={!!recipient} />
          <DetailRow label="Bank" value={recipient ? `${recipient.bankName} •••• ${recipient.accountNumber.slice(-4)}` : "—"} />
          <DetailRow
            label="From"
            value={
              preview ? (
                <span className="inline-flex items-center gap-1">
                  <Eye className="size-3.5" aria-hidden /> Preview
                </span>
              ) : wallet.address ? (
                <span className="font-mono text-xs">{shortHex(wallet.address)}</span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="Network" value={chain.name} />
          <DetailRow label="Payout via" value="Paycrest (Base)" />
        </dl>
      </Panel>

      <ul className="flex flex-col gap-2.5 px-1">
        {PROTECTIONS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
            <Icon className="mt-0.5 size-3.5 shrink-0 text-teal-ink" aria-hidden />
            <span className="text-pretty">{text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
