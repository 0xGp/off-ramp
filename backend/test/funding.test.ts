import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import { keccak256, toHex, type Address, type Hex } from "viem";

import type { SignedTransfer, TransferReceipt, TreasuryFunder } from "../src/chain/treasury.ts";
import { PayoutFunding } from "../src/payouts/funding.ts";
import type { PayoutProvider } from "../src/payouts/provider.ts";
import { PayoutService } from "../src/payouts/service.ts";
import { createTestApp } from "./helpers.ts";

const ALICE = "did:privy:alice-funding";
const WALLET = "0x10Ede187d03D651fc68f62a2d6501F67A6e93a86";
const RECEIVE = "0x00000000000000000000000000000000000000Aa";

class FakeFunder implements TreasuryFunder {
  readonly address: Address = "0x0000000000000000000000000000000000000077";
  usdcUnits = 100_000_000n;
  ethWei = 10n ** 16n;
  signed: SignedTransfer[] = [];
  broadcasts: Hex[] = [];
  receipts = new Map<Hex, TransferReceipt>();
  async balances() {
    return { usdcUnits: this.usdcUnits, ethWei: this.ethWei };
  }
  async signTransfer(to: Address, amountUnits: bigint): Promise<SignedTransfer> {
    const raw = toHex(`${to}:${amountUnits}:${randomUUID()}`);
    const transfer = { hash: keccak256(raw), raw };
    this.signed.push(transfer);
    return transfer;
  }
  async broadcast(raw: Hex) {
    this.broadcasts.push(raw);
  }
  async receipt(hash: Hex): Promise<TransferReceipt> {
    return this.receipts.get(hash) ?? { status: "unknown" };
  }
}

