import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { PrivyTokenVerifier } from "../src/auth/privy.ts";
import { loadConfig } from "../src/config.ts";
import { FieldCipher } from "../src/lib/crypto.ts";
import { AppError } from "../src/lib/errors.ts";
import { bpsOf, formatUnits, parseRate, parseUnits, toFiatMinor } from "../src/lib/money.ts";
import { APP_ID, createSigner } from "./helpers.ts";

describe("FieldCipher", () => {
  const cipher = new FieldCipher(randomBytes(32).toString("base64"));

  it("round-trips and never stores plaintext", () => {
    const blob = cipher.encrypt("0123456789");
    assert.ok(!blob.toString("utf8").includes("0123456789"));
    assert.equal(cipher.decrypt(blob), "0123456789");
  });

  it("uses a fresh IV per encryption", () => {
    assert.notDeepEqual(cipher.encrypt("0123456789"), cipher.encrypt("0123456789"));
  });

  it("rejects tampered ciphertext", () => {
    const blob = cipher.encrypt("0123456789");
    blob[14] = blob[14]! ^ 1;
    assert.throws(() => cipher.decrypt(blob));
  });

  it("fingerprints deterministically per bank and account", () => {
    assert.deepEqual(cipher.fingerprint("ABNGNGLA", "0123456789"), cipher.fingerprint("ABNGNGLA", "0123456789"));
    assert.notDeepEqual(cipher.fingerprint("ABNGNGLA", "0123456789"), cipher.fingerprint("GTBINGLA", "0123456789"));
  });

  it("requires a 32-byte key", () => {
    assert.throws(() => new FieldCipher(randomBytes(16).toString("base64")));
  });
});

describe("PrivyTokenVerifier", async () => {
  const signer = await createSigner();
  const verifier = new PrivyTokenVerifier(APP_ID, signer.pem);
  const now = Math.floor(Date.now() / 1000);

  it("accepts a valid token", async () => {
    const claims = await verifier.verify(await signer.token({ sub: "did:privy:alice", iat: now }));
    assert.deepEqual(claims, { userDid: "did:privy:alice", sessionId: "session-1", issuedAt: now });
  });

  for (const [name, opts] of [
    ["another app's token", { aud: "other-app" }],
    ["a non-Privy issuer", { iss: "evil.example" }],
    ["an expired token", { iat: now - 7200, exp: now - 3600 }],
  ] as const) {
    it(`rejects ${name}`, async () => {
      await assert.rejects(verifier.verify(await signer.token({ sub: "did:privy:alice", ...opts })), (e) => {
        return e instanceof AppError && e.code === "unauthenticated";
      });
    });
  }

  it("rejects a token signed by a different key", async () => {
    const other = await createSigner();
    await assert.rejects(verifier.verify(await other.token({ sub: "did:privy:alice" })), AppError);
  });
});

describe("money", () => {
  it("parses and formats base units exactly", () => {
    assert.equal(parseUnits("12.5", 6), 12_500_000n);
    assert.equal(parseUnits("0.000001", 6), 1n);
    assert.equal(parseUnits("1.0000001", 6), null);
    assert.equal(parseUnits("1e3", 6), null);
    assert.equal(formatUnits(12_500_000n, 6), "12.5");
    assert.equal(formatUnits(1_000_000n, 6), "1");
  });

  it("converts at a decimal rate, rounding fiat down and fees up", () => {
    const rate = parseRate("1347.65")!;
    assert.equal(toFiatMinor(1_000_000n, rate), 134_765n);
    assert.equal(toFiatMinor(1n, rate), 0n);
    assert.equal(bpsOf(1_000_001n, 30), 3_001n);
    assert.equal(parseRate("0"), null);
    assert.equal(parseRate("abc"), null);
  });
});

describe("loadConfig", () => {
  it("reports invalid fields without echoing values", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: "nope", DATA_ENCRYPTION_KEY: "super-secret-value" }),
      (e: Error) => e.message.includes("DATA_ENCRYPTION_KEY") && !e.message.includes("super-secret-value"),
    );
  });
});
