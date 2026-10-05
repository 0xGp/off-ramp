"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const SAMPLES = {
  request: {
    label: "Create intent",
    code: `POST /v1/intents
Idempotency-Key: 5b1e0c2a-intent-001
Content-Type: application/json

{
  "input": {
    "asset": "USDC",
    "chain": "arc-testnet",
    "amount": "100000000"
  },
  "payout": {
    "currency": "NGN",
    "bank_code": "058",
    "account_number": "0123454821"
  }
}`,
  },
  response: {
    label: "Response",
    code: `HTTP/1.1 201 Created

{
  "id": "int_01J9ZK4Q8M",
  "status": "QUOTE_AVAILABLE",
  "quote": {
    "net_fiat_minor": "15693440",
    "fees_minor": { "provider": "79100", "melo": "47460" },
    "reservation": "INDICATIVE",
    "expires_at": "2026-09-29T17:02:30Z"
  }
}`,
  },
} as const;

type SampleKey = keyof typeof SAMPLES;

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(POST|GET|HTTP\/1\.1)\b|^([A-Za-z-]+)(?=:)/gm;

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of code.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push(code.slice(last, start));
    if (m[1] && m[2]) {
      out.push(<span key={key++} className="text-[oklch(0.8_0.11_184)]">{m[1]}</span>, m[2]);
    } else if (m[1]) {
      out.push(<span key={key++} className="text-lime">{m[1]}</span>);
    } else if (m[3]) {
      out.push(<span key={key++} className="font-semibold text-paper">{m[3]}</span>);
    } else if (m[4]) {
      out.push(<span key={key++} className="text-paper/60">{m[4]}</span>);
    }
    last = start + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function ApiSample() {
  const [tab, setTab] = useState<SampleKey>("request");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SAMPLES[tab].code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-ink text-paper/85 shadow-[0_1px_2px_oklch(0_0_0/0.2),0_24px_48px_-24px_oklch(0_0_0/0.45)]">
      <div className="flex items-center justify-between gap-2 border-b border-paper/10 px-2 py-2">
        <div role="tablist" aria-label="API sample" className="flex gap-1">
          {(Object.keys(SAMPLES) as SampleKey[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "h-10 rounded-lg px-3 text-sm font-medium transition-colors duration-150",
                tab === k ? "bg-paper/10 text-paper" : "text-paper/55 hover:text-paper",
              )}
            >
              {SAMPLES[k].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="relative flex size-10 items-center justify-center rounded-lg text-paper/60 transition-colors duration-150 hover:bg-paper/10 hover:text-paper"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={copied ? "check" : "copy"}
              initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              className="flex"
            >
              {copied ? <Check className="size-4 text-lime" /> : <Copy className="size-4" />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-[1.7] sm:p-6">
        <code>{highlight(SAMPLES[tab].code)}</code>
      </pre>
      <p className="border-t border-paper/10 px-5 py-3 text-xs text-paper/55 sm:px-6">
        Illustrative draft of the intent contract. Not a live endpoint.
      </p>
    </div>
  );
}
