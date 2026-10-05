"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  LoaderCircle,
  Receipt,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getChain } from "@/lib/chains";
import { shortHex } from "@/lib/money";
import { isApiError, type IntentView } from "@/lib/api";
import { useIntent } from "@/lib/api/queries";
import { deserializeQuote, type IntentStatus } from "@/lib/offramp/model";
import { FailureScreen, type MoneyFact } from "@/components/offramp/failure-screen";
import { FlowHeader } from "@/components/offramp/flow-header";
import {
  DetailRow,
  formatNgn,
  formatUsdc,
  Notice,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
  StatusPill,
  StepActions,
  StepSkeleton,
} from "@/components/offramp/primitives";
import { PaymentSuccessModal } from "@/components/offramp/payment-success-modal";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { markReceiptSeen, resetDraft } from "@/store/offramp-slice";

type StageState = "done" | "active" | "pending" | "failed" | "attention";
type Path = "payout" | "refund" | "attention";

interface Stage {
  title: string;
  detail: string;
  state: StageState;
}

const REFUND_STATUSES: IntentStatus[] = ["PAYOUT_FAILED", "REFUND_PENDING", "REFUNDED"];

function pathFor(status: IntentStatus): Path {
  if (REFUND_STATUSES.includes(status)) return "refund";
  if (status === "RECONCILIATION_REQUIRED") return "attention";
  return "payout";
}

/** Index of the payout-path stage in progress; 5 means everything is done. */
const PAYOUT_PROGRESS: Partial<Record<IntentStatus, number>> = {
  ESCROW_PENDING: 1,
  ESCROWED: 2,
  FIAT_PAYMENT_PENDING: 2,
  PAYMENT_VERIFYING: 3,
  PAYMENT_VERIFIED: 4,
  RELEASE_PENDING: 4,
  SETTLED: 5,
};

function stagesFor(status: IntentStatus, chainName: string): Stage[] {
  const authorized: Stage = { title: "Authorized", detail: "You signed the escrow authorization.", state: "done" };
  const escrowed: Stage = { title: "USDC in escrow", detail: `Deposit confirmed on ${chainName}.`, state: "done" };
  const path = pathFor(status);

  if (path === "refund") {
    const refunded = status === "REFUNDED";
    return [
      authorized,
      escrowed,
      { title: "Naira payout failed", detail: "The provider reported the payout failed. No naira was sent.", state: "failed" },
      {
        title: "Refund from escrow",
        detail: refunded ? "Escrow returned your USDC." : "Escrow is returning your USDC under the refund policy.",
        state: refunded ? "done" : "active",
      },
      {
        title: "USDC back in your wallet",
        detail: refunded ? "The full amount is back where it started." : "Usually within a few minutes.",
        state: refunded ? "done" : "pending",
      },
    ];
  }

  if (path === "attention") {
    return [
      authorized,
      escrowed,
      {
        title: "Payout outcome unknown",
        detail: "The provider hasn't confirmed success or failure. We're checking with them directly.",
        state: "attention",
      },
      { title: "Payment verified", detail: "On hold until the payout is confirmed.", state: "pending" },
      { title: "Escrow released or refunded", detail: "Only after reconciliation.", state: "pending" },
    ];
  }

  const current = PAYOUT_PROGRESS[status] ?? 0;
  const base = [
    authorized,
    { ...escrowed, detail: current <= 1 ? `Waiting for the deposit to confirm on ${chainName}.` : escrowed.detail },
    { title: "Naira payout", detail: "Provider sends naira to your bank.", state: "pending" as StageState },
    { title: "Payment verified", detail: "Provider evidence checked against policy.", state: "pending" as StageState },
    { title: "Escrow released", detail: "Settlement recorded onchain.", state: "pending" as StageState },
  ];
  return base.map((stage, i) => ({ ...stage, state: i < current ? "done" : i === current ? "active" : "pending" }));
}

