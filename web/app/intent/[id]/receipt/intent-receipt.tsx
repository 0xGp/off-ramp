"use client";

import Link from "next/link";
import { ArrowLeft, CircleCheck, LifeBuoy, Printer, X } from "lucide-react";
import { deserializeQuote } from "@/lib/offramp/model";
import type { IntentView } from "@/lib/api";
import { useIntent } from "@/lib/api/queries";
import {
  formatNgn,
  Notice,
  primaryButtonClass,
  secondaryButtonClass,
  StepActions,
  StepSkeleton,
} from "@/components/offramp/primitives";
import { ReceiptSummary } from "@/components/offramp/receipt-summary";

const iconLink =
  "flex size-11 items-center justify-center rounded-full text-ink transition-[background-color,scale] duration-150 ease-out hover:bg-ink/5 active:scale-[0.96] print:hidden";

export function IntentReceipt({ id }: { id: string }) {
  const query = useIntent(id);
  const intent = query.data;

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-paper">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur print:static">
        <div className="mx-auto flex h-16 w-full max-w-xl items-center gap-2 px-2 sm:px-4">
          <Link href={`/intent/${id}`} className={iconLink} aria-label="Back to status">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <span className="flex-1 text-center text-sm font-semibold text-ink">Receipt</span>
          <Link href="/" className={iconLink} aria-label="Close receipt">
            <X className="size-5" aria-hidden />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 sm:pb-12">
        {query.isPending ? (
          <StepSkeleton />
        ) : !intent || intent.projection.status !== "SETTLED" ? (
          <div className="flex flex-1 flex-col gap-6">
            <h1 className="font-display text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink">
              {intent?.projection.status === "REFUNDED" ? "Refunded, no receipt" : "No receipt yet"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {intent?.projection.status === "REFUNDED"
                ? "This cash-out was refunded to your wallet, so no payment receipt was issued."
                : "A receipt is issued only after the payout is verified and escrow is released onchain."}
            </p>
            <StepActions>
              <Link href={`/intent/${id}`} className={primaryButtonClass}>
                View status
              </Link>
            </StepActions>
          </div>
        ) : (
          <ReceiptBody intent={intent} />
        )}
      </main>
    </div>
  );
}

function ReceiptBody({ intent }: { intent: IntentView }) {
  const quote = deserializeQuote(intent.quote);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-lime">
          <CircleCheck className="size-7 text-ink" aria-hidden />
        </span>
        <p className="text-sm text-muted-foreground">Paid to {intent.recipient.accountName}</p>
        <p className="font-display text-[2.5rem] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
          {formatNgn(quote.netFiat, quote.fiatDecimals)}
        </p>
        <p className="text-sm text-muted-foreground">
          {intent.recipient.bankName} •••• {intent.recipient.accountLast4}
        </p>
      </div>

      <ReceiptSummary intent={intent} />

      <Notice icon={<LifeBuoy aria-hidden />}>
        Keep the intent ID for support. MELO will never ask for your seed phrase or private key.
      </Notice>

      <StepActions>
        <Link href="/cash-out" className={primaryButtonClass}>
          New cash-out
        </Link>
        <button type="button" onClick={() => window.print()} className={`${secondaryButtonClass} print:hidden`}>
          <Printer className="size-4" aria-hidden /> Save or print
        </button>
      </StepActions>
    </div>
  );
}
