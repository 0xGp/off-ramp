import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FlowSummary } from "@/components/offramp/flow-summary";
import { CashOutHeader } from "./cash-out-header";

export const metadata: Metadata = {
  title: "Cash out — MELO",
};

export default function CashOutLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-paper">
      <CashOutHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 sm:pb-12 lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-12 lg:px-8 lg:pt-10">
        <div className="flex min-w-0 flex-1 flex-col lg:min-h-[calc(100dvh-12rem)]">{children}</div>
        <FlowSummary />
      </main>
    </div>
  );
}