const HEADLINE: Partial<Record<IntentStatus, string>> = {
  ESCROW_PENDING: "Locking your USDC",
  ESCROWED: "USDC is in escrow",
  FIAT_PAYMENT_PENDING: "Paying your bank",
  PAYMENT_VERIFYING: "Verifying the payout",
  PAYMENT_VERIFIED: "Payout verified",
  RELEASE_PENDING: "Releasing escrow",
  SETTLED: "Cash-out complete",
  PAYOUT_FAILED: "The payout didn't go through",
  REFUND_PENDING: "Refunding your USDC",
  REFUNDED: "Your USDC is back",
  RECONCILIATION_REQUIRED: "We're confirming your payout",
};

function StageIcon({ state }: { state: StageState }) {
  const cls = "size-5 shrink-0";
  return (
    <span key={state} className="melo-pop-in flex">
      {state === "done" ? (
        <CircleCheck className={cn(cls, "text-teal-ink")} aria-hidden />
      ) : state === "active" ? (
        <LoaderCircle className={cn(cls, "animate-spin text-ink motion-reduce:animate-none")} aria-hidden />
      ) : state === "failed" ? (
        <CircleX className={cn(cls, "text-red-600")} aria-hidden />
      ) : state === "attention" ? (
        <CircleAlert className={cn(cls, "text-amber-600")} aria-hidden />
      ) : (
        <CircleDashed className={cn(cls, "text-ink/30")} aria-hidden />
      )}
    </span>
  );
}

export function IntentTracker({ id }: { id: string }) {
  const query = useIntent(id);
  const dispatch = useAppDispatch();
  const draftIntentId = useAppSelector((s) => s.offramp.intentId);
  const intent = query.data;

  useEffect(() => {
    if (intent && draftIntentId === intent.id) dispatch(resetDraft());
  }, [intent, draftIntentId, dispatch]);

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-paper">
      <FlowHeader step="track" />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 sm:pb-12 lg:max-w-5xl lg:px-8 lg:pt-10">
        {intent ? (
          <Tracker intent={intent} />
        ) : query.isError ? (
          isApiError(query.error, "not-found") ? (
            <MissingIntent id={id} />
          ) : (
            <FailureScreen
              title="Can't load this cash-out"
              description={query.error.message}
              facts={[{ kind: "info", text: "This is a connection problem on our side, not a change to your cash-out." }]}
              actions={
                <button type="button" onClick={() => query.refetch()} className={primaryButtonClass}>
                  <RotateCcw className="size-4" aria-hidden /> Try again
                </button>
              }
            />
          )
        ) : (
          <div className="lg:max-w-xl">
            <StepSkeleton />
          </div>
        )}
      </main>
    </div>
  );
}

function MissingIntent({ id }: { id: string }) {
  return (
    <div className="flex flex-1 flex-col gap-6 lg:max-w-xl">
      <h1 className="font-display text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink">
        We can&apos;t find this cash-out
      </h1>
      <p className="text-sm text-muted-foreground">
        <span className="font-mono">{id}</span> doesn&apos;t match any cash-out on this account. Check the link, or start from
        your activity.
      </p>
      <StepActions>
        <Link href="/" className={primaryButtonClass}>
          Back to home
        </Link>
      </StepActions>
    </div>
  );
}

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return { copied, copy };
}

