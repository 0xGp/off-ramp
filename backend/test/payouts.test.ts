import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, describe, it } from "node:test";

import type { Address, Hex } from "viem";

import type { Attestation, EscrowSettler, EscrowStatus, SettleReceipt } from "../src/chain/escrow.ts";
import {
  PayoutRejected,
  SimulatedPayoutProvider,
  type PayoutOrderInput,
  type PayoutProvider,
} from "../src/payouts/provider.ts";
import { PayoutService } from "../src/payouts/service.ts";
import { createTestApp, WEBHOOK_SECRET } from "./helpers.ts";

const ALICE = "did:privy:alice";
const WALLET = "0x10Ede187d03D651fc68f62a2d6501F67A6e93a86";

let settleTxCounter = 0;

class FakeSettler implements EscrowSettler {
  status = new Map<string, EscrowStatus>();
  submitted: Attestation[] = [];
  async escrowStatus(_c: number, _e: Address, intentId: Hex) {
    return this.status.get(intentId) ?? "escrowed";
  }
  async submit(_c: number, _e: Address, attestation: Attestation): Promise<Hex> {
    this.submitted.push(attestation);
    this.status.set(attestation.intentId, attestation.outcome === 1 ? "released" : "refunded");
    return `0x${String(++settleTxCounter).padStart(64, "a")}`;
  }
  async receipt(): Promise<SettleReceipt> {
    return { status: "success", blockNumber: 1n };
  }
}

