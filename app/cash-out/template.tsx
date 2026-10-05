import type { ReactNode } from "react";

export default function CashOutTemplate({ children }: { children: ReactNode }) {
  return <div className="melo-step-in flex flex-1 flex-col">{children}</div>;
}
