import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatUnits } from "@/lib/money";
import { STATUS_META, type IntentStatus, type Tone } from "@/lib/offramp/model";

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-lime/50 text-ink",
  success: "bg-accent text-teal-ink",
  warning: "bg-amber-500/10 text-amber-800",
  danger: "bg-red-500/10 text-red-700",
};

export const primaryButtonClass =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-lime px-5 text-sm font-semibold text-ink transition-[background-color,scale,opacity] duration-150 ease-out hover:bg-lime-strong active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40";

export const secondaryButtonClass =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-ink ring-1 ring-inset ring-ink/15 transition-[background-color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40";

export function StatusPill({ status, className }: { status: IntentStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASS[meta.tone],
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function DetailRow({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right tabular-nums", strong && "font-semibold text-ink", mono && "font-mono text-xs")}>
        {value}
      </dd>
    </div>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl bg-white p-4 ring-1 ring-ink/8 sm:p-5", className)}>{children}</div>;
}

export function Notice({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed", TONE_CLASS[tone], className)}>
      {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StepHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-display text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink">{title}</h1>
      {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** Sticky action area in the thumb zone on phones; inline on larger screens. */
export function StepActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 bg-paper/95 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none">
      {children}
    </div>
  );
}

export function StepSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading step">
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-ink/5 motion-reduce:animate-none" />
      <div className="h-4 w-full animate-pulse rounded bg-ink/5 motion-reduce:animate-none" />
      <div className="mt-4 h-32 animate-pulse rounded-2xl bg-ink/5 motion-reduce:animate-none" />
    </div>
  );
}

export function formatNgn(amount: bigint, decimals = 2) {
  return `₦${formatUnits(amount, decimals)}`;
}

export function formatUsdc(amount: bigint, decimals = 6) {
  return `${formatUnits(amount, decimals)} USDC`;
}
