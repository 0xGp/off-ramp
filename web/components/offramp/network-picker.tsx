"use client";

import { useId } from "react";
import { CircleCheck } from "lucide-react";
import { UsdcIcon } from "@/components/usdc-icon";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setChainId } from "@/store/offramp-slice";

/** Chooses which network's escrow the USDC is locked in. Payouts are the same either way. */
export function NetworkPicker({ disabled }: { disabled?: boolean }) {
  const dispatch = useAppDispatch();
  const chainId = useAppSelector((s) => s.offramp.chainId);
  const name = useId();

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium text-ink">Pay from</legend>
      <div className="grid grid-cols-2 gap-2">
        {SUPPORTED_CHAINS.map((chain) => {
          const checked = chain.id === chainId;
          return (
            <label
              key={chain.id}
              className={cn(
                "relative flex min-h-16 cursor-pointer flex-col justify-center gap-0.5 rounded-xl bg-white px-4 py-3 ring-1 ring-inset transition-[box-shadow,background-color] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal",
                checked ? "bg-accent ring-2 ring-teal" : "ring-ink/15 hover:bg-muted/60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={chain.id}
                checked={checked}
                onChange={() => dispatch(setChainId(chain.id))}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <UsdcIcon />
                USDC on {chain.name.split(" ")[0]}
              </span>
              {checked ? (
                <CircleCheck className="absolute right-3 top-3 size-4 text-teal-ink" aria-hidden />
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
