import Link from "next/link";
import { HomeDashboard } from "@/components/offramp/home-dashboard";
import ConnectButton from "@/components/connect-button";
import { MeloMark } from "@/components/landing/melo-mark";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-paper">
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-paper pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/landing" className="flex min-h-11 items-center gap-2" aria-label="MELO home">
            <MeloMark className="size-8" />
            <span className="font-display text-lg font-extrabold tracking-[-0.03em] text-ink">MELO</span>
            <span className="hidden rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-teal-ink sm:inline">
              Arc testnet
            </span>
          </Link>
          <ConnectButton />
        </div>
      </header>

      <main className="w-full flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4 sm:px-6 sm:pt-6">
        <HomeDashboard />
      </main>
    </div>
  );
}
