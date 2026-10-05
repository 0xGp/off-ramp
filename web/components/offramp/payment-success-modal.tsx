"use client";

import Link from "next/link";
import { CircleCheck, Receipt } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getChain } from "@/lib/chains";
import { deserializeQuote } from "@/lib/offramp/model";
import type { IntentView } from "@/lib/api";
import { formatNgn, primaryButtonClass, secondaryButtonClass } from "./primitives";
import { ReceiptSummary } from "./receipt-summary";

/**
 * Shown only once the projection reaches SETTLED, i.e. the payout was verified
 * and escrow released. Never opened on provider acceptance alone.
 */
export function PaymentSuccessModal({
  intent: record,
  open,
  onDismiss,
}: {
  intent: IntentView;
  open: boolean;
  onDismiss: () => void;
}) {
  const quote = deserializeQuote(record.quote);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()} disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto bg-paper p-0 sm:max-w-md"
      >
        <div className="flex flex-col items-center gap-2 px-5 pt-7 pb-5 text-center">
          <span className="melo-pop-in mb-2 flex size-16 items-center justify-center rounded-full bg-lime">
            <CircleCheck className="size-8 text-ink" aria-hidden />
          </span>
          <DialogTitle className="font-display text-2xl font-extrabold leading-tight tracking-[-0.03em] text-ink">
            Payment successful
          </DialogTitle>
          <p className="font-display text-[2.25rem] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
            {formatNgn(quote.netFiat, quote.fiatDecimals)}
          </p>
          <DialogDescription className="text-pretty">
            Paid to <span className="font-semibold text-ink">{record.recipient.accountName}</span>. The payout was
            verified and escrow released on {getChain(record.chainId).name}.
          </DialogDescription>
        </div>

        <div className="px-4 pb-4">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Receipt</p>
          <ReceiptSummary intent={record} />
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-ink/10 bg-paper/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur">
          <button type="button" onClick={onDismiss} className={primaryButtonClass} autoFocus>
            Done
          </button>
          <Link href={`/intent/${record.id}/receipt`} onClick={onDismiss} className={secondaryButtonClass}>
            <Receipt className="size-4" aria-hidden /> View full receipt
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
