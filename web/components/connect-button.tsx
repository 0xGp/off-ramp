"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLoginWithOAuth, useLogout, usePrivy } from "@privy-io/react-auth";
import { Check, ChevronDown, Copy, ExternalLink, Landmark, LoaderCircle, LogOut } from "lucide-react";
import { useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UsdcIcon } from "@/components/usdc-icon";
import { BACKEND_URL, useMe } from "@/lib/api/account";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { shortHex } from "@/lib/money";
import { useSelectedChain, useWallet } from "@/lib/use-wallet";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/store/hooks";
import { setChainId } from "@/store/offramp-slice";

const baseClass =
  "h-11 rounded-full px-4 text-sm font-semibold transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96]";

/** Manual fallback for when the automatic network follow fails. */
export function useSwitchToSelectedChain() {
  const selected = useSelectedChain();
  const { switchChain, isPending, error, reset } = useSwitchChain();
  return {
    switchToSelected: () => switchChain({ chainId: selected.id }),
    switching: isPending,
    error: error ? error.message.split("\n")[0] : null,
    reset,
  };
}

/** Starts Google sign-in directly, skipping Privy's method picker since Google is the only option. */
export function useGoogleSignIn() {
  const { initOAuth, loading } = useLoginWithOAuth();
  const [error, setError] = useState<string | null>(null);
  return {
    signIn: async () => {
      setError(null);
      try {
        await initOAuth({ provider: "google" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Google sign-in failed. Try again.");
      }
    },
    signingIn: loading,
    error,
  };
}

/** Picks which chain's USDC to cash out. The signed-in wallet follows automatically. */
function NetworkMenu() {
  const dispatch = useAppDispatch();
  const selected = useSelectedChain();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label={`Network: USDC on ${selected.name}. Change network`}
            className={cn(baseClass, "gap-2 border-ink/15 bg-white px-3 text-ink hover:bg-accent aria-expanded:bg-accent")}
          />
        }
      >
        <UsdcIcon />
        <span>{selected.name.split(" ")[0]}</span>
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={selected.id} onValueChange={(value) => dispatch(setChainId(Number(value)))}>
            {SUPPORTED_CHAINS.map((chain) => (
              <DropdownMenuRadioItem key={chain.id} value={chain.id} closeOnClick className="min-h-12 gap-2.5">
                <UsdcIcon className="size-6" />
                <span className="font-semibold text-ink">USDC on {chain.name.split(" ")[0]}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConnectButton({ className }: { className?: string }) {
  const { ready } = usePrivy();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {ready ? <NetworkMenu /> : null}
      <AccountButton />
    </div>
  );
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function AccountButton({ className }: { className?: string }) {
  const { ready, authenticated, user } = usePrivy();
  const { logout } = useLogout();
  const wallet = useWallet();
  const selected = useSelectedChain();
  const { signIn, signingIn } = useGoogleSignIn();
  const me = useMe();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  if (!ready) {
    return <div aria-hidden className={cn(baseClass, "w-36 bg-ink/5", className)} />;
  }

  if (!authenticated) {
    return (
      <Button
        onClick={signIn}
        disabled={signingIn}
        variant="outline"
        className={cn(baseClass, "gap-2 border-ink/15 bg-white text-ink hover:bg-accent", className)}
      >
        {signingIn ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <GoogleIcon />}
        <span className="sm:hidden">Sign in</span>
        <span className="hidden sm:inline">Continue with Google</span>
      </Button>
    );
  }

  if (!wallet.address) {
    return (
      <Button disabled variant="outline" className={cn(baseClass, "gap-2 border-ink/15 bg-white text-ink", className)}>
        <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
        Setting up wallet
      </Button>
    );
  }

  const address = wallet.address;
  const email = me.data?.email ?? user?.google?.email ?? user?.email?.address;
  const bank = me.data?.bankAccount;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className={cn(baseClass, "gap-2 border-ink/15 bg-white text-ink hover:bg-accent aria-expanded:bg-accent", className)}
          />
        }
      >
        <span className="size-2 rounded-full bg-teal" aria-hidden />
        <span className="font-mono">{shortHex(address)}</span>
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate text-ink">{email ?? "Signed in"}</span>
            <span className="font-mono text-xs font-normal">{shortHex(address)}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem onClick={copyAddress} className="min-h-10">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy address"}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-10"
          onClick={() => window.open(`${selected.explorerUrl}/address/${address}`, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink aria-hidden />
          View on {selected.name.split(" ")[0]} explorer
        </DropdownMenuItem>
        {BACKEND_URL ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-12 items-start" onClick={() => router.push("/account/setup")}>
              <Landmark className="mt-0.5" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span>Payout account</span>
                <span className="truncate text-xs text-muted-foreground">
                  {me.isPending
                    ? "Loading…"
                    : me.isError
                      ? "Couldn't reach MELO"
                      : bank
                        ? `${bank.institutionName} ••${bank.accountLast4}`
                        : "Not set up yet"}
                </span>
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="min-h-10" onClick={() => logout()}>
          <LogOut aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ConnectButton;
