import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { MeloMark } from "@/components/landing/melo-mark";
import { CubeMark } from "@/components/landing/cube-mark";
import { SettlementRail } from "@/components/landing/settlement-rail";
import { ApiSample } from "@/components/landing/api-sample";
import { DEFAULT_CHAIN } from "@/lib/chains";
import { shortHex } from "@/lib/money";

export const metadata: Metadata = {
  title: "MELO — Escrow-first USDC to naira off-ramp",
  description:
    "Off-ramp infrastructure for USDC to NGN bank payouts. Funds stay in an onchain escrow on Arc until the payout is verified.",
};

const primaryCta =
  "inline-flex h-12 items-center gap-2 rounded-full bg-lime px-6 text-[15px] font-semibold text-ink transition-[background-color,scale] duration-150 ease-out hover:bg-lime-strong active:scale-[0.96]";
const secondaryCta =
  "inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--ink)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-ink hover:text-paper active:scale-[0.96]";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#principles", label: "Principles" },
  { href: "#arc", label: "Arc" },
  { href: "#api", label: "API" },
];

const PRINCIPLES = [
  {
    rule: "No release without verified payment.",
    note: "A row in MELO's database can't release escrow. Only a valid, unexpired attestation can.",
  },
  {
    rule: "Release or refund. Never both.",
    note: "Settlement and refund are mutually exclusive in the contract and race-tested in the suite.",
  },
  {
    rule: "Every payout is idempotent.",
    note: "Retries look up the provider reference first. Ambiguous outcomes go to reconciliation, never a blind retry.",
  },
  {
    rule: "Amounts are integers.",
    note: "Base units with explicit decimals from API to contract. No floating-point money anywhere.",
  },
];

const ARC_FACTS = [
  { label: "Network", value: DEFAULT_CHAIN.name },
  { label: "Chain ID", value: String(DEFAULT_CHAIN.id), mono: true },
  { label: "Gas token", value: "USDC" },
  { label: "Finality", value: "Deterministic, under 1s" },
  { label: "USDC contract", value: shortHex(DEFAULT_CHAIN.usdc.address, 6, 4), mono: true },
];

