/** Integer-only money helpers: amounts are bigint base units, never floats. */

export const USDC_DECIMALS = 6;
export const NGN_DECIMALS = 2;

/** "12.5" → 12500000n for 6 decimals; null if not a plain decimal or too precise. */
export function parseUnits(value: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) return null;
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** 12500000n → "12.5" for 6 decimals. */
export function formatUnits(units: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${units / base}${fraction ? `.${fraction}` : ""}`;
}

/** A provider rate such as "1347.65" as an exact fraction. */
export interface Rate {
  numerator: bigint;
  scale: number;
  text: string;
}

export function parseRate(text: string): Rate | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  const numerator = BigInt(whole! + fraction);
  return numerator > 0n ? { numerator, scale: fraction.length, text: text.trim() } : null;
}

/** Fiat minor units (kobo) for a USDC amount at `rate` fiat per USDC, rounded down. */
export function toFiatMinor(usdcUnits: bigint, rate: Rate, fiatDecimals = NGN_DECIMALS): bigint {
  return (usdcUnits * rate.numerator * 10n ** BigInt(fiatDecimals)) / 10n ** BigInt(USDC_DECIMALS + rate.scale);
}

/** Basis-point fee rounded up, so MELO never undercharges by a rounding unit. */
export function bpsOf(units: bigint, bps: number): bigint {
  return (units * BigInt(bps) + 9_999n) / 10_000n;
}
