"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { BaseError, UserRejectedRequestError } from "viem";
import { useSignTypedData } from "wagmi";
import { AlertTriangle, FileSignature, Info, Landmark, LoaderCircle, Lock, RotateCcw, ShieldCheck, TimerOff } from "lucide-react";
import { getChain, IS_MAINNET } from "@/lib/chains";
import { shortHex } from "@/lib/money";
import { api, toApiError, type AuthorizationTypedData } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { DepositError, useEscrowDeposit, type DepositPhase } from "@/lib/escrow-deposit";
import { queryKeys } from "@/lib/api/queries";
import { deserializeQuote } from "@/lib/offramp/model";
import { useWallet } from "@/lib/use-wallet";
import { FailureScreen } from "@/components/offramp/failure-screen";
import {
  DetailRow,
  formatNgn,
  formatUsdc,
  Notice,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
  StepActions,
  StepHeading,
  StepSkeleton,
} from "@/components/offramp/primitives";
import { useNow } from "@/components/offramp/use-now";
import { useStepGuard } from "@/components/offramp/use-step-guard";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { requestQuote, type FlowError } from "@/store/offramp-slice";

const ESCROW_STEPS = [
  { icon: Lock, title: "USDC is locked", text: "Your USDC moves into the MELO escrow contract, not to MELO or the provider." },
  { icon: Landmark, title: "Naira is paid out", text: "The payout provider sends naira to the bank account you entered." },
  {
    icon: ShieldCheck,
    title: "Released only after verification",
    text: "Escrow releases once the payout is verified. If it fails or times out, you're refunded.",
  },
];

type Phase = "idle" | "signing" | "submitting" | DepositPhase;
type AuthError = FlowError | { code: "rejected" | DepositError["code"]; message: string };

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  signing: "Check your wallet…",
  submitting: "Submitting authorization…",
  preparing: "Preparing your deposit…",
  switching: "Switching network…",
  approving: "Approve USDC in your wallet…",
  depositing: "Confirm the deposit in your wallet…",
  confirming: "Confirming onchain…",
};

/** Backend quotes have UUID ids; the in-browser simulation uses `qt_…`. */
const isBackendQuote = (quoteId: string) => /^[0-9a-f-]{36}$/i.test(quoteId);

/** The API sends uint values as decimal strings; the wallet needs them as bigint. */
function toSignable(data: AuthorizationTypedData) {
  const fields = data.types[data.primaryType] ?? [];
  const message: Record<string, string | bigint> = { ...data.message };
  for (const { name, type } of fields) {
    if (/^u?int\d*$/.test(type) && typeof message[name] === "string") message[name] = BigInt(message[name]);
  }
  return { ...data, message };
}

function isUserRejection(error: unknown) {
  return error instanceof BaseError && !!error.walk((e) => e instanceof UserRejectedRequestError);
}

export default function AuthorizeStep() {
  const { ready } = useStepGuard("authorize");
  return ready ? <Authorize /> : <StepSkeleton />;
}

