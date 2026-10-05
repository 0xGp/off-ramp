import { formatUnits, parseUnits } from "@/lib/money";

/** Client-side pre-validation only; the backend enforces the real per-intent limits. */
export const USDC_DECIMALS = 6;
export const MIN_USDC = 1_000_000n;
export const MAX_USDC = 1_000_000_000n;

export function amountError(value: string): string | null {
  if (value.trim() === "") return null;
  const units = parseUnits(value, USDC_DECIMALS);
  if (units === null) return `Enter a number with up to ${USDC_DECIMALS} decimal places.`;
  if (units < MIN_USDC) return `Minimum is ${formatUnits(MIN_USDC, USDC_DECIMALS)} USDC.`;
  if (units > MAX_USDC) return `Maximum is ${formatUnits(MAX_USDC, USDC_DECIMALS)} USDC per cash-out.`;
  return null;
}

export function isValidAmount(value: string) {
  return value.trim() !== "" && amountError(value) === null;
}
