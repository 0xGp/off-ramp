"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, CircleCheck, Landmark, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUnits } from "@/lib/money";
import { useSelectedChain } from "@/lib/use-wallet";
import { api, toApiError } from "@/lib/api";
import { BACKEND_URL, useMe } from "@/lib/api/account";
import { useBanks } from "@/lib/api/queries";
import { amountError, isValidAmount, MAX_USDC, MIN_USDC, USDC_DECIMALS } from "@/lib/offramp/limits";
import {
  Notice,
  Panel,
  primaryButtonClass,
  StepActions,
  StepHeading,
  StepSkeleton,
} from "@/components/offramp/primitives";
import { useStepGuard } from "@/components/offramp/use-step-guard";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setAmount, setRecipient } from "@/store/offramp-slice";

type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; name: string; verified: boolean }
  | { status: "error"; message: string };

const fieldClass =
  "h-12 w-full rounded-xl bg-white px-4 text-base text-ink ring-1 ring-inset ring-ink/15 transition-[box-shadow] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal";

export default function DetailsStep() {
  const { ready } = useStepGuard("details");
  return ready ? <DetailsForm /> : <StepSkeleton />;
}

function DetailsForm() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((s) => s.offramp);
  const chain = useSelectedChain();
  const ids = { amount: useId(), bank: useId(), account: useId() };
  const banks = useBanks();

  const [amount, setAmountInput] = useState(draft.amount);
  const [bankCode, setBankCode] = useState(draft.recipient?.bankCode ?? "");
  const [accountNumber, setAccountNumber] = useState(draft.recipient?.accountNumber ?? "");
  const [lookup, setLookup] = useState<Lookup>(
    draft.recipient
      ? { status: "found", name: draft.recipient.accountName, verified: draft.recipient.nameVerified }
      : { status: "idle" },
  );
  const requestId = useRef(0);

  const runLookup = async (bank: string, account: string) => {
    const id = ++requestId.current;
    dispatch(setRecipient(null));
    if (!bank || account.length !== 10) {
      setLookup({ status: "idle" });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const { accountName, verified } = await api.resolveAccount({ bankCode: bank, accountNumber: account });
      if (id !== requestId.current) return;
      setLookup({ status: "found", name: accountName, verified });
      const bankName = banks.data?.find((b) => b.code === bank)?.name ?? bank;
      dispatch(setRecipient({ bankCode: bank, bankName, accountNumber: account, accountName, nameVerified: verified }));
    } catch (error) {
      if (id !== requestId.current) return;
      setLookup({ status: "error", message: toApiError(error).message });
    }
  };

  const me = useMe();
  const saved = BACKEND_URL ? (me.data?.bankAccount ?? null) : null;
  const savedLoading = !!BACKEND_URL && me.isPending;

  useEffect(() => {
    if (!saved) return;
    const current = draft.recipient;
    if (current?.bankCode === saved.institutionCode && current.accountNumber.endsWith(saved.accountLast4)) return;
    // The full number stays on the backend; the flow only needs the last four for display.
    dispatch(
      setRecipient({
        bankCode: saved.institutionCode,
        bankName: saved.institutionName,
        accountNumber: `••••••${saved.accountLast4}`,
        accountName: saved.accountName,
        nameVerified: true,
      }),
    );
  }, [saved, draft.recipient, dispatch]);

  const amountMessage = amountError(amount);
  const recipientReady = saved ? saved.usable : !savedLoading && lookup.status === "found";
  const canContinue = isValidAmount(amount) && recipientReady;

  return (
    <form
      className="flex flex-1 flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canContinue) router.push("/cash-out/quote");
      }}
    >
      <StepHeading
        title={saved ? "How much?" : "Where should the naira go?"}
        description={
          saved
            ? "Enter how much USDC to cash out. Naira goes to your payout account."
            : "Enter how much USDC to cash out and the Nigerian bank account to pay."
        }
      />

      <div className="flex flex-col gap-2">
        <label htmlFor={ids.amount} className="text-sm font-medium text-ink">
          You send
        </label>
        <div className="relative">
          <input
            id={ids.amount}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmountInput(e.target.value);
              dispatch(setAmount(e.target.value));
            }}
            aria-invalid={amountMessage ? true : undefined}
            aria-describedby={`${ids.amount}-hint`}
            className={cn(fieldClass, "h-16 pr-20 font-display text-3xl font-extrabold tabular-nums tracking-[-0.02em]")}
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-muted-foreground">
            USDC
          </span>
        </div>
        <p id={`${ids.amount}-hint`} className={cn("text-xs", amountMessage ? "text-red-700" : "text-muted-foreground")}>
          {amountMessage ?? `On ${chain.name}. ${formatUnits(MIN_USDC, USDC_DECIMALS)}–${formatUnits(MAX_USDC, USDC_DECIMALS)} USDC.`}
        </p>
      </div>

      {savedLoading ? (
        <div className="h-20 animate-pulse rounded-2xl bg-ink/5 motion-reduce:animate-none" aria-busy="true" aria-label="Loading payout account" />
      ) : saved ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">Pays to</p>
          <Panel className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-teal-ink" aria-hidden>
              <Landmark className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{saved.accountName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {saved.institutionName} ••{saved.accountLast4}
              </p>
            </div>
            <Link
              href="/account/setup?next=/cash-out/details"
              className="flex min-h-11 items-center px-2 text-sm font-semibold text-teal-ink underline-offset-4 hover:underline"
            >
              Change
            </Link>
          </Panel>
          {!saved.usable ? (
            <Notice tone="warning" icon={<AlertTriangle aria-hidden />}>
              This account was just changed. It can receive payouts from{" "}
              {new Date(saved.usableFrom).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
            </Notice>
          ) : null}
        </div>
      ) : (
      <>
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
              runLookup(e.target.value, accountNumber);
            }}
            disabled={!banks.data}
            className={cn(fieldClass, "appearance-none pr-10 disabled:opacity-60", !bankCode && "text-muted-foreground")}
          >
            <option value="" disabled>
              {banks.isError ? "Couldn't load banks" : banks.data ? "Select a bank" : "Loading banks…"}
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
            runLookup(bankCode, digits);
          }}
          aria-describedby={`${ids.account}-status`}
          className={cn(fieldClass, "font-mono tracking-[0.08em] tabular-nums")}
        />
        <div id={`${ids.account}-status`} aria-live="polite" className="min-h-10">
          {lookup.status === "loading" ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              Checking account name…
            </p>
          ) : lookup.status === "found" && lookup.verified ? (
            <Notice tone="success" icon={<CircleCheck aria-hidden />}>
              <span className="font-semibold">{lookup.name}</span>
              <span className="block opacity-80">Name confirmed by the bank. Check this is the right person.</span>
            </Notice>
          ) : lookup.status === "found" ? (
            <Notice tone="warning" icon={<AlertTriangle aria-hidden />}>
              <span className="font-semibold">{lookup.name}</span>
              <span className="block opacity-80">Name check unavailable, so this is a development placeholder.</span>
            </Notice>
          ) : lookup.status === "error" ? (
            <Notice tone="danger" icon={<AlertTriangle aria-hidden />}>
              {lookup.message}
            </Notice>
          ) : null}
        </div>
      </div>
      </>
      )}

      <StepActions>
        <button type="submit" disabled={!canContinue} className={primaryButtonClass}>
          Get quote
        </button>
      </StepActions>
    </form>
  );
}