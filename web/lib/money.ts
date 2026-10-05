/**
 * Money is carried as integer base units (bigint) with explicit decimals.
 * Formatting is display-only; never parse formatted strings back into amounts.
 */
export function formatUnits(amount: bigint, decimals: number, maxFraction = 2): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let fractionStr = fraction.toString().padStart(decimals, "0").slice(0, maxFraction);
  fractionStr = fractionStr.replace(/0+$/, "");
  if (maxFraction >= 2 && fractionStr.length < 2) fractionStr = fractionStr.padEnd(2, "0");

  return `${negative ? "-" : ""}${wholeStr}${fractionStr ? `.${fractionStr}` : ""}`;
}

/**
 * Parses a user-typed decimal string into base units. Returns null for
 * anything that isn't a plain non-negative decimal within `decimals` places.
 */
export function parseUnits(input: string, decimals: number): bigint | null {
  const value = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(value) || value === "" || value === ".") return null;
  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function shortHex(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
