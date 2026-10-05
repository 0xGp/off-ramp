"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Quote",
    state: "QUOTE_AVAILABLE",
    authority: "MELO router",
    body: "Provider quotes are normalised into net naira, fees and an expiry. A quote is a price, not a reservation of liquidity.",
  },
  {
    title: "Escrow",
    state: "ESCROWED",
    authority: "Arc escrow contract",
    body: "The user signs once and USDC is locked in the escrow contract. No payout starts until that deposit is observed onchain.",
  },
  {
    title: "Payout",
    state: "FIAT_PAYMENT_PENDING",
    authority: "Provider and bank",
    body: "A vetted provider sends NGN to the bank account under an idempotency reference, so a retry can never pay twice.",
  },
  {
    title: "Verify",
    state: "PAYMENT_VERIFIED",
    authority: "Attestation policy",
    body: "Payment evidence is authenticated, reconciled and signed into an attestation bound to the intent, amount, recipient and expiry.",
  },
  {
    title: "Settle",
    state: "SETTLED",
    authority: "Arc escrow contract",
    body: "The contract checks the attestation and releases escrow. No valid attestation before expiry means a refund. Never both.",
  },
] as const;

const INTERVAL_MS = 3200;

export function SettlementRail() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [hovering, setHovering] = useState(false);
  const playing = auto && !reduce && !hovering;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setActive((i) => (i + 1) % STEPS.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  const step = STEPS[active];
  const verified = active >= 3;

  const select = (i: number) => {
    setAuto(false);
    setActive(i);
  };

  return (
    <div onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
      <div className="relative">
        <div className="absolute left-[10%] right-[10%] top-[21px] h-[3px] rounded-full bg-ink/10" aria-hidden />
        <div
          aria-hidden
          className={cn(
            "absolute left-[10%] right-[10%] top-[21px] h-[3px] origin-left rounded-full transition-[scale,background-color] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
            verified ? "bg-teal" : "bg-lime-strong",
          )}
          style={{ scale: `${active / (STEPS.length - 1)} 1` }}
        />
        <div role="tablist" aria-label="Settlement lifecycle" className="relative grid grid-cols-5">
          {STEPS.map((s, i) => {
            const isActive = i === active;
            const done = i < active;
            return (
              <button
                key={s.state}
                role="tab"
                id={`rail-tab-${i}`}
                aria-selected={isActive}
                aria-controls="rail-panel"
                tabIndex={isActive ? 0 : -1}
                onClick={() => select(i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") select((i + 1) % STEPS.length);
                  if (e.key === "ArrowLeft") select((i - 1 + STEPS.length) % STEPS.length);
                }}
                className="group flex min-h-11 flex-col items-center gap-3 rounded-lg pb-1 text-center"
              >
                <span
                  className={cn(
                    "relative z-10 flex size-[45px] items-center justify-center rounded-full font-display text-sm font-bold tabular-nums transition-[background-color,color,box-shadow] duration-200 ease-out",
                    isActive && (i >= 3 ? "bg-teal text-ink" : "bg-lime text-ink"),
                    done && "bg-ink text-paper",
                    !isActive && !done && "bg-paper text-ink/50 shadow-[inset_0_0_0_1.5px_oklch(0.17_0.005_120/0.18)] group-hover:text-ink",
                  )}
                >
                  {i + 1}
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold transition-colors duration-150 sm:text-sm",
                    isActive ? "text-ink" : "text-ink/55 group-hover:text-ink",
                  )}
                >
                  {s.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        id="rail-panel"
        role="tabpanel"
        aria-labelledby={`rail-tab-${active}`}
        aria-live="polite"
        className="mt-10 grid gap-6 border-t border-ink/10 pt-8 md:grid-cols-12"
      >
        <h3 className="font-display text-4xl font-extrabold tracking-[-0.03em] md:col-span-4 md:text-5xl">
          {step.title}
        </h3>
        <div className="md:col-span-8">
          <p className="max-w-[60ch] text-lg leading-relaxed text-ink/80">{step.body}</p>
          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <div>
              <dt className="text-ink/55">State</dt>
              <dd className="mt-1 font-mono text-[13px] text-ink">{step.state}</dd>
            </div>
            <div>
              <dt className="text-ink/55">Source of truth</dt>
              <dd className="mt-1 font-medium text-ink">{step.authority}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
