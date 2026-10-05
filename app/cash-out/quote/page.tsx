"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, Info, LoaderCircle, RotateCcw, Route, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getChain } from "@/lib/chains";
import { deserializeQuote } from "@/lib/offramp/model";
import { useWallet } from "@/lib/use-wallet";
import { FailureScreen } from "@/components/offramp/failure-screen";
import {
  DetailRow,
  formatNgn,
  formatUsdc,
  Notice,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
  StepActions,
  StepHeading,
  StepSkeleton,
} from "@/components/offramp/primitives";
import { useNow } from "@/components/offramp/use-now";
import { useStepGuard } from "@/components/offramp/use-step-guard";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { requestQuote, type FlowError } from "@/store/offramp-slice";

export default function QuoteStep() {
  const { ready } = useStepGuard("quote");
  return ready ? <QuoteReview /> : <StepSkeleton />;
}

function QuoteReview() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { address } = useWallet();
  const { recipient, offer, quoteStatus, quoteError, preview, chainId, amount } = useAppSelector((s) => s.offramp);
  const now = useNow();

  const fetchQuote = () => dispatch(requestQuote({ walletAddress: preview ? null : (address ?? null) }));

  useEffect(() => {
    if (!offer && quoteStatus === "idle") fetchQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only (re)request when no offer exists
  }, [offer, quoteStatus]);

  if (quoteStatus === "error" && quoteError) {
    return <QuoteFailure error={quoteError} onRetry={fetchQuote} onEdit={() => router.push("/cash-out/details")} />;
  }

  if (!offer || quoteStatus === "loading" || !recipient) {
    return <QuoteLoading amount={amount} chainName={getChain(chainId).name} recipient={recipient} />;
  }

  const quote = deserializeQuote(offer.quote);
  const ttl = Math.max(1, quote.expiresAt - quote.issuedAt);
  const remaining = now === null ? ttl : Math.max(0, quote.expiresAt - now);
  const expired = remaining === 0;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <StepHeading title="Review your quote" />

      <Panel className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">Recipient gets</p>
        <p className="font-display text-[2.5rem] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
          {formatNgn(quote.netFiat, quote.fiatDecimals)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          You send <span className="font-semibold text-ink tabular-nums">{formatUsdc(quote.inputAmount, quote.inputDecimals)}</span> on{" "}
          {getChain(chainId).name}
        </p>
      </Panel>

      <dl className="divide-y divide-ink/10">
        <DetailRow label="Rate" value={quote.rateDisplay} />
        <DetailRow label="Gross" value={formatNgn(quote.grossFiat)} />
        <DetailRow label="Provider fee" value={`− ${formatNgn(quote.providerFee)}`} />
        <DetailRow label="MELO fee" value={`− ${formatNgn(quote.meloFee)}`} />
        <DetailRow label="Recipient gets" value={formatNgn(quote.netFiat)} strong />
      </dl>

      <dl className="divide-y divide-ink/10 rounded-2xl bg-white px-4 ring-1 ring-ink/8 lg:hidden">
        <DetailRow label="To" value={recipient.accountName} strong />
        <DetailRow label="Bank" value={`${recipient.bankName} •••• ${recipient.accountNumber.slice(-4)}`} />
      </dl>

      <div aria-live="polite">
        {expired ? (
          <Notice tone="warning" icon={<AlertTriangle aria-hidden />}>
            This quote expired. Rates move, so get a fresh one before you authorize.
          </Notice>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-3.5" aria-hidden /> Quote expires in
              </span>
              <span className="font-semibold text-ink tabular-nums">{now === null ? "—" : `${seconds}s`}</span>
            </div>
            <span className="h-1 overflow-hidden rounded-full bg-ink/10">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
                  seconds <= 15 ? "bg-amber-500" : "bg-teal",
                )}
                style={{ width: `${(remaining / ttl) * 100}%` }}
              />
            </span>
          </div>
        )}
      </div>

      <Notice icon={<Info aria-hidden />}>
        Indicative quote from a sample provider. The rate isn&apos;t reserved until you authorize.
      </Notice>

      <StepActions>
        {expired ? (
          <button type="button" onClick={fetchQuote} className={primaryButtonClass}>
            <RotateCcw className="size-4" aria-hidden /> Get a new quote
          </button>
        ) : (
          <>
            <button type="button" onClick={() => router.push("/cash-out/authorize")} className={primaryButtonClass}>
              Continue to authorize
            </button>
            <button type="button" onClick={() => router.push("/cash-out/details")} className={secondaryButtonClass}>
              Edit details
            </button>
          </>
        )}
      </StepActions>
    </div>
  );
}

