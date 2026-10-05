"use client";

import { usePathname } from "next/navigation";
import { FlowHeader } from "@/components/offramp/flow-header";
import { FLOW_STEPS, stepFromPath, stepIndex } from "@/components/offramp/flow-steps";

export function CashOutHeader() {
  const step = stepFromPath(usePathname());
  const index = stepIndex(step);
  const backHref = index > 0 ? FLOW_STEPS[index - 1].href : null;
  return <FlowHeader step={step} backHref={backHref} />;
}
