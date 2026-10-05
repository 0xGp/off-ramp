import type { ReactNode } from "react";
import { AlertTriangle, CircleCheck, Clock, LifeBuoy, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/offramp/model";
import { StepActions, TONE_CLASS } from "./primitives";

export interface MoneyFact {
  /** "safe" = settled in the user's favour, "held" = still in escrow, "info" = neutral context. */
  kind: "safe" | "held" | "info";
  text: ReactNode;
}

const FACT_ICON: Record<MoneyFact["kind"], { icon: LucideIcon; className: string }> = {
  safe: { icon: CircleCheck, className: "text-teal-ink" },
  held: { icon: Clock, className: "text-amber-700" },
  info: { icon: AlertTriangle, className: "text-ink/50" },
};

/**
 * Error states lead with what happened to the user's money, then the one
 * action that moves them forward. Copy must never imply a payout succeeded.
 */
export function FailureScreen({
  tone = "warning",
  icon: Icon = AlertTriangle,
  title,
  description,
  facts,
  reference,
  actions,
}: {
  tone?: Extract<Tone, "warning" | "danger" | "neutral">;
  icon?: LucideIcon;
  title: string;
  description: ReactNode;
  facts: MoneyFact[];
  reference?: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6" role="alert" aria-live="assertive">
      <div className="flex flex-col gap-4">
        <span className={cn("melo-pop-in flex size-12 items-center justify-center rounded-2xl", TONE_CLASS[tone])}>
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-balance font-display text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink">
            {title}
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 ring-1 ring-ink/8 sm:p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your money</h2>
        <ul className="flex flex-col gap-3">
          {facts.map((fact, i) => {
            const { icon: FactIcon, className } = FACT_ICON[fact.kind];
            return (
              <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-ink/85">
                <FactIcon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden />
                <span className="text-pretty">{fact.text}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {reference ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LifeBuoy className="size-3.5 shrink-0" aria-hidden />
          <span>
            Support reference <span className="font-mono text-ink">{reference}</span>
          </span>
        </p>
      ) : null}

      <StepActions>{actions}</StepActions>
    </div>
  );
}