function Authorize() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const { address } = useWallet();
  const { signTypedDataAsync } = useSignTypedData();
  const escrowDeposit = useEscrowDeposit();
  const { intentId, offer, recipient, preview, chainId } = useAppSelector((s) => s.offramp);
  const chain = getChain(chainId);
  const now = useNow();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<AuthError | null>(null);

  if (!intentId || !offer || !recipient) return <StepSkeleton />;

  const live = !preview && isBackendQuote(offer.quote.quoteId);
  const quote = deserializeQuote(offer.quote);
  const expired = now !== null && now >= quote.expiresAt;
  const secondsLeft = now === null ? null : Math.max(0, Math.ceil((quote.expiresAt - now) / 1000));

  const newQuote = () => {
    setError(null);
    dispatch(requestQuote({ walletAddress: preview ? null : (address ?? null) }));
    router.push("/cash-out/quote");
  };

  const finish = async (request: { signature: string; signer: string; escrowTxHash?: string }) => {
    setPhase("submitting");
    try {
      const view = await api.authorizeIntent(
        intentId,
        { quoteId: offer.quote.quoteId, ...request },
        { idempotencyKey: `auth_${offer.quote.quoteId}` },
      );
      queryClient.setQueryData(queryKeys.intent(view.id), view);
      queryClient.invalidateQueries({ queryKey: queryKeys.activity });
      router.push(`/intent/${view.id}`);
    } catch (err) {
      const apiError = toApiError(err);
      setPhase("idle");
      setError({ code: apiError.code, message: apiError.message });
    }
  };

  const lockUsdc = async () => {
    if (!address) return;
    setError(null);
    try {
      const { deposit, txHash } = await escrowDeposit(offer.quote.quoteId, setPhase);
      await finish({ signature: deposit.signature, signer: address, escrowTxHash: txHash });
    } catch (err) {
      setPhase("idle");
      if (isUserRejection(err)) {
        setError({ code: "rejected", message: "You cancelled in your wallet. Nothing was locked." });
      } else if (err instanceof DepositError) {
        setError({ code: err.code, message: err.message });
      } else if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "network", message: err instanceof Error ? err.message.split("\n")[0] : "The deposit failed." });
      }
    }
  };

  const authorize = async () => {
    if (live) return lockUsdc();
    setError(null);
    let signature = "0xpreview";
    let signer = "preview";
    if (!preview) {
      if (!address) return;
      setPhase("signing");
      try {
        signature = await signTypedDataAsync(toSignable(offer.authorization) as Parameters<typeof signTypedDataAsync>[0]);
        signer = address;
      } catch (err) {
        setPhase("idle");
        setError(
          isUserRejection(err)
            ? { code: "rejected", message: "You cancelled the signature in your wallet. Nothing was locked." }
            : { code: "network", message: err instanceof Error ? err.message.split("\n")[0] : "Signing failed." },
        );
        return;
      }
    }
    await finish({ signature, signer });
  };

  if (error?.code === "quote-expired") {
    return (
      <FailureScreen
        icon={TimerOff}
        title="The quote expired while you were signing"
        description="Rates are only held for a short window, and your signature arrived after it closed. Get a fresh quote and sign again."
        facts={[
          { kind: "safe", text: "Nothing was locked. Your USDC is still in your wallet." },
          { kind: "safe", text: "The signature you just made can't be reused. It was bound to the expired quote." },
          { kind: "info", text: "The new quote may have a slightly different rate. You'll review it before signing." },
        ]}
        actions={
          <>
            <button type="button" onClick={newQuote} className={primaryButtonClass}>
              <RotateCcw className="size-4" aria-hidden /> Get a new quote
            </button>
            <button type="button" onClick={() => router.push("/cash-out/details")} className={secondaryButtonClass}>
              Edit details
            </button>
          </>
        }
      />
    );
  }

  const busy = phase !== "idle";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <StepHeading
        title={live ? "Swap USDC to naira" : "Authorize swap"}
        description={
          live
            ? `Your wallet approves and deposits ${formatUsdc(quote.inputAmount, quote.inputDecimals)} into the MELO escrow contract on ${chain.name}.`
            : `You'll sign once in your wallet to lock ${formatUsdc(quote.inputAmount, quote.inputDecimals)} for this cash-out.`
        }
      />

      <ol className="flex flex-col gap-4">
        {ESCROW_STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-ink/10">
              <Icon className="size-4 text-teal-ink" aria-hidden />
            </span>
            <div className="min-w-0 pt-1">
              <p className="text-sm font-semibold text-ink">
                <span className="sr-only">{i + 1}. </span>
                {title}
              </p>
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <Panel className="p-0 sm:p-0">
        <div className="flex items-center gap-2 border-b border-ink/10 px-4 py-3">
          <FileSignature className="size-4 text-ink" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">What you&apos;re signing</h2>
        </div>
        <dl className="divide-y divide-ink/10 px-4">
          <DetailRow label="Amount" value={formatUsdc(quote.inputAmount, quote.inputDecimals)} strong />
          <DetailRow label="Token" value={`USDC ${shortHex(chain.usdc.address)}`} mono />
          <DetailRow label="Network" value={`${chain.name} (${chain.id})`} />
          <DetailRow label="Recipient" value={`${recipient.bankName} •••• ${recipient.accountNumber.slice(-4)}`} />
          <DetailRow label="Minimum payout" value={formatNgn(quote.netFiat, quote.fiatDecimals)} />
          <DetailRow label="Valid for" value={expired ? "Expired" : secondsLeft === null ? "—" : `${secondsLeft}s`} />
          <DetailRow label="Intent ID" value={intentId} mono />
        </dl>
      </Panel>

      <Notice icon={<Info aria-hidden />}>
        {preview
          ? "Preview mode: nothing is signed, and the escrow and payout that follow are simulated."
          : live && IS_MAINNET
            ? `This moves real USDC into the escrow contract on ${chain.name}${chain.gasToken === "USDC" ? ", and the network fee is paid in USDC" : ""}. Naira is sent to your bank account once it's locked.`
            : live
            ? `Testnet: this locks real test USDC in the escrow contract on ${chain.name}${chain.gasToken === "USDC" ? ", and the network fee is paid in USDC" : ""}. The naira payout after it is still simulated.`
            : "Testnet preview: you sign a typed authorization (EIP-712). No USDC moves and the steps after this are simulated."}
      </Notice>

      {error ? (
        <button type="button" onClick={() => setError(null)} className="text-left" aria-label={`${error.message} Dismiss`}>
          <Notice tone={error.code === "rejected" ? "neutral" : "danger"} icon={<AlertTriangle aria-hidden />}>
            {error.message}
          </Notice>
        </button>
      ) : null}

      <StepActions>
        {expired && !busy ? (
          <button type="button" onClick={newQuote} className={primaryButtonClass}>
            <RotateCcw className="size-4" aria-hidden /> Quote expired · get a new one
          </button>
        ) : (
          <button type="button" onClick={authorize} disabled={busy} className={primaryButtonClass}>
            {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {phase !== "idle" ? PHASE_LABEL[phase] : preview ? "Simulate authorization" : live ? "Swap" : "Sign & swap"}
          </button>
        )}
        <button type="button" onClick={() => router.push("/cash-out/quote")} disabled={busy} className={secondaryButtonClass}>
          Back to quote
        </button>
      </StepActions>
    </div>
  );
}
