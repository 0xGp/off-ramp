import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { PayoutStatus } from "../payouts/provider.ts";

/**
 * Paycrest signs the raw body with HMAC-SHA256 using the sender API Secret and sends the hex
 * digest in `X-Paycrest-Signature`. Compared as UTF-8 hex strings, per
 * https://docs.paycrest.io/implementation-guides/sender-api-integration (accessed 2026-10-06).
 */
export function verifyPaycrestSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  const signature = (header ?? "").trim().toLowerCase();
  if (!signature || !secret) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (computed.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(signature, "utf8"));
}

export function sha256Hex(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Off-ramp outcome per event. `validated` (fiat delivered) is recorded but the escrow is only
 * released at `settled`, when Paycrest's own onchain settlement is final; `refunded` and
 * `expired` mean the naira never left, so the user's escrow is refunded.
 */
export function outcomeForEvent(event: string): Exclude<PayoutStatus, "pending"> | null {
  switch (event) {
    case "payment_order.settled":
      return "succeeded";
    case "payment_order.refunded":
    case "payment_order.expired":
      return "failed";
    default:
      return null;
  }
}

export interface PaycrestWebhook {
  event: string;
  data: { id?: string; status?: string; [key: string]: unknown };
}

export function parseWebhook(rawBody: Buffer): PaycrestWebhook | null {
  try {
    const body = JSON.parse(rawBody.toString("utf8")) as { event?: unknown; data?: unknown };
    if (typeof body.event !== "string" || typeof body.data !== "object" || body.data === null) return null;
    return { event: body.event, data: body.data as PaycrestWebhook["data"] };
  } catch {
    return null;
  }
}

/** Copy of the payload safe to store: the recipient account number keeps only its last 4 digits. */
export function redactWebhookData(data: PaycrestWebhook["data"]): PaycrestWebhook["data"] {
  const copy = structuredClone(data) as Record<string, unknown>;
  const recipient = (copy.destination as { recipient?: Record<string, unknown> } | undefined)?.recipient;
  if (recipient && typeof recipient.accountIdentifier === "string") {
    recipient.accountIdentifier = `••••${recipient.accountIdentifier.slice(-4)}`;
  }
  return copy;
}
