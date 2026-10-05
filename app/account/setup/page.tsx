"use client";

import { Suspense, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLogout } from "@privy-io/react-auth";
import { AlertTriangle, Check, ChevronDown, CircleCheck, Landmark, LoaderCircle, LogOut, Wallet } from "lucide-react";
import { GoogleIcon, useGoogleSignIn } from "@/components/connect-button";
import { MeloMark } from "@/components/landing/melo-mark";
import { Notice, Panel, primaryButtonClass, secondaryButtonClass, StepHeading, StepSkeleton } from "@/components/offramp/primitives";
import { BACKEND_URL, BackendError, useMe, useSaveBankAccount, useVerifyBankAccount, type SavedBankAccount } from "@/lib/api/account";
import { useBanks } from "@/lib/api/queries";
import { shortHex } from "@/lib/money";
import { useWallet } from "@/lib/use-wallet";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-12 w-full rounded-xl bg-white px-4 text-base text-ink ring-1 ring-inset ring-ink/15 transition-[box-shadow] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal";

/** Only same-origin paths, so `?next=` can't send the user to another site. */
function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/account/setup") ? value : "/";
}

export default function AccountSetupPage() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-paper">
      <SetupHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-8">
        <Suspense fallback={<StepSkeleton />}>
          <AccountSetup />
        </Suspense>
      </main>
    </div>
  );
}

function SetupHeader() {
  const { signedIn } = useWallet();
  const { logout } = useLogout();
  return (
    <header className="border-b border-ink/10 bg-paper pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-16 w-full max-w-md items-center justify-between px-4">
        <Link href="/" className="flex min-h-11 items-center gap-2" aria-label="MELO home">
          <MeloMark className="size-8" />
          <span className="font-display text-lg font-extrabold tracking-[-0.03em] text-ink">MELO</span>
        </Link>
        {signedIn ? (
          <button
            type="button"
            onClick={() => logout()}
            className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
          >
            <LogOut className="size-4" aria-hidden />
            Log out
          </button>
        ) : null}
      </div>
    </header>
  );
}

function AccountSetup() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const wallet = useWallet();
  const me = useMe();
  const [editing, setEditing] = useState(false);

  if (!BACKEND_URL) {
    return (
      <Notice tone="warning" icon={<AlertTriangle aria-hidden />}>
        Account setup needs the MELO backend. Set <code className="font-mono">NEXT_PUBLIC_MELO_BACKEND_URL</code> in{" "}
        <code className="font-mono">web/.env.local</code>.
      </Notice>
    );
  }

  if (wallet.settling && !wallet.signedIn) return <StepSkeleton />;
  if (!wallet.signedIn) return <SignInPrompt />;
  if (me.isPending) return <StepSkeleton />;
  if (me.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="danger" icon={<AlertTriangle aria-hidden />}>
          {me.error.message}
        </Notice>
        <button type="button" onClick={() => me.refetch()} className={secondaryButtonClass}>
          Try again
        </button>
      </div>
    );
  }

  const account = me.data;
  const walletAddress = account.walletAddress ?? wallet.address ?? null;
  const bank = account.bankAccount;
  const firstName = account.displayName?.split(" ")[0];
  const showForm = !bank || editing;

  return (
    <>
      <StepHeading
        title={account.onboarding.complete && !editing ? "Your account" : firstName ? `Welcome, ${firstName}` : "Set up your account"}
        description={
          account.onboarding.complete && !editing
            ? "Cash-outs pay into the account below."
            : "Two quick steps, once. After this, every cash-out is one tap."
        }
      />

      <ol className="flex flex-col gap-3">
        <SetupStep
          number={1}
          icon={<Wallet aria-hidden />}
          title="Your USDC wallet"
          done={!!walletAddress}
          detail={walletAddress ? `${shortHex(walletAddress)} · works on Arc and Base` : "Creating your wallet…"}
          busy={!walletAddress}
        />
        <SetupStep
          number={2}
          icon={<Landmark aria-hidden />}
          title="Payout bank account"
          done={!!bank}
          detail={bank ? `${bank.institutionName} ••${bank.accountLast4} · ${bank.accountName}` : "Where your naira is paid"}
        />
      </ol>

      {bank && !bank.usable ? <CooldownNotice bank={bank} /> : null}

      {showForm ? (
        <BankAccountForm
          replacing={!!bank}
          onCancel={bank ? () => setEditing(false) : undefined}
          onSaved={(updated) => {
            setEditing(false);
            if (updated.onboarding.complete && !bank) router.replace(next);
          }}
        />
      ) : (
        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={() => router.push(next)}
            disabled={!account.onboarding.complete}
            className={primaryButtonClass}
          >
            {account.onboarding.complete ? (next === "/" ? "Go to MELO" : "Continue") : "Waiting for your wallet…"}
          </button>
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            Change payout account
          </button>
        </div>
      )}
    </>
  );
}