describe("treasury funding", async () => {
  let clock = new Date("2026-10-06T18:00:00Z");
  const t = await createTestApp({ now: () => clock });
  const nowSec = () => Math.floor(clock.getTime() / 1000);
  t.profiles.profiles.set(ALICE, { walletAddress: WALLET, email: "f@example.com" });

  const call = async (method: "GET" | "POST" | "PUT", url: string, body?: unknown) => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const res = await t.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return res.json();
  };
  await call("PUT", "/v1/me/bank-account", { institutionCode: "ABNGNGLA", accountNumber: "0123456789" });

  let txCounter = 0;
  let fundingUnits = 1_010_000n;
  let validFor = 5 * 60_000;
  const provider: PayoutProvider = {
    name: "paycrest",
    async create(order) {
      return {
        orderId: `ord-${order.reference}`,
        funding: { address: RECEIVE, amountUnits: fundingUnits, validUntil: new Date(clock.getTime() + validFor) },
      };
    },
    async status() {
      return "pending";
    },
  };
  const payouts = new PayoutService(t.db, provider, null, () => clock, t.cipher);

  async function newPayout(): Promise<string> {
    const { quote } = await call("POST", "/v1/quotes", { chainId: 5042002, amount: "1" });
    const { deposit } = await call("POST", `/v1/quotes/${quote.id}/deposit`);
    const txHash = `0x${(0xf000 + ++txCounter).toString(16).padStart(64, "0")}`;
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
    await call("POST", `/v1/deposits/${deposit.id}/confirm`, { txHash });
    return payouts.start(deposit.id);
  }

  after(async () => {
    await t.app.close();
    await t.db.end();
  });

  it("records the transfer before broadcasting it and pays each order exactly once", async () => {
    const funder = new FakeFunder();
    const funding = new PayoutFunding(t.db, funder, 5_000_000n, () => clock);
    const payoutId = await newPayout();

    assert.deepEqual(await funding.fund(payoutId), { done: false });
    assert.equal(funder.signed.length, 1);
    assert.deepEqual(funder.broadcasts, [funder.signed[0]!.raw]);
    const { rows } = await t.db.query(`select funding_tx_hash from payouts where id = $1`, [payoutId]);
    assert.equal(rows[0].funding_tx_hash, funder.signed[0]!.hash);

    funder.receipts.set(funder.signed[0]!.hash, { status: "pending" });
    assert.deepEqual(await funding.fund(payoutId), { done: false });
    funder.receipts.set(funder.signed[0]!.hash, { status: "success", blockNumber: 1n });
    const funded = { done: true, outcome: "funded", txHash: funder.signed[0]!.hash };
    assert.deepEqual(await funding.fund(payoutId), funded);
    assert.deepEqual(await funding.fund(payoutId), funded);
    assert.equal(funder.signed.length, 1, "never signs a second transfer");
  });

  it("lets only one of two concurrent attempts send", async () => {
    const funder = new FakeFunder();
    const funding = new PayoutFunding(t.db, funder, 5_000_000n, () => clock);
    const payoutId = await newPayout();
    await Promise.all([funding.fund(payoutId), funding.fund(payoutId)]);
    const { rows } = await t.db.query(`select funding_raw_tx from payouts where id = $1`, [payoutId]);
    assert.ok(funder.broadcasts.length >= 1);
    assert.ok(
      funder.broadcasts.every((raw) => raw === rows[0].funding_raw_tx),
      "only the recorded transfer is ever broadcast",
    );
  });

  it("skips orders over the cap, too close to the deadline, or beyond the treasury", async () => {
    const funder = new FakeFunder();
    const funding = new PayoutFunding(t.db, funder, 5_000_000n, () => clock);

    fundingUnits = 5_000_001n;
    const overCap = await newPayout();
    assert.deepEqual(await funding.fund(overCap), { done: true, outcome: "skipped", reason: "over-cap" });
    fundingUnits = 1_010_000n;

    validFor = 30_000;
    const late = await newPayout();
    assert.deepEqual(await funding.fund(late), { done: true, outcome: "skipped", reason: "too-late" });
    validFor = 5 * 60_000;

    funder.usdcUnits = 1_000_000n;
    const low = await newPayout();
    assert.deepEqual(await funding.fund(low), { done: true, outcome: "skipped", reason: "treasury-usdc-low" });
    funder.usdcUnits = 100_000_000n;

    funder.ethWei = 0n;
    const noGas = await newPayout();
    assert.deepEqual(await funding.fund(noGas), { done: true, outcome: "skipped", reason: "treasury-gas-low" });

    assert.equal(funder.signed.length, 0);
    assert.deepEqual(await funding.fund(overCap), { done: true, outcome: "skipped", reason: "over-cap" }, "sticky");
  });

  it("rebroadcasts the same bytes before the deadline, never after, then gives up", async () => {
    const funder = new FakeFunder();
    const funding = new PayoutFunding(t.db, funder, 5_000_000n, () => clock);
    const payoutId = await newPayout();
    await funding.fund(payoutId);
    const raw = funder.signed[0]!.raw;

    await funding.fund(payoutId);
    assert.deepEqual(funder.broadcasts, [raw, raw]);

    const start = clock;
    clock = new Date(start.getTime() + 6 * 60_000);
    await funding.fund(payoutId);
    assert.equal(funder.broadcasts.length, 2, "no broadcast past the deadline");

    clock = new Date(start.getTime() + 16 * 60_000);
    assert.deepEqual(await funding.fund(payoutId), { done: true, outcome: "abandoned", reason: "funding-not-mined" });
    assert.equal(funder.signed.length, 1);
    clock = start;
  });

  it("has nothing to do for payouts without funding instructions", async () => {
    const funder = new FakeFunder();
    const funding = new PayoutFunding(t.db, funder, 5_000_000n, () => clock);
    const simulated = new PayoutService(t.db, t.paycrest, null, () => clock);
    const { quote } = await call("POST", "/v1/quotes", { chainId: 5042002, amount: "1" });
    const { deposit } = await call("POST", `/v1/quotes/${quote.id}/deposit`);
    const txHash = `0x${(0xe000 + ++txCounter).toString(16).padStart(64, "0")}`;
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
    await call("POST", `/v1/deposits/${deposit.id}/confirm`, { txHash });
    const payoutId = await simulated.start(deposit.id);
    assert.deepEqual(await funding.fund(payoutId), { done: true, outcome: "not-needed" });
  });
});
