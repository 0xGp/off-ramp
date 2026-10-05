"use client";

import Link from "next/link";
import { MotionConfig } from "framer-motion";
import { Activity, ArrowDownUp, ArrowRight, ChevronRight, ListChecks } from "lucide-react";
import { BentoGrid } from "@/components/ui/bento-grid";
import { BentoCard } from "@/components/ui/bento-grid-utils/bento-card";
import { deserializeQuote, isTerminal } from "@/lib/offramp/model";
import type { IntentView } from "@/lib/api";
import { useActivity } from "@/lib/api/queries";
import { FLOW_STEPS } from "./flow-steps";
import { formatNgn, formatUsdc, primaryButtonClass, StatusPill } from "./primitives";
import { useNow } from "./use-now";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function when(ms: number, now: number) {
  const minutes = Math.round((ms - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

function ActivityRow({ record, now }: { record: IntentView; now: number }) {
  const quote = deserializeQuote(record.quote);
  const { status } = record.projection;
  return (
    <li>
      <Link
        href={`/intent/${record.id}`}
        className="-mx-2 flex min-h-14 items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink tabular-nums">
            {formatUsdc(quote.inputAmount, quote.inputDecimals)} → {formatNgn(quote.netFiat, quote.fiatDecimals)}
          </span>
          <span className="block text-xs text-muted-foreground">
            {record.recipient.bankName} · {when(record.authorizedAt, now)}
            {record.sample ? " · sample" : ""}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <StatusPill status={status} />
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </span>
      </Link>
    </li>
  );
}

export function HomeDashboard() {
  const activity = useActivity();
  const now = useNow();
  const history = activity.data ?? [];
  const live = history.filter((r) => !r.sample && !isTerminal(r.projection.status));
  const loading = activity.isPending || now === null;

  return (
    <MotionConfig reducedMotion="user">
      <BentoGrid className="max-w-5xl gap-4 md:gap-5">
        <BentoCard title="Cash out" description="USDC to a Nigerian bank account" icon={<ArrowDownUp className="size-4" />} colSpan={2}>
          <div className="flex h-full flex-col gap-5">
            <p className="font-display text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink text-balance">
              Send USDC. Your bank gets naira. Escrow holds it until the payout is verified.
            </p>
            <ol className="flex flex-wrap gap-1.5" aria-label="Cash-out steps">
              {FLOW_STEPS.map((s, i) => (
                <li key={s.key} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {i + 1}. {s.label}
                </li>
              ))}
            </ol>
            <Link href="/cash-out" className={`${primaryButtonClass} mt-auto`}>
              Start a cash-out <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </BentoCard>

        <BentoCard title="In progress" description="Cash-outs still settling" icon={<ListChecks className="size-4" />} colSpan={2}>
          {loading ? (
            <div className="h-14 animate-pulse rounded-xl bg-ink/5 motion-reduce:animate-none" />
          ) : live.length ? (
            <ul className="flex flex-col">
              {live.map((r) => (
                <ActivityRow key={r.id} record={r} now={now} />
              ))}
            </ul>
          ) : (
            <div className="flex h-full flex-col justify-center gap-1 rounded-xl bg-muted/60 p-4">
              <p className="text-sm font-medium text-ink">Nothing in flight</p>
              <p className="text-xs text-muted-foreground">
                Active cash-outs appear here with live status until escrow settles onchain.
              </p>
            </div>
          )}
        </BentoCard>

        <BentoCard title="Activity" description="This session plus sample history" icon={<Activity className="size-4" />} colSpan={4}>
          {loading ? (
            <div className="h-40 animate-pulse rounded-xl bg-ink/5 motion-reduce:animate-none" />
          ) : activity.isError ? (
            <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
              Couldn&apos;t load activity. {activity.error.message}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-ink/5">
              {history.map((r) => (
                <ActivityRow key={r.id} record={r} now={now} />
              ))}
            </ul>
          )}
        </BentoCard>
      </BentoGrid>
    </MotionConfig>
  );
}
