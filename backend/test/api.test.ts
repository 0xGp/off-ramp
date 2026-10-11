import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { recoverTypedDataAddress } from "viem";

import { depositTermsTypes } from "../src/chain/escrow.ts";
import { createTestApp, PAYEE } from "./helpers.ts";

const ALICE = "did:privy:alice";
const BOB = "did:privy:bob";
const WALLET = "0x10Ede187d03D651fc68f62a2d6501F67A6e93a86";
const BOB_WALLET = "0x8C4D6fDe62399ffAC59f94748aD7971d146D7C85";

describe("API", async () => {
  let clock = new Date("2026-10-01T09:00:00Z");
  const t = await createTestApp({ now: () => clock });
  const nowSec = () => Math.floor(clock.getTime() / 1000);

  const call = async (method: "GET" | "POST" | "PUT", url: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await t.app.inject({
      method,
      url,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      ...(opts.body === undefined ? {} : { payload: opts.body as object }),
    });
    return { status: res.statusCode, body: res.json(), raw: res.body };
  };

  before(() => {
    t.profiles.profiles.set(ALICE, { walletAddress: WALLET.toLowerCase(), email: "adaeze@example.com", name: "Adaeze Okafor" });
  });
  after(async () => {
    await t.app.close();
    await t.db.end();
  });

  it("reports health", async () => {
    assert.deepEqual((await call("GET", "/healthz")).body, { ok: true });
  });

  it("has no admin routes without a configured admin password", async () => {
    assert.equal((await call("POST", "/v1/admin/login", { body: { password: "x" } })).status, 404);
  });

  it("rejects requests without a token", async () => {
    const res = await call("GET", "/v1/me");
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "unauthenticated");
  });

  it("creates the account on first sight with the Google profile and a checksummed wallet", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const first = await call("GET", "/v1/me", { token });
    assert.equal(first.status, 200);
    assert.equal(first.body.walletAddress, WALLET);
    assert.equal(first.body.email, "adaeze@example.com");
    assert.equal(first.body.displayName, "Adaeze Okafor");
    assert.equal(first.body.bankAccount, null);
    assert.deepEqual(first.body.onboarding, { complete: false, nextStep: "bank-account", completedAt: null });

    const lookups = t.profiles.calls;
    const again = await call("GET", "/v1/me", { token });
    assert.equal(again.body.id, first.body.id);
    assert.equal(t.profiles.calls, lookups, "a complete profile isn't fetched from Privy again");
    const { rows } = await t.db.query("select count(*)::int as n from users");
    assert.equal(rows[0].n, 1);
    const created = await t.db.query("select count(*)::int as n from audit_events where kind = 'account.created'");
    assert.equal(created.rows[0].n, 1);
  });

  it("asks for the wallet first while Privy hasn't created it, then links it", async () => {
    const token = await t.signer.token({ sub: BOB, iat: nowSec() });
    const before = await call("GET", "/v1/me", { token });
    assert.equal(before.body.walletAddress, null);
    assert.equal(before.body.onboarding.nextStep, "wallet");

    t.profiles.profiles.set(BOB, { walletAddress: BOB_WALLET, email: "bob@example.com" });
    const after = await call("GET", "/v1/me", { token });
    assert.equal(after.body.walletAddress, BOB_WALLET);
    assert.equal(after.body.onboarding.nextStep, "bank-account");
  });

  it("lists banks without auth", async () => {
    const res = await call("GET", "/v1/banks");
    assert.equal(res.body.banks.length, 2);
  });

  it("validates account numbers and banks before calling Paycrest", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const before = t.directory.verifyCalls;
    const short = await call("POST", "/v1/bank-accounts/verify", {
      token,
      body: { institutionCode: "ABNGNGLA", accountNumber: "12345" },
    });
    assert.equal(short.status, 422);
    const unknownBank = await call("POST", "/v1/bank-accounts/verify", {
      token,
      body: { institutionCode: "NOPE", accountNumber: "0123456789" },
    });
    assert.equal(unknownBank.status, 422);
    assert.equal(t.directory.verifyCalls, before);
  });

  it("verifies a name without storing anything", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const res = await call("POST", "/v1/bank-accounts/verify", {
      token,
      body: { institutionCode: "ABNGNGLA", accountNumber: "0123456789" },
    });
    assert.deepEqual(res.body, { accountName: "ADAEZE OKAFOR", institutionName: "Access Bank" });
    const { rows } = await t.db.query("select count(*)::int as n from bank_accounts");
    assert.equal(rows[0].n, 0);
  });

  it("saves the first bank account, usable immediately, encrypted at rest", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const res = await call("PUT", "/v1/me/bank-account", {
      token,
      body: { institutionCode: "ABNGNGLA", accountNumber: "0123456789" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.bankAccount.accountLast4, "6789");
    assert.equal(res.body.bankAccount.usable, true);
    assert.ok(!res.raw.includes("0123456789"), "response must not contain the full account number");

    const { rows } = await t.db.query("select account_number_ciphertext from bank_accounts");
    assert.equal(t.cipher.decrypt(rows[0].account_number_ciphertext), "0123456789");

    const jobs = await t.db.query(
      "select count(*)::int as n from graphile_worker.jobs where task_identifier = 'bank_account_changed'",
    );
    assert.equal(jobs.rows[0].n, 1);
    const audit = await t.db.query("select data from audit_events where kind = 'bank_account.added'");
    assert.equal(audit.rows.length, 1);
    assert.ok(!JSON.stringify(audit.rows[0].data).includes("0123456789"));
  });

  it("completes onboarding once the wallet and bank account exist, recorded once", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const res = await call("GET", "/v1/me", { token });
    assert.equal(res.body.onboarding.complete, true);
    assert.equal(res.body.onboarding.nextStep, null);
    assert.ok(!Number.isNaN(Date.parse(res.body.onboarding.completedAt)));

    await call("GET", "/v1/me", { token });
    const audit = await t.db.query(
      "select count(*)::int as n from audit_events where kind = 'account.onboarded'",
    );
    assert.equal(audit.rows[0].n, 1);
  });

  it("quotes NGN for a USDC amount with integer math and stores the offer", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const res = await call("POST", "/v1/quotes", { token, body: { chainId: 5042002, amount: "100" } });
    assert.equal(res.status, 201);
    const q = res.body.quote;
    assert.equal(q.amount, "100000000");
    assert.equal(q.fee, "300000", "30 bps of 100 USDC");
    assert.equal(q.payoutAmount, "99700000");
    assert.equal(q.rate, "1500.25");
    assert.deepEqual(q.fiat, { currency: "NGN", decimals: 2, gross: "15002500", fee: "45008", net: "14957492" });
    assert.equal(q.token, "0x3600000000000000000000000000000000000000");
    assert.deepEqual(q.payTo, { institutionName: "Access Bank", accountName: "ADAEZE OKAFOR", accountLast4: "6789" });
    assert.equal(q.issuedAt, clock.toISOString());
    assert.equal(Date.parse(q.expiresAt) - Date.parse(q.issuedAt), 90_000);
    assert.deepEqual(t.directory.rateCalls.at(-1), { network: "base", amount: "99.7" }, "priced on the payout amount");

    const { rows } = await t.db.query("select provider_ids from quotes where id = $1", [q.id]);
    assert.deepEqual(rows[0].provider_ids, ["prov-a", "prov-b"]);

    const fetched = await call("GET", `/v1/quotes/${q.id}`, { token });
    assert.deepEqual(fetched.body.quote, q);
  });

  it("hides another user's quote", async () => {
    const alice = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const created = await call("POST", "/v1/quotes", { token: alice, body: { chainId: 84532, amount: "5" } });
    const bob = await t.signer.token({ sub: BOB, iat: nowSec() });
    const res = await call("GET", `/v1/quotes/${created.body.quote.id}`, { token: bob });
    assert.equal(res.status, 404);
  });

  it("requires a saved bank account before quoting", async () => {
    const bob = await t.signer.token({ sub: BOB, iat: nowSec() });
    const res = await call("POST", "/v1/quotes", { token: bob, body: { chainId: 84532, amount: "5" } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "account-incomplete");
  });

  it("rejects unsupported chains and out-of-range or over-precise amounts without calling Paycrest", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const before = t.directory.rateCalls.length;
    for (const body of [
      { chainId: 1, amount: "5" },
      { chainId: 84532, amount: "0.99" },
      { chainId: 84532, amount: "1000.000001" },
      { chainId: 84532, amount: "1.0000001" },
      { chainId: 84532, amount: "-5" },
      { chainId: 84532, amount: "1e3" },
    ]) {
      const res = await call("POST", "/v1/quotes", { token, body });
      assert.equal(res.status, 422, JSON.stringify(body));
    }
    assert.equal(t.directory.rateCalls.length, before);
  });

  it("reports when no payout partner can fill the amount", async () => {
    t.directory.noRoute = true;
    try {
      const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
      const res = await call("POST", "/v1/quotes", { token, body: { chainId: 84532, amount: "5" } });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, "no-route");
    } finally {
      t.directory.noRoute = false;
    }
  });

  it("signs DepositTerms for a quote that recover to the quote signer, once per quote", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const { body } = await call("POST", "/v1/quotes", { token, body: { chainId: 5042002, amount: "25" } });
    const quote = body.quote;

    const res = await call("POST", `/v1/quotes/${quote.id}/deposit`, { token });
    assert.equal(res.status, 200);
    const d = res.body.deposit;
    assert.equal(d.status, "awaiting_deposit");
    assert.equal(d.chainId, 5042002);
    assert.equal(d.escrow, "0x8C4D6fDe62399ffAC59f94748aD7971d146D7C85");
    assert.equal(d.terms.depositor, WALLET);
    assert.equal(d.terms.token, "0x3600000000000000000000000000000000000000");
    assert.equal(d.terms.amount, "25000000");
    assert.equal(d.terms.payee, PAYEE);
    assert.equal(d.terms.quoteExpiry, String(Date.parse(quote.expiresAt) / 1000));
    assert.equal(BigInt(d.terms.refundAfter) - BigInt(d.terms.quoteExpiry), 7200n);
    assert.match(d.terms.intentId, /^0x[0-9a-f]{64}$/);

    const recovered = await recoverTypedDataAddress({
      domain: { name: "MeloEscrow", version: "1", chainId: 5042002, verifyingContract: d.escrow },
      types: depositTermsTypes,
      primaryType: "DepositTerms",
      message: {
        ...d.terms,
        amount: BigInt(d.terms.amount),
        quoteExpiry: BigInt(d.terms.quoteExpiry),
        refundAfter: BigInt(d.terms.refundAfter),
      },
      signature: d.signature,
    });
    assert.equal(recovered, t.quoteSigner.address);

    const again = await call("POST", `/v1/quotes/${quote.id}/deposit`, { token });
    assert.deepEqual(again.body.deposit, d, "same terms for the same quote");

    const bob = await t.signer.token({ sub: BOB, iat: nowSec() });
    assert.equal((await call("POST", `/v1/quotes/${quote.id}/deposit`, { token: bob })).status, 404);
  });

  it("refuses to sign for an expired quote", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const { body } = await call("POST", "/v1/quotes", { token, body: { chainId: 5042002, amount: "5" } });
    const start = clock;
    clock = new Date(start.getTime() + 91_000);
    try {
      const res = await call("POST", `/v1/quotes/${body.quote.id}/deposit`, { token });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, "quote-expired");
    } finally {
      clock = start;
    }
  });

  it("confirms a deposit only from a successful transaction with the matching Deposited event", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const { body } = await call("POST", "/v1/quotes", { token, body: { chainId: 5042002, amount: "10" } });
    const { deposit } = (await call("POST", `/v1/quotes/${body.quote.id}/deposit`, { token })).body;
    const confirm = (txHash: string) => call("POST", `/v1/deposits/${deposit.id}/confirm`, { token, body: { txHash } });
    const event = {
      intentId: deposit.terms.intentId,
      depositor: deposit.terms.depositor,
      token: deposit.terms.token,
      amount: BigInt(deposit.terms.amount),
      payee: deposit.terms.payee,
      recipientCommitment: deposit.terms.recipientCommitment,
      refundAfter: BigInt(deposit.terms.refundAfter),
    };

    const listed = async () => (await call("GET", "/v1/activity", { token })).body.activity as { id: string }[];
    assert.ok(!(await listed()).some((a) => a.id === deposit.id), "unfunded deposits aren't activity");

    const pending = await confirm(`0x${"1".repeat(64)}`);
    assert.equal(pending.status, 409);
    assert.equal(pending.body.error.code, "chain-pending");

    t.chain.receipts.set(`0x${"2".repeat(64)}`, { status: "reverted" });
    assert.equal((await confirm(`0x${"2".repeat(64)}`)).status, 422);

    t.chain.receipts.set(`0x${"3".repeat(64)}`, {
      status: "success",
      blockNumber: 7n,
      events: [{ ...event, amount: event.amount - 1n }],
    });
    assert.equal((await confirm(`0x${"3".repeat(64)}`)).status, 422, "amount must match the signed terms");

    const good = `0x${"4".repeat(64)}`;
    t.chain.receipts.set(good, { status: "success", blockNumber: 8n, events: [event] });
    const ok = await confirm(good);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.deposit.status, "escrowed");
    assert.equal(ok.body.deposit.txHash, good);

    assert.equal((await confirm(good)).status, 200, "confirming again with the same tx is a no-op");
    assert.equal((await confirm(`0x${"3".repeat(64)}`)).status, 422);
    const audit = await t.db.query("select count(*)::int as n from audit_events where kind = 'deposit.escrowed'");
    assert.equal(audit.rows[0].n, 1);
    assert.equal((await call("GET", `/v1/deposits/${deposit.id}`, { token })).body.deposit.status, "escrowed");

    assert.ok((await listed()).some((a) => a.id === deposit.id));
    const item = (await call("GET", `/v1/activity/${deposit.id}`, { token })).body.activity;
    assert.equal(item.depositStatus, "escrowed");
    assert.equal(item.depositTxHash, good);
    assert.equal(item.quote.id, body.quote.id);
    const stranger = await t.signer.token({ sub: "did:privy:stranger", iat: nowSec() });
    assert.equal((await call("GET", `/v1/activity/${deposit.id}`, { token: stranger })).status, 404);
  });

  it("treats saving the same account again as a no-op", async () => {
    const token = await t.signer.token({ sub: ALICE, iat: nowSec() - 3600 });
    const res = await call("PUT", "/v1/me/bank-account", {
      token,
      body: { institutionCode: "ABNGNGLA", accountNumber: "0123456789" },
    });
    assert.equal(res.status, 200);
    const { rows } = await t.db.query("select count(*)::int as n from bank_accounts");
    assert.equal(rows[0].n, 1);
  });

  it("requires a fresh login to change the bank account", async () => {
    const stale = await t.signer.token({ sub: ALICE, iat: nowSec() - 301 });
    const res = await call("PUT", "/v1/me/bank-account", {
      token: stale,
      body: { institutionCode: "GTBINGLA", accountNumber: "9876543210" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "reauth-required");
  });

  it("puts a replacement account on a 24h cooldown", async () => {
    const fresh = await t.signer.token({ sub: ALICE, iat: nowSec() });
    const res = await call("PUT", "/v1/me/bank-account", {
      token: fresh,
      body: { institutionCode: "GTBINGLA", accountNumber: "9876543210" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.bankAccount.usable, false);
    assert.equal(res.body.bankAccount.usableFrom, "2026-10-02T09:00:00.000Z");

    const { rows } = await t.db.query("select status from bank_accounts order by created_at");
    assert.deepEqual(
      rows.map((r) => r.status),
      ["replaced", "active"],
    );

    const blocked = await call("POST", "/v1/quotes", { token: fresh, body: { chainId: 84532, amount: "5" } });
    assert.equal(blocked.status, 409, "no quotes to an account still in cooldown");

    clock = new Date("2026-10-02T09:00:01Z");
    const later = await call("GET", "/v1/me", { token: await t.signer.token({ sub: ALICE, iat: nowSec() }) });
    assert.equal(later.body.bankAccount.usable, true);
  });

  it("maps a Paycrest outage to provider-unavailable", async () => {
    t.directory.down = true;
    try {
      const res = await call("GET", "/v1/banks");
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "provider-unavailable");
    } finally {
      t.directory.down = false;
    }
  });
});