const ENDPOINTS = [
  "POST /v1/intents",
  "POST /v1/intents/{id}/quotes",
  "POST /v1/intents/{id}/authorization",
  "GET  /v1/intents/{id}",
  "GET  /v1/intents/{id}/receipt",
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-ink/10 bg-paper pt-[env(safe-area-inset-top)]">
        <nav className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
          <Link href="/landing" className="flex min-h-11 items-center gap-2.5" aria-label="MELO home">
            <MeloMark className="size-8" />
            <span className="font-display text-xl font-extrabold tracking-[-0.03em]">MELO</span>
          </Link>
          <ul className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <li key={n.href}>
                <a
                  href={n.href}
                  className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-ink/70 transition-colors duration-150 hover:text-ink"
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/" className={`${primaryCta} h-11 px-5 text-sm`}>
            Open app
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-[1240px] items-center gap-10 px-5 pb-16 pt-12 sm:px-8 md:grid-cols-12 md:pb-24 md:pt-20">
          <div className="md:col-span-7">
            <h1 className="font-display text-[clamp(3rem,8.4vw,6rem)] font-extrabold leading-[0.94] tracking-[-0.035em]">
              Cash out USDC to naira. Escrow first.
            </h1>
            <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-ink/75 sm:text-xl">
              MELO is off-ramp infrastructure for USDC to NGN bank payouts. Funds sit in an onchain
              escrow on Arc and are released only after the payout is verified. Otherwise, they&apos;re
              refunded.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/" className={primaryCta}>
                Open the app <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a href="#api" className={secondaryCta}>
                Read the API
              </a>
            </div>
            <p className="mt-8 flex items-start gap-2 text-sm text-ink/60">
              <span className="mt-[6px] size-2 shrink-0 rounded-full bg-teal" aria-hidden />
              In development on Arc testnet. Not production-ready.
            </p>
          </div>
          <div className="mx-auto w-full max-w-[320px] md:col-span-5 md:max-w-none">
            <CubeMark className="w-full" />
          </div>
        </section>

        <section id="how" className="scroll-mt-20 border-t border-ink/10">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-20 sm:px-8 md:py-28">
            <div className="grid gap-6 md:grid-cols-12">
              <h2 className="font-display text-[clamp(2.25rem,5vw,4rem)] font-extrabold leading-[1] tracking-[-0.03em] md:col-span-7">
                Five states between a wallet and a bank account.
              </h2>
              <p className="max-w-[40ch] self-end text-lg leading-relaxed text-ink/70 md:col-span-5">
                Each step has one source of truth. The chain holds the money, the provider moves the
                naira, and the attestation connects the two.
              </p>
            </div>
            <div className="mt-14">
              <SettlementRail />
            </div>
          </div>
        </section>

        <section id="principles" className="scroll-mt-20 border-t border-ink/10 bg-white">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-20 sm:px-8 md:py-28">
            <h2 className="max-w-[18ch] font-display text-[clamp(2.25rem,5vw,4rem)] font-extrabold leading-[1] tracking-[-0.03em]">
              Built around four rules.
            </h2>
            <ul className="mt-14 border-t border-ink/10">
              {PRINCIPLES.map((p) => (
                <li
                  key={p.rule}
                  className="grid gap-3 border-b border-ink/10 py-8 md:grid-cols-12 md:gap-10 md:py-10"
                >
                  <p className="font-display text-[clamp(1.75rem,3.4vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.025em] md:col-span-7">
                    {p.rule}
                  </p>
                  <p className="max-w-[46ch] self-center text-base leading-relaxed text-ink/65 md:col-span-5">
                    {p.note}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="arc" className="scroll-mt-20 bg-lime">
          <div className="mx-auto grid w-full max-w-[1240px] gap-12 px-5 py-20 sm:px-8 md:grid-cols-12 md:py-28">
            <div className="md:col-span-6">
              <h2 className="font-display text-[clamp(2.75rem,7vw,5.5rem)] font-extrabold leading-[0.95] tracking-[-0.035em]">
                Settles on Arc.
              </h2>
              <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-ink/80">
                USDC is the gas token and finality is deterministic, so an escrow deposit is final after
                one confirmation and there&apos;s no second token to hold for fees.
              </p>
              <a
                href="https://docs.arc.io/integrate/on-off-ramps.md"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-ink/40 underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-ink"
              >
                Source: Arc on/off-ramp docs <ArrowUpRight className="size-4" aria-hidden />
              </a>
            </div>
            <dl className="self-end border-t-2 border-ink md:col-span-6">
              {ARC_FACTS.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-6 border-b border-ink/20 py-4">
                  <dt className="text-sm font-medium text-ink/70">{f.label}</dt>
                  <dd className={f.mono ? "font-mono text-[15px] tabular-nums" : "text-base font-semibold"}>
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="api" className="scroll-mt-20">
          <div className="mx-auto grid w-full max-w-[1240px] gap-12 px-5 py-20 sm:px-8 md:grid-cols-12 md:py-28">
            <div className="md:col-span-5">
              <h2 className="font-display text-[clamp(2.25rem,5vw,4rem)] font-extrabold leading-[1] tracking-[-0.03em]">
                An API shaped like the lifecycle.
              </h2>
              <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-ink/70">
                Quotes, escrow, payouts and settlement are separate objects with their own states.
                Amounts travel as strings in base units, and every write takes an idempotency key.
              </p>
              <ul className="mt-8 space-y-2 font-mono text-[13px] text-ink/80">
                {ENDPOINTS.map((e) => (
                  <li key={e} className="whitespace-pre">
                    {e}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-ink/55">Draft contract. These endpoints aren&apos;t live yet.</p>
            </div>
            <div className="min-w-0 md:col-span-7">
              <ApiSample />
            </div>
          </div>
        </section>

        <section className="border-t border-ink/10">
          <div className="mx-auto flex w-full max-w-[1240px] flex-col items-start gap-8 px-5 py-20 sm:px-8 md:flex-row md:items-end md:justify-between md:py-28">
            <h2 className="max-w-[14ch] font-display text-[clamp(2.75rem,7vw,5.5rem)] font-extrabold leading-[0.95] tracking-[-0.035em]">
              Try the flow on testnet.
            </h2>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className={primaryCta}>
                Open the app <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a href="#how" className={secondaryCta}>
                See the lifecycle
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink/10 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 px-5 py-10 text-sm text-ink/60 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5 text-ink">
            <MeloMark className="size-6" />
            <span className="font-display font-extrabold tracking-[-0.03em]">MELO</span>
          </div>
          <p className="max-w-[60ch]">
            In development. Testnet only. No liquidity provider has been selected yet, and nothing here
            is an offer of a financial service.
          </p>
          <p>© 2026 MELO</p>
        </div>
      </footer>
    </div>
  );
}