const LOADING_STAGES = ["Checking your payout account", "Getting the live rate from Paycrest", "Calculating fees"];
/** When each stage starts, in ms. Purely pacing: the last stage stays active until the quote arrives. */
const STAGE_STARTS = [0, 500, 1300];

function QuoteLoading({
  amount,
  chainName,
  recipient,
}: {
  amount: string;
  chainName: string;
  recipient: { accountName: string; bankName: string; accountNumber: string } | null;
}) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = STAGE_STARTS.slice(1).map((at, i) => setTimeout(() => setStage(i + 1), at));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-6" aria-busy="true">
      <StepHeading title="Finding the best rate" description="This usually takes a couple of seconds." />

      <Panel className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">Recipient gets</p>
        <div className="flex h-10 items-center">
          <span className="h-9 w-44 animate-pulse rounded-lg bg-ink/6 motion-reduce:animate-none" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {amount ? (
            <>
              You send <span className="font-semibold text-ink tabular-nums">{amount} USDC</span> on {chainName}
            </>
          ) : (
            <span className="inline-block h-4 w-40 animate-pulse rounded bg-ink/6 motion-reduce:animate-none" />
          )}
        </p>
      </Panel>

      <ol className="flex flex-col gap-3" aria-live="polite">
        {LOADING_STAGES.map((label, i) => {
          const state = i < stage ? "done" : i === stage ? "active" : "pending";
          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-3 text-sm transition-opacity duration-200 ease-out",
                state === "pending" ? "opacity-40" : "opacity-100",
              )}
            >
              <span className="relative grid size-5 shrink-0 place-items-center" aria-hidden>
                <LoaderCircle
                  className={cn(
                    "absolute size-5 text-teal-ink transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-safe:animate-spin",
                    state === "active" ? "scale-100 opacity-100" : "scale-25 opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "absolute grid size-5 place-items-center rounded-full bg-teal text-white transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
                    state === "done" ? "scale-100 opacity-100" : "scale-25 opacity-0",
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span
                  className={cn(
                    "absolute size-4 rounded-full ring-1 ring-ink/20 transition-opacity duration-200",
                    state === "pending" ? "opacity-100" : "opacity-0",
                  )}
                />
              </span>
              <span className={cn(state === "active" ? "font-medium text-ink" : "text-muted-foreground")}>
                {label}
                {state === "done" ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      {recipient ? (
        <dl className="divide-y divide-ink/10 rounded-2xl bg-white px-4 ring-1 ring-ink/8">
          <DetailRow label="To" value={recipient.accountName || "Your saved account"} strong />
          <DetailRow label="Bank" value={`${recipient.bankName} •••• ${recipient.accountNumber.slice(-4)}`} />
        </dl>
      ) : null}
    </div>
  );
}

function QuoteFailure({ error, onRetry, onEdit }: { error: FlowError; onRetry: () => void; onEdit: () => void }) {
  const nothingLocked = { kind: "safe" as const, text: "Nothing was locked or sent. Your USDC is still in your wallet." };

  if (error.code === "no-route") {
    return (
      <FailureScreen
        icon={Route}
        title="No payout route right now"
        description={error.message}
        facts={[
          nothingLocked,
          { kind: "info", text: "Routes depend on amount, bank and partner availability. A smaller amount or a different bank may work." },
        ]}
        actions={
          <>
            <button type="button" onClick={onEdit} className={primaryButtonClass}>
              Change amount or bank
            </button>
            <button type="button" onClick={onRetry} className={secondaryButtonClass}>
              <RotateCcw className="size-4" aria-hidden /> Try again
            </button>
          </>
        }
      />
    );
  }

  if (error.code === "provider-unavailable" || error.code === "network") {
    return (
      <FailureScreen
        icon={WifiOff}
        title={error.code === "network" ? "Can't reach MELO" : "Payout partner isn't responding"}
        description={error.message}
        facts={[nothingLocked]}
        actions={
          <button type="button" onClick={onRetry} className={primaryButtonClass}>
            <RotateCcw className="size-4" aria-hidden /> Try again
          </button>
        }
      />
    );
  }

  return (
    <FailureScreen
      title="We couldn't get a quote"
      description={error.message}
      facts={[nothingLocked]}
      actions={
        <>
          <button type="button" onClick={onEdit} className={primaryButtonClass}>
            Check your details
          </button>
          <button type="button" onClick={onRetry} className={secondaryButtonClass}>
            <RotateCcw className="size-4" aria-hidden /> Try again
          </button>
        </>
      }
    />
  );
}
