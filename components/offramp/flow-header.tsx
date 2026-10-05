"use client";

import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOW_STEPS, stepIndex, type FlowStepKey } from "./flow-steps";

const iconLink =
  "flex size-11 items-center justify-center rounded-full text-ink transition-[background-color,scale] duration-150 ease-out hover:bg-ink/5 active:scale-[0.96]";

export function FlowHeader({ step, backHref }: { step: FlowStepKey; backHref?: string | null }) {
  const current = stepIndex(step);
  const meta = FLOW_STEPS[current];

  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-xl items-center gap-2 px-2 sm:px-4 lg:max-w-5xl lg:px-6">
        {backHref ? (
          <Link href={backHref} className={iconLink} aria-label="Back to previous step">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
        ) : (
          <span className="size-11" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground tabular-nums">
            Step {current + 1} of {FLOW_STEPS.length}
          </span>
          <span className="truncate text-sm font-semibold text-ink">{meta.label}</span>
        </div>
        <Link href="/" className={iconLink} aria-label="Exit cash-out">
          <X className="size-5" aria-hidden />
        </Link>
      </div>

      <div className="mx-auto w-full max-w-xl px-4 pb-3 lg:max-w-5xl lg:px-8">
        <ol className="grid grid-cols-5 gap-1.5" aria-label="Cash-out progress">
          {FLOW_STEPS.map((s, i) => (
            <li key={s.key} className="flex flex-col gap-1.5">
              <span className="relative h-1.5 overflow-hidden rounded-full bg-ink/10">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
                    i < current ? "w-full bg-teal" : i === current ? "w-full bg-lime-strong" : "w-0",
                  )}
                />
              </span>
              <span
                className={cn(
                  "hidden text-[11px] sm:block",
                  i === current ? "font-semibold text-ink" : "text-muted-foreground",
                )}
                aria-current={i === current ? "step" : undefined}
              >
                {s.label}
                <span className="sr-only">{i < current ? " (done)" : i === current ? " (current)" : ""}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </header>
  );
}