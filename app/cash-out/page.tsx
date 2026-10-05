"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CircleCheck, Eye, KeyRound, LoaderCircle, ShieldCheck, Wallet } from "lucide-react";
import { getChain, isSupportedChainId } from "@/lib/chains";
import { shortHex } from "@/lib/money";
import { useSelectedChain, useWallet } from "@/lib/use-wallet";
import { GoogleIcon, useGoogleSignIn, useSwitchToSelectedChain } from "@/components/connect-button";
import { NetworkPicker } from "@/components/offramp/network-picker";
import { Notice, Panel, primaryButtonClass, StepActions, StepHeading } from "@/components/offramp/primitives";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setPreview } from "@/store/offramp-slice";

const ASSURANCES = [
  { icon: Wallet, text: "Signing in gives you a USDC wallet. Nothing moves until you cash out." },
  { icon: KeyRound, text: "No seed phrase to manage, and MELO can't move funds from your wallet." },
  { icon: ShieldCheck, text: "You approve every cash-out yourself." },
];

const linkButtonClass =
  "flex min-h-11 items-center justify-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-ink hover:underline";

export default function WalletStep() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const wallet = useWallet();
  const preview = useAppSelector((s) => s.offramp.preview);
  const { signIn, signingIn, error: signInError } = useGoogleSignIn();
  const chain = useSelectedChain();
  const { switchToSelected, switching, error: switchError, reset } = useSwitchToSelectedChain();

  const ready = preview || wallet.onSelectedChain;
  const busy = signingIn || switching || wallet.settling;

  const primary = ready
    ? { label: "Continue", onClick: () => router.push("/cash-out/details") }
    : wallet.connected
      ? { label: switching ? `Switching to ${chain.name}…` : `Switch to ${chain.name}`, onClick: switchToSelected }
      : wallet.signedIn
        ? { label: "Setting up your wallet…", onClick: () => {} }
        : { label: signingIn ? "Opening Google…" : "Continue with Google", onClick: signIn };
  const showGoogle = !ready && !wallet.signedIn && !signingIn;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <StepHeading
        title="Sign in"
        description={`Your USDC is locked in MELO escrow on ${chain.name} and only released after the naira payout is verified.`}
      />

      <NetworkPicker disabled={switching} />

      <Panel>
        {preview ? (
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Eye className="size-5 text-ink" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Preview mode</p>
              <p className="text-xs text-muted-foreground">No wallet. Nothing is signed or sent.</p>
            </div>
          </div>
        ) : wallet.connected && wallet.address ? (
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-accent">
              {wallet.onSelectedChain ? (
                <CircleCheck className="size-5 text-teal-ink" aria-hidden />
              ) : (
                <AlertTriangle className="size-5 text-amber-700" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-semibold text-ink">{shortHex(wallet.address)}</p>
              <p className="text-xs text-muted-foreground">
                {wallet.onSelectedChain
                  ? `Connected to ${chain.name}`
                  : `Your wallet is on ${isSupportedChainId(wallet.chainId) ? getChain(wallet.chainId).name : `chain ${wallet.chainId}`}. Switching to ${chain.name}…`}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Wallet className="size-5 text-muted-foreground" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Not signed in</p>
              <p className="text-xs text-muted-foreground">Use your Google account. Your wallet is created for you.</p>
            </div>
          </div>
        )}
      </Panel>

      <ul className="flex flex-col gap-3">
        {ASSURANCES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm leading-relaxed text-ink/80">
            <Icon className="mt-0.5 size-4 shrink-0 text-teal-ink" aria-hidden />
            <span className="text-pretty">{text}</span>
          </li>
        ))}
      </ul>

      {switchError ? (
        <button type="button" onClick={reset} className="text-left" aria-label={`${switchError} Dismiss`}>
          <Notice tone="danger" icon={<AlertTriangle aria-hidden />}>
            {switchError}
          </Notice>
        </button>
      ) : null}
      {signInError ? (
        <Notice tone="danger" icon={<AlertTriangle aria-hidden />}>
          {signInError}
        </Notice>
      ) : null}

      <StepActions>
        <button type="button" onClick={primary.onClick} disabled={busy && !ready} className={primaryButtonClass}>
          {busy && !ready ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {showGoogle ? <GoogleIcon className="rounded-full bg-white p-0.5 size-5" /> : null}
          {primary.label}
        </button>
        {preview ? (
          <button type="button" onClick={() => dispatch(setPreview(false))} className={linkButtonClass}>
            Sign in instead
          </button>
        ) : !wallet.onSelectedChain ? (
          <button type="button" onClick={() => dispatch(setPreview(true))} className={linkButtonClass}>
            Preview the flow without signing in
          </button>
        ) : (
          <Link href="/" className={linkButtonClass}>
            Cancel
          </Link>
        )}
      </StepActions>
    </div>
  );
}
