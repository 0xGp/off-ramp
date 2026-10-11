import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { ADMIN_PASSWORD, createTestApp } from "./helpers.ts";

const ALICE = "did:privy:alice";
const WALLET = "0x10Ede187d03D651fc68f62a2d6501F67A6e93a86";

describe("admin", async () => {
  const t = await createTestApp({ admin: true });
  after(async () => {
    await t.app.close();
    await t.db.end();
  });

  const inject = async (
    method: "GET" | "POST" | "PUT",
    url: string,
    opts: { token?: string; cookie?: string; body?: unknown; ip?: string } = {},
  ) => {
    const res = await t.app.inject({
      method,
      url,
      remoteAddress: opts.ip,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      ...(opts.body === undefined ? {} : { payload: opts.body as object }),
    });
    return { status: res.statusCode, body: res.json(), headers: res.headers };
  };

  const login = async (password: string, ip = "10.0.0.1") => {
    const res = await inject("POST", "/v1/admin/login", { body: { password }, ip });
    const setCookie = String(res.headers["set-cookie"] ?? "");
    return { ...res, setCookie, cookie: setCookie.split(";")[0]! };
  };

  it("keeps every admin view behind the password", async () => {
    for (const path of ["session", "overview", "cashouts", "events", "users", "jobs"]) {
      const res = await inject("GET", `/v1/admin/${path}`);
      assert.equal(res.status, 401, path);
    }
    assert.equal((await inject("GET", "/v1/admin/overview", { cookie: "melo_admin=9999999999.forged" })).status, 401);

    const wrong = await login("nope");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.setCookie, "");
  });

  it("signs in with an HttpOnly, path-scoped session cookie", async () => {
    const res = await login(ADMIN_PASSWORD);
    assert.equal(res.status, 200);
    assert.match(res.setCookie, /^melo_admin=\d+\.[\w-]+; Path=\/v1\/admin; HttpOnly; SameSite=Strict; Max-Age=28800/);
    const session = await inject("GET", "/v1/admin/session", { cookie: res.cookie });
    assert.equal(session.status, 200);
    assert.equal(session.headers["cache-control"], "no-store");
  });

  it("locks an address out after repeated wrong passwords, even for the right one", async () => {
    const ip = "10.0.0.9";
    for (let i = 0; i < 5; i++) assert.equal((await login("wrong", ip)).status, 401);
    const locked = await login(ADMIN_PASSWORD, ip);
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, "rate-limited");
    assert.equal((await login(ADMIN_PASSWORD, "10.0.0.10")).status, 200, "other addresses are unaffected");
  });

  it("shows a cash-out with its user and bank, without the account number", async () => {
    const { cookie } = await login(ADMIN_PASSWORD, "10.0.0.2");
    t.profiles.profiles.set(ALICE, { walletAddress: WALLET.toLowerCase(), email: "adaeze@example.com", name: "Adaeze" });
    const token = await t.signer.token({ sub: ALICE });
    await inject("GET", "/v1/me", { token });
    assert.equal(
      (await inject("PUT", "/v1/me/bank-account", { token, body: { institutionCode: "ABNGNGLA", accountNumber: "0123456789" } }))
        .status,
      200,
    );
    const quote = (await inject("POST", "/v1/quotes", { token, body: { chainId: 5042002, amount: "10" } })).body.quote;
    const { deposit } = (await inject("POST", `/v1/quotes/${quote.id}/deposit`, { token })).body;
    const txHash = `0x${"a".repeat(64)}`;
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
    assert.equal((await inject("POST", `/v1/deposits/${deposit.id}/confirm`, { token, body: { txHash } })).status, 200);

    const cashouts = await inject("GET", "/v1/admin/cashouts", { cookie });
    assert.equal(cashouts.status, 200);
    const row = cashouts.body.cashouts.find((c: { id: string }) => c.id === deposit.id);
    assert.equal(row.status, "escrowed");
    assert.equal(row.userEmail, "adaeze@example.com");
    assert.equal(row.accountLast4, "6789");
    assert.equal(row.depositTxHash, txHash);
    assert.equal(row.amountUnits, "10000000");
    assert.ok(!JSON.stringify(cashouts.body).includes("0123456789"), "full account number never leaves the database");

    const filtered = await inject("GET", "/v1/admin/cashouts?status=released", { cookie });
    assert.equal(filtered.body.cashouts.length, 0);
    assert.equal((await inject("GET", "/v1/admin/cashouts?status=bogus", { cookie })).status, 422);

    t.balances.views = [
      {
        label: "Treasury float",
        network: "Base",
        address: "0x0000000000000000000000000000000000000001",
        asset: "USDC",
        units: "903000",
        decimals: 6,
        warnBelowUnits: "2000000",
        explorerUrl: "https://basescan.org/address/0x0000000000000000000000000000000000000001",
      },
    ];
    const overview = await inject("GET", "/v1/admin/overview", { cookie });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.users.total, 1);
    assert.equal(overview.body.deposits.escrowed, 1);
    assert.equal(overview.body.volume.usdcUnits.total, "10000000");
    assert.equal(overview.body.balances[0].units, "903000");
    assert.ok(Array.isArray(overview.body.attention));

    const users = await inject("GET", "/v1/admin/users", { cookie });
    assert.equal(users.body.users[0].cashouts, 1);
    assert.equal(users.body.users[0].accountLast4, "6789");
    assert.ok(!JSON.stringify(users.body).includes("0123456789"));

    const events = await inject("GET", "/v1/admin/events", { cookie });
    const kinds = events.body.audit.map((e: { kind: string }) => e.kind);
    assert.ok(kinds.includes("deposit.escrowed"));
    assert.ok(!JSON.stringify(events.body).includes("0123456789"));

    assert.equal((await inject("GET", "/v1/admin/jobs", { cookie })).status, 200);
  });

  it("flags an escrowed cash-out that never got a payout", async () => {
    const { cookie } = await login(ADMIN_PASSWORD, "10.0.0.3");
    await t.db.query(`update deposits set escrowed_at = now() - interval '1 hour' where status = 'escrowed'`);
    const { body } = await inject("GET", "/v1/admin/overview", { cookie });
    assert.equal(body.attention.length, 1);
    assert.equal(body.attention[0].reason, "escrowed without a payout");
  });

  it("logs out by expiring the cookie", async () => {
    const res = await inject("POST", "/v1/admin/logout");
    assert.match(String(res.headers["set-cookie"]), /^melo_admin=; Path=\/v1\/admin; HttpOnly; SameSite=Strict; Max-Age=0/);
  });
});
