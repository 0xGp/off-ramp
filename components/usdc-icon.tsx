import { cn } from "@/lib/utils";

/** USDC mark: Circle blue disc, white dollar sign and bracket arcs. */
export function UsdcIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-5 shrink-0", className)} aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        d="M12.4 25.2A9.9 9.9 0 0 1 12.4 6.8M19.6 6.8A9.9 9.9 0 0 1 19.6 25.2"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M19 12.6c-.3-1.3-1.5-2-3-2-1.8 0-3 .9-3 2.2 0 1.4 1.2 1.9 3 2.3 1.9.4 3.2 1 3.2 2.5 0 1.4-1.3 2.3-3.2 2.3-1.6 0-2.9-.8-3.2-2.2M16 8.8v2M16 21.1v2"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
