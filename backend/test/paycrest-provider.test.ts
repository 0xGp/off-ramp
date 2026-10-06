import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PaycrestPayoutProvider, paycrestStatus } from "../src/payouts/paycrest.ts";
import { PayoutRejected } from "../src/payouts/provider.ts";

const REFUND = "0x10Ede187d03D651fc68f62a2d6501F67A6e93a86";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const order = {
  reference: "dep-1",
  amountUnits: 9_970_000n,
  rate: "1356.15",
  providerIds: ["p1", "p2", "p3", "p4"],
  recipient: { institution: "OPAYNGPC", accountIdentifier: "8012345678", accountName: "Ada Obi" },
};

describe("PaycrestPayoutProvider", () => {
  it("creates an off-ramp order on Base and returns the funding instructions", async () => {
    const f = fakeFetch(201, {
      status: "success",
      data: {
        id: "ord-1",
        status: "initiated",
        providerAccount: {
          network: "base",
          receiveAddress: "0xReceive",
          amountToTransfer: "9.98",
          validUntil: "2026-10-06T18:05:00Z",
          currency: "USDC",
        },
      },
    });
    const provider = new PaycrestPayoutProvider({ baseUrl: "https://api.paycrest.io/v2/", apiKey: "k", refundAddress: REFUND }, f.impl);
    const created = await provider.create(order);

    assert.deepEqual(created, {
      orderId: "ord-1",
      funding: { address: "0xReceive", amountUnits: 9_980_000n, validUntil: new Date("2026-10-06T18:05:00Z") },
    });
    assert.equal(f.calls[0]!.url, "https://api.paycrest.io/v2/sender/orders");
    assert.equal((f.calls[0]!.init.headers as Record<string, string>)["API-Key"], "k");
    assert.deepEqual(JSON.parse(f.calls[0]!.init.body as string), {
      amount: "9.97",
      rate: "1356.15",
      reference: "dep-1",
      source: { type: "crypto", currency: "USDC", network: "base", refundAddress: REFUND },
      destination: {
        type: "fiat",
        currency: "NGN",
        recipient: { institution: "OPAYNGPC", accountIdentifier: "8012345678", accountName: "Ada Obi", memo: "MELO cash-out" },
        providerIds: ["p1", "p2", "p3"],
      },
    });
  });

  it("treats a refused order as final and outages as retryable", async () => {
    const refused = new PaycrestPayoutProvider(
      { baseUrl: "https://x/v2", apiKey: "k", refundAddress: REFUND },
      fakeFetch(400, { status: "error", message: "Rate is outside tolerance" }).impl,
    );
    await assert.rejects(refused.create(order), (e) => e instanceof PayoutRejected && /tolerance/.test(e.message));

    const down = new PaycrestPayoutProvider({ baseUrl: "https://x/v2", apiKey: "k", refundAddress: REFUND }, fakeFetch(502, {}).impl);
    await assert.rejects(down.create(order), (e) => !(e instanceof PayoutRejected));

    const badKey = new PaycrestPayoutProvider({ baseUrl: "https://x/v2", apiKey: "k", refundAddress: REFUND }, fakeFetch(401, {}).impl);
    await assert.rejects(badKey.create(order), (e) => !(e instanceof PayoutRejected));
  });

  it("refuses to place an order without the recipient", async () => {
    const provider = new PaycrestPayoutProvider({ baseUrl: "https://x/v2", apiKey: "k", refundAddress: REFUND }, fakeFetch(201, {}).impl);
    await assert.rejects(provider.create({ ...order, recipient: null }));
  });

  it("polls the order and maps statuses", async () => {
    const f = fakeFetch(200, { status: "success", data: { id: "ord-1", status: "validated" } });
    const provider = new PaycrestPayoutProvider({ baseUrl: "https://x/v2", apiKey: "k", refundAddress: REFUND }, f.impl);
    assert.equal(await provider.status({ orderId: "ord-1" }), "pending");
    assert.equal(f.calls[0]!.url, "https://x/v2/sender/orders/ord-1");

    assert.equal(paycrestStatus("initiated"), "pending");
    assert.equal(paycrestStatus("deposited"), "pending");
    assert.equal(paycrestStatus("validated"), "pending");
    assert.equal(paycrestStatus("settled"), "succeeded");
    assert.equal(paycrestStatus("refunded"), "failed");
    assert.equal(paycrestStatus("expired"), "failed");
  });
});
