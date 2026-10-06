import type { NextRequest } from "next/server";
import { SUPPORTED_CHAINS } from "@/lib/chains";

// Same-origin JSON-RPC relay: browser blockers (uBlock, Brave Shields) block public RPC hosts
// like rpc.mainnet.arc.io, which stops balance reads and transaction sends in the app.
const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "net_version",
]);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 20;

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: unknown };

// Privy's embedded wallet may call this from its own origin. The relay only forwards the
// methods above to a public RPC, so it exposes nothing that isn't already public.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function rpcError(id: unknown, message: string, status = 400) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message } },
    { status, headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = await params;
  const chain = SUPPORTED_CHAINS.find((c) => String(c.id) === chainId);
  if (!chain) return rpcError(null, "Unsupported chain.", 404);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return rpcError(null, "Request too large.", 413);

  let body: RpcRequest | RpcRequest[];
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(null, "Invalid JSON.");
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return rpcError(null, "Invalid batch size.");
  const blocked = calls.find((c) => typeof c.method !== "string" || !ALLOWED_METHODS.has(c.method));
  if (blocked) return rpcError(blocked.id, `Method not allowed: ${String(blocked.method)}`, 403);

  // A raw transaction is idempotent by hash, so retrying it on the next endpoint can't double-send.
  for (const url of [chain.rpcUrl, ...chain.fallbackRpcUrls]) {
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (upstream.status >= 500 || upstream.status === 429) continue;
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
      });
    } catch {
      // DNS failure, timeout or reset: try the next endpoint.
    }
  }
  return rpcError(null, "Upstream RPC unavailable.", 502);
}
