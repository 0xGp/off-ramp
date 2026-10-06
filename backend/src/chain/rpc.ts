import { fallback, http, type Transport } from "viem";

/**
 * A transport over a comma-separated RPC list, trying each in order. Resending a signed
 * transaction to the next endpoint is safe: it's deduplicated by hash.
 */
export function rpcTransport(urls: string, timeout = 10_000): Transport {
  const list = urls.split(",").map((u) => u.trim()).filter(Boolean);
  if (list.length === 0) throw new Error("No RPC URL configured");
  return list.length === 1 ? http(list[0], { timeout }) : fallback(list.map((u) => http(u, { timeout, retryCount: 1 })));
}
