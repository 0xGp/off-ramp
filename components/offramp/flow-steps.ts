/** Mirrors the handbook's Frontend Boundary user flow, one route per step. */
export const FLOW_STEPS = [
  { key: "wallet", label: "Sign in", href: "/cash-out" },
  { key: "details", label: "Details", href: "/cash-out/details" },
  { key: "quote", label: "Quote", href: "/cash-out/quote" },
  { key: "authorize", label: "Authorize", href: "/cash-out/authorize" },
  { key: "track", label: "Track", href: null },
] as const;

export type FlowStepKey = (typeof FLOW_STEPS)[number]["key"];

export function stepIndex(key: FlowStepKey) {
  return FLOW_STEPS.findIndex((s) => s.key === key);
}

export function stepFromPath(pathname: string): FlowStepKey {
  const match = [...FLOW_STEPS].reverse().find((s) => s.href && pathname.startsWith(s.href));
  return match?.key ?? "wallet";
}