function SetupStep({
  number,
  icon,
  title,
  detail,
  done,
  busy,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  detail: string;
  done: boolean;
  busy?: boolean;
}) {
  return (
    <li>
      <Panel className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
            done ? "bg-accent text-teal-ink" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {done ? <Check /> : busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            <span className="sr-only">Step {number}: </span>
            {title}
            <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </Panel>
    </li>
  );
}

function CooldownNotice({ bank }: { bank: SavedBankAccount }) {
  const when = new Date(bank.usableFrom).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Notice tone="warning" icon={<AlertTriangle aria-hidden />}>
      For your security, this new account can receive payouts from {when}.
    </Notice>
  );
}

function SignInPrompt() {
  const { signIn, signingIn, error } = useGoogleSignIn();
  return (
    <>
      <StepHeading title="Set up your account" description="Sign in with Google to create your MELO account and USDC wallet." />
      {error ? (
        <Notice tone="danger" icon={<AlertTriangle aria-hidden />}>
          {error}
        </Notice>
      ) : null}
      <button type="button" onClick={signIn} disabled={signingIn} className={cn(primaryButtonClass, "mt-auto")}>
        {signingIn ? (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <GoogleIcon className="size-5 rounded-full bg-white p-0.5" />
        )}
        Continue with Google
      </button>
    </>
  );
}

type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; name: string }
  | { status: "error"; message: string };

function BankAccountForm({
  replacing,
  onCancel,
  onSaved,
}: {
  replacing: boolean;
  onCancel?: () => void;
  onSaved: (me: NonNullable<ReturnType<typeof useMe>["data"]>) => void;
}) {
  const ids = { bank: useId(), account: useId() };
  const banks = useBanks();
  const verify = useVerifyBankAccount();
  const save = useSaveBankAccount();
  const { signIn } = useGoogleSignIn();
  const { logout } = useLogout();
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const requestId = useRef(0);

  const runLookup = async (bank: string, account: string) => {
    const id = ++requestId.current;
    save.reset();
    if (!bank || account.length !== 10) {
      setLookup({ status: "idle" });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const { accountName } = await verify.mutateAsync({ institutionCode: bank, accountNumber: account });
      if (id === requestId.current) setLookup({ status: "found", name: accountName });
    } catch (err) {
      if (id === requestId.current) {
        setLookup({ status: "error", message: err instanceof Error ? err.message : "Couldn't check this account." });
      }
    }
  };

  const reauth = save.error instanceof BackendError && save.error.code === "reauth-required";

  return (
    <form
      className="flex flex-1 flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (lookup.status !== "found" || save.isPending) return;
        save.mutate({ institutionCode: bankCode, accountNumber }, { onSuccess: onSaved });
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={ids.bank} className="text-sm font-medium text-ink">
          Bank
        </label>
        <div className="relative">
          <select
            id={ids.bank}
            value={bankCode}
            onChange={(e) => {
              setBankCode(e.target.value);
              void runLookup(e.target.value, accountNumber);
            }}
            disabled={!banks.data}
            className={cn(fieldClass, "appearance-none pr-10 disabled:opacity-60", !bankCode && "text-muted-foreground")}
          >
            <option value="" disabled>
              {banks.isError ? "Couldn't load banks" : banks.data ? "Select your bank" : "Loading banks…"}
            </option>
            {(banks.data ?? []).map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={ids.account} className="text-sm font-medium text-ink">
          Account number
        </label>
        <input
          id={ids.account}
          inputMode="numeric"
          autoComplete="off"
          placeholder="10-digit NUBAN"
          maxLength={10}
          value={accountNumber}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
            setAccountNumber(digits);
            void runLookup(bankCode, digits);
          }}
          aria-describedby={`${ids.account}-status`}
          className={cn(fieldClass, "font-mono tabular-nums tracking-[0.08em]")}
        />
        <div id={`${ids.account}-status`} aria-live="polite" className="min-h-10">
          {lookup.status === "loading" ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              Checking account name…
            </p>
          ) : lookup.status === "found" ? (
            <Notice tone="success" icon={<CircleCheck aria-hidden />}>
              <span className="font-semibold">{lookup.name}</span>
              <span className="block opacity-80">Name confirmed by the bank. Make sure this is you.</span>
            </Notice>
          ) : lookup.status === "error" ? (
            <Notice tone="danger" icon={<AlertTriangle aria-hidden />}>
              {lookup.message}
            </Notice>
          ) : null}
        </div>
      </div>

      {replacing ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          A new payout account can receive cash-outs 24 hours after you save it. We&apos;ll email you about the change.
        </p>
      ) : null}

      {save.isError ? (
        <Notice tone="danger" icon={<AlertTriangle aria-hidden />}>
          {save.error.message}
          {reauth ? (
            <button
              type="button"
              onClick={async () => {
                await logout();
                await signIn();
              }}
              className="mt-1 block font-semibold underline underline-offset-2"
            >
              Sign in again
            </button>
          ) : null}
        </Notice>
      ) : null}

      <div className="mt-auto flex flex-col gap-2">
        <button type="submit" disabled={lookup.status !== "found" || save.isPending} className={primaryButtonClass}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {save.isPending ? "Saving…" : "Save payout account"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