describe("payouts", async () => {
  let clock = new Date("2026-10-01T09:00:00Z");
  const t = await createTestApp({ now: () => clock });
  const nowSec = () => Math.floor(clock.getTime() / 1000);
  t.profiles.profiles.set(ALICE, { walletAddress: WALLET, email: "a@example.com" });

  const call = async (method: "GET" | "POST" | "PUT", url: string, body?: unknown) => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const res = await t.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: res.json() };
  };

  await call("PUT", "/v1/me/bank-account", { institutionCode: "ABNGNGLA", accountNumber: "0123456789" });

  let txCounter = 0;
  async function escrowedDeposit() {
    const { body } = await call("POST", "/v1/quotes", { chainId: 5042002, amount: "10" });
    const { deposit } = (await call("POST", `/v1/quotes/${body.quote.id}/deposit`)).body;
    const txHash = `0x${(++txCounter).toString(16).padStart(64, "0")}`;
    t.chain.receipts.set(txHash, {
      status: "success",
      blockNumber: 9n,
      events: [
        {
          intentId: deposit.terms.intentId,
          depositor: deposit.terms.depositor,
          token: deposit.terms.token,
          amount: BigInt(deposit.terms.amount),
          payee: deposit.terms.payee,
          recipientCommitment: deposit.terms.recipientCommitment,
          refundAfter: BigInt(deposit.terms.refundAfter),
        },
      ],
    });
    const confirmed = await call("POST", `/v1/deposits/${deposit.id}/confirm`, { txHash });
    assert.equal(confirmed.body.deposit.status, "escrowed");
    return deposit as { id: string; terms: { intentId: Hex } };
  }

  after(async () => {
    await t.app.close();
    await t.db.end();
  });

  it("queues exactly one payout when a deposit is confirmed", async () => {
    await escrowedDeposit();
    const jobs = await t.db.query(
      `select count(*)::int as n from graphile_worker.jobs where task_identifier = 'payout_start'`,
    );
    assert.equal(jobs.rows[0].n, 1);
  });

  it("pays out, then releases the escrow to the payee, and is safe to rerun", async () => {
    const settler = new FakeSettler();
    const payouts = new PayoutService(
      t.db,
      new SimulatedPayoutProvider({ delaySeconds: 15, outcome: "succeeded" }, () => clock),
      settler,
      () => clock,
    );
    const deposit = await escrowedDeposit();

    const payoutId = await payouts.start(deposit.id);
    assert.equal(await payouts.start(deposit.id), payoutId, "one payout per deposit");
    assert.deepEqual(await payouts.poll(payoutId), { done: false });

    clock = new Date(clock.getTime() + 16_000);
    assert.deepEqual(await payouts.poll(payoutId), { done: true, status: "succeeded" });

    assert.deepEqual(await payouts.settle(payoutId), { done: false }, "submits settle");
    assert.equal(settler.submitted.length, 1);
    assert.equal(settler.submitted[0]!.outcome, 1);
    assert.equal(settler.submitted[0]!.intentId, deposit.terms.intentId);
    assert.equal(settler.submitted[0]!.expiry, BigInt(Math.floor(clock.getTime() / 1000) + 900));

    assert.deepEqual(await payouts.settle(payoutId), { done: true, escrow: "released" });
    assert.deepEqual(await payouts.settle(payoutId), { done: true, escrow: "released" });
    assert.equal(settler.submitted.length, 1, "never submits twice");

    const { rows } = await t.db.query(`select status from deposits where id = $1`, [deposit.id]);
    assert.equal(rows[0].status, "released");
    const audit = await t.db.query(
      `select kind from audit_events where kind in ('payout.succeeded', 'deposit.released') order by id`,
    );
    assert.deepEqual(audit.rows.map((r) => r.kind), ["payout.succeeded", "deposit.released"]);
  });

  it("refunds the depositor when the payout fails", async () => {
    const settler = new FakeSettler();
    const payouts = new PayoutService(
      t.db,
      new SimulatedPayoutProvider({ delaySeconds: 0, outcome: "failed" }, () => clock),
      settler,
      () => clock,
    );
    const deposit = await escrowedDeposit();
    const payoutId = await payouts.start(deposit.id);
    assert.deepEqual(await payouts.poll(payoutId), { done: true, status: "failed" });
    await payouts.settle(payoutId);
    assert.equal(settler.submitted[0]!.outcome, 2);
    assert.deepEqual(await payouts.settle(payoutId), { done: true, escrow: "refunded" });
  });

  it("sends the quote's decrypted account to the provider and stores the funding instructions", async () => {
    const seen: PayoutOrderInput[] = [];
    const provider: PayoutProvider = {
      name: "paycrest",
      async create(order) {
        seen.push(order);
        return {
          orderId: `ord-${order.reference}`,
          funding: { address: "0xReceive", amountUnits: 9_980_000n, validUntil: new Date("2026-10-01T09:10:00Z") },
        };
      },
      async status() {
        return "pending";
      },
    };
    const payouts = new PayoutService(t.db, provider, null, () => clock, t.cipher);
    const deposit = await escrowedDeposit();
    const payoutId = await payouts.start(deposit.id);

    assert.deepEqual(seen[0]!.recipient, { institution: "ABNGNGLA", accountIdentifier: "0123456789", accountName: "ADAEZE OKAFOR" });
    assert.equal(seen[0]!.reference, deposit.id);
    const { rows } = await t.db.query(
      `select status, funding_address, funding_amount_units, funding_valid_until from payouts where id = $1`,
      [payoutId],
    );
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].funding_address, "0xReceive");
    assert.equal(rows[0].funding_amount_units, "9980000");
    const audit = await t.db.query(`select data from audit_events where kind = 'payout.created' and data->>'payoutId' = $1`, [
      payoutId,
    ]);
    assert.ok(!JSON.stringify(audit.rows[0].data).includes("0123456789"), "audit never holds the account number");
  });

  it("fails the payout, so the escrow refunds, when the provider refuses the order", async () => {
    const provider: PayoutProvider = {
      name: "paycrest",
      async create() {
        throw new PayoutRejected("Rate is outside tolerance");
      },
      async status() {
        throw new Error("never polled");
      },
    };
    const payouts = new PayoutService(t.db, provider, null, () => clock, t.cipher);
    const deposit = await escrowedDeposit();
    const payoutId = await payouts.start(deposit.id);
    assert.equal(await payouts.start(deposit.id), payoutId);
    assert.deepEqual(await payouts.poll(payoutId), { done: true, status: "failed" });
    const { rows } = await t.db.query(`select provider_order_id, failure_reason from payouts where id = $1`, [payoutId]);
    assert.equal(rows[0].provider_order_id, null);
    assert.equal(rows[0].failure_reason, "Rate is outside tolerance");
  });

  describe("paycrest webhook", () => {
    const send = async (body: object, signature?: string) => {
      const raw = JSON.stringify(body);
      const res = await t.app.inject({
        method: "POST",
        url: "/v1/webhooks/paycrest",
        headers: {
          "content-type": "application/json",
          "x-paycrest-signature": signature ?? createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"),
        },
        payload: raw,
      });
      return { status: res.statusCode, body: res.json() };
    };
    const event = (name: string, orderId: string, status: string) => ({
      event: `payment_order.${name}`,
      webhookVersion: "2",
      data: {
        id: orderId,
        direction: "offramp",
        status,
        amount: "9.97",
        destination: { type: "fiat", currency: "NGN", recipient: { institution: "ABNGNGLA", accountIdentifier: "0123456789" } },
      },
    });
    const payoutRow = async (id: string) =>
      (await t.db.query(`select status, provider_order_id from payouts where id = $1`, [id])).rows[0];
    const settleJobs = async (payoutId: string) =>
      (
        await t.db.query(
          `select count(*)::int as n from graphile_worker.jobs where task_identifier = 'escrow_settle' and key = $1`,
          [`settle:${payoutId}`],
        )
      ).rows[0].n;

    it("rejects deliveries without a valid signature and stores nothing", async () => {
      const before = (await t.db.query(`select count(*)::int as n from provider_events`)).rows[0].n;
      const bad = await send(event("settled", "x", "settled"), "00".repeat(32));
      assert.equal(bad.status, 401);
      const missing = await t.app.inject({
        method: "POST",
        url: "/v1/webhooks/paycrest",
        headers: { "content-type": "application/json" },
        payload: "{}",
      });
      assert.equal(missing.statusCode, 401);
      assert.equal((await t.db.query(`select count(*)::int as n from provider_events`)).rows[0].n, before);
    });

    it("records validated, settles once on settled, and ignores redeliveries", async () => {
      const deposit = await escrowedDeposit();
      const payoutId = await t.payouts.start(deposit.id);
      const { provider_order_id: orderId } = await payoutRow(payoutId);

      assert.equal((await send(event("validated", orderId, "validated"))).status, 200);
      assert.equal((await payoutRow(payoutId)).status, "pending", "fiat delivered is not yet final");
      assert.equal(await settleJobs(payoutId), 0);

      const settled = event("settled", orderId, "settled");
      assert.equal((await send(settled)).status, 200);
      assert.equal((await send(settled)).status, 200, "redelivery is acknowledged");
      assert.equal((await payoutRow(payoutId)).status, "succeeded");
      assert.equal(await settleJobs(payoutId), 1);

      const stored = await t.db.query(
        `select event, payout_id, data from provider_events where order_id = $1 order by id`,
        [orderId],
      );
      assert.deepEqual(stored.rows.map((r) => r.event), ["payment_order.validated", "payment_order.settled"]);
      assert.equal(stored.rows[1].payout_id, payoutId);
      assert.equal(stored.rows[1].data.destination.recipient.accountIdentifier, "••••6789");
      const audit = await t.db.query(`select count(*)::int as n from audit_events where kind = 'payout.succeeded' and data->>'payoutId' = $1`, [payoutId]);
      assert.equal(audit.rows[0].n, 1);
    });

    it("marks the payout failed on expired so the escrow is refunded", async () => {
      const deposit = await escrowedDeposit();
      const payoutId = await t.payouts.start(deposit.id);
      const { provider_order_id: orderId } = await payoutRow(payoutId);
      assert.equal((await send(event("expired", orderId, "expired"))).status, 200);
      assert.equal((await payoutRow(payoutId)).status, "failed");
      assert.equal(await settleJobs(payoutId), 1);
      assert.equal((await send(event("settled", orderId, "settled"))).status, 200);
      assert.equal((await payoutRow(payoutId)).status, "failed", "a final status never flips");
    });

    it("acknowledges events for unknown orders without touching payouts", async () => {
      const res = await send(event("settled", "not-ours", "settled"));
      assert.equal(res.status, 200);
      const { rows } = await t.db.query(`select payout_id from provider_events where order_id = 'not-ours'`);
      assert.equal(rows[0].payout_id, null);
    });
  });
});