function Tracker({ intent }: { intent: IntentView }) {
  const quote = deserializeQuote(intent.quote);
  const { status } = intent.projection;
  const path = pathFor(status);
  const settled = status === "SETTLED";
  const dispatch = useAppDispatch();
  const receiptSeen = useAppSelector((s) => s.offramp.receiptsSeen.includes(intent.id));
  const showSuccess = settled && !intent.sample && !receiptSeen;
  const { copied, copy } = useCopy(intent.id);
  const reference = useCopy(`${intent.id} · ${intent.correlationId}`);
  const amount = formatUsdc(quote.inputAmount, quote.inputDecimals);
  const bank = `${intent.recipient.bankName} •••• ${intent.recipient.accountLast4}`;

  const facts: MoneyFact[] | null =
    status === "PAYOUT_FAILED" || status === "REFUND_PENDING"
      ? [
          { kind: "safe", text: `No naira was sent to ${bank}.` },
          { kind: "held", text: `${amount} is on its way back from escrow to your wallet.` },
          { kind: "info", text: "You don't need to do anything. This page updates when the refund lands." },
        ]
      : status === "REFUNDED"
        ? [
            { kind: "safe", text: `${amount} was returned to your wallet from escrow.` },
            { kind: "safe", text: `No naira was sent to ${bank}, and no fees were charged.` },
          ]
        : status === "RECONCILIATION_REQUIRED"
          ? [
              { kind: "held", text: `${amount} is held in escrow. It isn't released to anyone until this is resolved.` },
              {
                kind: "info",
                text: "Don't start the same cash-out again. If the first payout did arrive, a second one would pay twice.",
              },
              { kind: "info", text: "Once confirmed, escrow either settles the cash-out or refunds you in full." },
            ]
          : null;

  return (
    <div className="flex flex-1 flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-12">
      <PaymentSuccessModal intent={intent} open={showSuccess} onDismiss={() => dispatch(markReceiptSeen(intent.id))} />

      <div className="flex flex-1 flex-col gap-6 lg:min-h-[calc(100dvh-12rem)]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <StatusPill status={status} />
            <button
              type="button"
              onClick={copy}
              className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-mono text-xs text-muted-foreground hover:text-ink"
              aria-label="Copy intent ID"
            >
              {copied ? "Copied" : intent.id}
              <Copy className="size-3.5" aria-hidden />
            </button>
          </div>
          <h1
            className="text-balance font-display text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink lg:text-[2.25rem]"
            aria-live="polite"
          >
            {HEADLINE[status] ?? status}
          </h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {amount} → {formatNgn(quote.netFiat, quote.fiatDecimals)} to {bank}
            {intent.sample ? " · sample" : ""}
          </p>
        </div>

        <Panel>
          <ol className="flex flex-col">
            {stagesFor(status, getChain(intent.chainId).name).map((stage, i, all) => (
              <li key={stage.title} className="relative flex gap-3 pb-5 last:pb-0">
                {i < all.length - 1 ? (
                  <span
                    className={cn(
                      "absolute bottom-0 left-[9.5px] top-6 w-px transition-colors duration-500",
                      stage.state === "done" ? "bg-teal" : "bg-ink/10",
                    )}
                    aria-hidden
                  />
                ) : null}
                <StageIcon state={stage.state} />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm",
                      stage.state === "pending" ? "text-muted-foreground" : "font-semibold text-ink",
                      stage.state === "failed" && "text-red-700",
                      stage.state === "attention" && "text-amber-800",
                    )}
                  >
                    {stage.title}
                    <span className="sr-only"> ({stage.state})</span>
                  </p>
                  {stage.state !== "pending" || path !== "payout" ? (
                    <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{stage.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        {facts ? (
          <div
            className={cn(
              "rounded-2xl p-4 ring-1 sm:p-5",
              path === "attention" ? "bg-amber-50 ring-amber-200" : "bg-white ring-ink/8",
            )}
            role={path === "attention" ? "alert" : undefined}
          >
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {path === "refund" ? <Undo2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
              Your money
            </h2>
            <ul className="flex flex-col gap-3">
              {facts.map((fact, i) => (
                <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-ink/85">
                  {fact.kind === "safe" ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-teal-ink" aria-hidden />
                  ) : fact.kind === "held" ? (
                    <LoaderCircle
                      className={cn(
                        "mt-0.5 size-4 shrink-0 text-amber-700",
                        path === "refund" && "animate-spin motion-reduce:animate-none",
                      )}
                      aria-hidden
                    />
                  ) : (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-ink/40" aria-hidden />
                  )}
                  <span className="text-pretty">{fact.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div aria-live="polite">
            {status === "FIAT_PAYMENT_PENDING" || status === "PAYMENT_VERIFYING" ? (
              <Notice tone="progress">
                The provider has accepted the payout, but it is <strong>not verified yet</strong>. Your USDC stays in escrow
                until it is.
              </Notice>
            ) : settled ? (
              <Notice tone="success" icon={<CircleCheck aria-hidden />}>
                Payout verified and escrow released. Your receipt is ready.
              </Notice>
            ) : null}
          </div>
        )}

        <div className="lg:hidden">
          <EscrowDetails intent={intent} collapsible />
        </div>

        <StepActions>
          {settled ? (
            <Link href={`/intent/${intent.id}/receipt`} className={primaryButtonClass}>
              <Receipt className="size-4" aria-hidden /> View receipt
            </Link>
          ) : null}
          {path === "attention" ? (
            <button type="button" onClick={reference.copy} className={primaryButtonClass}>
              <Copy className="size-4" aria-hidden /> {reference.copied ? "Reference copied" : "Copy support reference"}
            </button>
          ) : null}
          {status === "REFUNDED" ? (
            <Link href="/cash-out" className={primaryButtonClass}>
              <RotateCcw className="size-4" aria-hidden /> Try another cash-out
            </Link>
          ) : null}
          <Link
            href="/"
            className={settled || path === "attention" || status === "REFUNDED" ? secondaryButtonClass : primaryButtonClass}
          >
            Back to home
          </Link>
          {path === "payout" && !settled ? (
            <p className="text-center text-xs text-muted-foreground">You can leave this page. Progress keeps updating.</p>
          ) : null}
          {path === "attention" ? (
            <p className="text-center text-xs text-muted-foreground">
              Share the reference with support. We&apos;ll never ask for your seed phrase.
            </p>
          ) : null}
        </StepActions>
      </div>

      <aside className="hidden lg:sticky lg:top-40 lg:flex lg:flex-col lg:gap-4" aria-label="Cash-out summary">
        <Panel className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {path === "refund" ? "Refund amount" : settled ? "Recipient got" : "Recipient gets"}
          </p>
          <p className="font-display text-[2rem] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
            {path === "refund" ? amount : formatNgn(quote.netFiat, quote.fiatDecimals)}
          </p>
          <dl className="mt-3 divide-y divide-ink/10 border-t border-ink/10">
            <DetailRow label="You sent" value={amount} />
            <DetailRow label="Rate" value={quote.rateDisplay} />
            <DetailRow label="To" value={intent.recipient.accountName} strong />
            <DetailRow label="Bank" value={bank} />
          </dl>
        </Panel>
        <EscrowDetails intent={intent} />
      </aside>
    </div>
  );
}

function EscrowDetails({ intent, collapsible }: { intent: IntentView; collapsible?: boolean }) {
  const { projection } = intent;
  const rows = (
    <dl className="divide-y divide-ink/10 border-t border-ink/10 px-4">
      <DetailRow label="Network" value={`${getChain(intent.chainId).name} (${getChain(intent.chainId).id})`} />
      <DetailRow label="Escrow tx" value={`${shortHex(intent.escrowTxHash)} (simulated)`} mono />
      <DetailRow label="Confirmations" value={projection.confirmations ? `${projection.confirmations} (final)` : "0"} />
      <DetailRow label="Contract" value={`${shortHex(intent.escrowContract)} (sample)`} mono />
      <DetailRow label="Provider status" value={projection.payoutStatus.replace("_", " ").toLowerCase()} />
      <DetailRow label="Reference" value={intent.providerReference} mono />
      <DetailRow label="Correlation" value={intent.correlationId} mono />
    </dl>
  );

  if (!collapsible) {
    return (
      <div className="rounded-2xl bg-white ring-1 ring-ink/8">
        <h2 className="flex min-h-12 items-center px-4 text-sm font-semibold text-ink">Escrow & payout details</h2>
        {rows}
      </div>
    );
  }

  return (
    <details className="group rounded-2xl bg-white ring-1 ring-ink/8 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-ink">
        Escrow & payout details
        <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      {rows}
    </details>
  );
}
