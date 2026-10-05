import { getChain } from "@/lib/chains";
import { shortHex } from "@/lib/money";
import { deserializeQuote } from "@/lib/offramp/model";
import type { IntentView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DetailRow, formatNgn, formatUsdc } from "./primitives";

const dateFormat = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" });

export function ReceiptSummary({ intent, className }: { intent: IntentView; className?: string }) {
  const quote = deserializeQuote(intent.quote);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <dl className="divide-y divide-ink/10 rounded-2xl bg-white px-4 ring-1 ring-ink/8">
        <DetailRow label="You sent" value={formatUsdc(quote.inputAmount, quote.inputDecimals)} />
        <DetailRow label="Rate" value={quote.rateDisplay} />
        {quote.providerFee > 0n ? <DetailRow label="Provider fee" value={formatNgn(quote.providerFee)} /> : null}
        {quote.meloFee > 0n ? <DetailRow label="MELO fee" value={formatNgn(quote.meloFee)} /> : null}
        <DetailRow label="Recipient got" value={formatNgn(quote.netFiat, quote.fiatDecimals)} strong />
      </dl>
      <dl className="divide-y divide-ink/10 rounded-2xl bg-white px-4 ring-1 ring-ink/8">
        <DetailRow label="Paid to" value={`${intent.recipient.bankName} •••• ${intent.recipient.accountLast4}`} />
        <DetailRow label="Authorized" value={dateFormat.format(intent.authorizedAt)} />
        <DetailRow label="Network" value={getChain(intent.chainId).name} />
        <DetailRow label="Intent" value={intent.id} mono />
        <DetailRow label="Provider ref" value={intent.providerReference} mono />
        <DetailRow label="Escrow tx" value={`${shortHex(intent.escrowTxHash)} (simulated)`} mono />
      </dl>
    </div>
  );
}
