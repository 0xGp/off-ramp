"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isValidAmount } from "@/lib/offramp/limits";
import { useWallet } from "@/lib/use-wallet";
import { useAppSelector } from "@/store/hooks";
import { FLOW_STEPS, stepIndex, type FlowStepKey } from "./flow-steps";

/**
 * Each step requires the ones before it. Deep links or refreshes that skip a
 * requirement are sent back to the first incomplete step.
 */
export function useStepGuard(step: FlowStepKey) {
  const router = useRouter();
  const wallet = useWallet();
  const offramp = useAppSelector((s) => s.offramp);

  const settled = offramp.hydrated && (offramp.preview || !wallet.settling);
  const walletReady = offramp.preview || wallet.onSelectedChain;
  const detailsReady = walletReady && offramp.recipient !== null && isValidAmount(offramp.amount);
  const quoteReady = detailsReady && offramp.intentId !== null && offramp.offer !== null;

  const satisfied: Record<FlowStepKey, boolean> = {
    wallet: walletReady,
    details: detailsReady,
    quote: quoteReady,
    authorize: quoteReady,
    track: true,
  };

  const target = stepIndex(step);
  const firstMissing = FLOW_STEPS.slice(0, target).findIndex((s) => !satisfied[s.key]);
  const redirectTo = firstMissing === -1 ? null : FLOW_STEPS[firstMissing].href;

  useEffect(() => {
    if (settled && redirectTo) router.replace(redirectTo);
  }, [settled, redirectTo, router]);

  return { ready: settled && !redirectTo, walletReady };
}
