import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, toHex, zeroAddress, type Address, type Hex, type WalletClient } from "viem";

import {
  OUTCOME,
  REFUND_REASON,
  attestationTypes,
  depositTermsTypes,
  meloEscrowDomain,
  type Attestation,
  type DepositTerms,
} from "../exports/eip712.js";

const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
const CAP = USDC(1_000);
const HOUR = 3_600n;
const ESCROWED = 1;
const RELEASED = 2;
const REFUNDED = 3;

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

async function deployFixture() {
  const [owner, user, quoteSigner, att1, att2, att3, treasury, stranger] = await viem.getWalletClients();
  const usdc = await viem.deployContract("MockUSDC");
  const escrow = await viem.deployContract("MeloEscrow", [
    owner.account.address,
    quoteSigner.account.address,
    [att1.account.address],
    1n,
  ]);
  await escrow.write.configureToken([usdc.address, CAP]);
  await usdc.write.mint([user.account.address, USDC(10_000)]);
  await usdc.write.approve([escrow.address, USDC(10_000)], { account: user.account });
  return { escrow, usdc, owner, user, quoteSigner, att1, att2, att3, treasury, stranger };
}

type Fixture = Awaited<ReturnType<typeof deployFixture>>;

let intentCounter = 0;
const newIntentId = (): Hex => keccak256(toHex(`intent-${++intentCounter}`));

async function now() {
  return BigInt(await networkHelpers.time.latest());
}

async function buildTerms(f: Fixture, overrides: Partial<DepositTerms> = {}): Promise<DepositTerms> {
  const t = await now();
  return {
    intentId: newIntentId(),
    depositor: f.user.account.address,
    token: f.usdc.address,
    amount: USDC(50),
    payee: f.treasury.account.address,
    recipientCommitment: keccak256(toHex("058|0123456789|salt")),
    quoteExpiry: t + 300n,
    refundAfter: t + 2n * HOUR,
    ...overrides,
  };
}

function signTerms(signer: WalletClient, escrow: Address, terms: DepositTerms) {
  return signer.signTypedData({
    account: signer.account!,
    domain: meloEscrowDomain(chainId, escrow),
    types: depositTermsTypes,
    primaryType: "DepositTerms",
    message: terms,
  });
}

async function signAttestation(signers: WalletClient[], escrow: Address, attestation: Attestation) {
  const sorted = [...signers].sort((a, b) =>
    BigInt(a.account!.address) < BigInt(b.account!.address) ? -1 : 1,
  );
  return Promise.all(
    sorted.map((s) =>
      s.signTypedData({
        account: s.account!,
        domain: meloEscrowDomain(chainId, escrow),
        types: attestationTypes,
        primaryType: "Attestation",
        message: attestation,
      }),
    ),
  );
}

async function depositAs(f: Fixture, overrides: Partial<DepositTerms> = {}) {
  const terms = await buildTerms(f, overrides);
  const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
  await f.escrow.write.deposit([terms, sig], { account: f.user.account });
  return terms;
}

async function attestation(intentId: Hex, outcome: number, ttl = 600n): Promise<Attestation> {
  return {
    intentId,
    outcome,
    evidenceHash: keccak256(toHex(`paystack:${intentId}`)),
    expiry: (await now()) + ttl,
  };
}

describe("MeloEscrow", () => {
  describe("deposit", () => {
    it("locks funds and emits Deposited", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await buildTerms(f);
      const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);

      await viem.assertions.emitWithArgs(
        f.escrow.write.deposit([terms, sig], { account: f.user.account }),
        f.escrow,
        "Deposited",
        [
          terms.intentId,
          f.user.account.address,
          f.usdc.address,
          terms.amount,
          f.treasury.account.address,
          terms.recipientCommitment,
          terms.refundAfter,
        ],
      );

      const e = await f.escrow.read.getEscrow([terms.intentId]);
      assert.equal(e.status, ESCROWED);
      assert.equal(e.amount, terms.amount);
      assert.equal(await f.usdc.read.balanceOf([f.escrow.address]), terms.amount);
      assert.equal(await f.escrow.read.totalEscrowed([f.usdc.address]), terms.amount);
    });

    it("rejects terms not signed by the quote signer", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await buildTerms(f);
      const sig = await signTerms(f.stranger, f.escrow.address, terms);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([terms, sig], { account: f.user.account }),
        f.escrow,
        "InvalidQuoteSignature",
      );
    });

    it("rejects tampered terms", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await buildTerms(f);
      const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([{ ...terms, payee: f.stranger.account.address }, sig], { account: f.user.account }),
        f.escrow,
        "InvalidQuoteSignature",
      );
    });

    it("rejects a signature made for another escrow deployment", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const other = await viem.deployContract("MeloEscrow", [
        f.owner.account.address,
        f.quoteSigner.account.address,
        [f.att1.account.address],
        1n,
      ]);
      const terms = await buildTerms(f);
      const sig = await signTerms(f.quoteSigner, other.address, terms);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([terms, sig], { account: f.user.account }),
        f.escrow,
        "InvalidQuoteSignature",
      );
    });

    it("only lets the named depositor submit", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await buildTerms(f);
      const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([terms, sig], { account: f.stranger.account }),
        f.escrow,
        "NotDepositor",
      );
    });

    it("rejects an expired quote", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await buildTerms(f);
      const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
      await networkHelpers.time.increase(301);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([terms, sig], { account: f.user.account }),
        f.escrow,
        "QuoteExpired",
      );
    });

    it("rejects unaccepted tokens and amounts outside (0, cap]", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const otherToken = await viem.deployContract("MockUSDC");
      for (const [overrides, error] of [
        [{ token: otherToken.address }, "TokenNotAccepted"],
        [{ amount: 0n }, "InvalidAmount"],
        [{ amount: CAP + 1n }, "InvalidAmount"],
      ] as const) {
        const terms = await buildTerms(f, overrides);
        const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
        await viem.assertions.revertWithCustomError(
          f.escrow.write.deposit([terms, sig], { account: f.user.account }),
          f.escrow,
          error,
        );
      }
    });

    it("enforces the 30 min to 24 h refund window", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const t = await now();
      for (const refundAfter of [t + 10n * 60n, t + 25n * HOUR]) {
        const terms = await buildTerms(f, { refundAfter });
        const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
        await viem.assertions.revertWithCustomError(
          f.escrow.write.deposit([terms, sig], { account: f.user.account }),
          f.escrow,
          "InvalidRefundWindow",
        );
      }
    });

    it("never reuses an intent id", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);
      const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([terms, sig], { account: f.user.account }),
        f.escrow,
        "IntentAlreadyExists",
      );
    });

    it("rejects tokens that deliver less than the amount", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      await f.usdc.write.setFeeBps([100n]);
      const terms = await buildTerms(f);
      const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([terms, sig], { account: f.user.account }),
        f.escrow,
        "BalanceMismatch",
      );
    });

    it("is blocked while paused", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      await f.escrow.write.pause();
      const terms = await buildTerms(f);
      const sig = await signTerms(f.quoteSigner, f.escrow.address, terms);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.deposit([terms, sig], { account: f.user.account }),
        f.escrow,
        "EnforcedPause",
      );
    });
  });

  describe("settle", () => {
    it("releases to the payee on PAYOUT_SUCCEEDED", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);
      const a = await attestation(terms.intentId, OUTCOME.PAYOUT_SUCCEEDED);
      const sigs = await signAttestation([f.att1], f.escrow.address, a);

      await viem.assertions.emitWithArgs(
        f.escrow.write.settle([a, sigs], { account: f.stranger.account }),
        f.escrow,
        "Released",
        [terms.intentId, f.treasury.account.address, terms.amount, a.evidenceHash],
      );
      assert.equal(await f.usdc.read.balanceOf([f.treasury.account.address]), terms.amount);
      assert.equal((await f.escrow.read.getEscrow([terms.intentId])).status, RELEASED);
      assert.equal(await f.escrow.read.totalEscrowed([f.usdc.address]), 0n);
    });

    it("refunds the depositor early on PAYOUT_FAILED", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const before = await f.usdc.read.balanceOf([f.user.account.address]);
      const terms = await depositAs(f);
      const a = await attestation(terms.intentId, OUTCOME.PAYOUT_FAILED);
      const sigs = await signAttestation([f.att1], f.escrow.address, a);

      await viem.assertions.emitWithArgs(
        f.escrow.write.settle([a, sigs]),
        f.escrow,
        "Refunded",
        [terms.intentId, f.user.account.address, terms.amount, REFUND_REASON.PAYOUT_FAILED, a.evidenceHash],
      );
      assert.equal(await f.usdc.read.balanceOf([f.user.account.address]), before);
      assert.equal((await f.escrow.read.getEscrow([terms.intentId])).status, REFUNDED);
    });

    it("cannot settle twice or refund after settling", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);
      const a = await attestation(terms.intentId, OUTCOME.PAYOUT_SUCCEEDED, 3n * HOUR);
      const sigs = await signAttestation([f.att1], f.escrow.address, a);
      await f.escrow.write.settle([a, sigs]);

      await viem.assertions.revertWithCustomError(f.escrow.write.settle([a, sigs]), f.escrow, "NotEscrowed");
      const failed = await attestation(terms.intentId, OUTCOME.PAYOUT_FAILED);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([failed, await signAttestation([f.att1], f.escrow.address, failed)]),
        f.escrow,
        "NotEscrowed",
      );
      await networkHelpers.time.increase(Number(2n * HOUR));
      await viem.assertions.revertWithCustomError(f.escrow.write.refund([terms.intentId]), f.escrow, "NotEscrowed");
    });

    it("rejects non-attestor, expired and malformed attestations", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);

      const a = await attestation(terms.intentId, OUTCOME.PAYOUT_SUCCEEDED);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([a, await signAttestation([f.stranger], f.escrow.address, a)]),
        f.escrow,
        "InvalidAttestorSignature",
      );

      const bad = await attestation(terms.intentId, 3);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([bad, await signAttestation([f.att1], f.escrow.address, bad)]),
        f.escrow,
        "InvalidOutcome",
      );

      const short = await attestation(terms.intentId, OUTCOME.PAYOUT_SUCCEEDED, 60n);
      const shortSigs = await signAttestation([f.att1], f.escrow.address, short);
      await networkHelpers.time.increase(61);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([short, shortSigs]),
        f.escrow,
        "AttestationExpired",
      );

      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([a, await signAttestation([f.att1], f.escrow.address, { ...a, outcome: OUTCOME.PAYOUT_FAILED })]),
        f.escrow,
        "InvalidAttestorSignature",
      );
    });

    it("enforces threshold with distinct, ordered attestors", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      await f.escrow.write.setAttestor([f.att2.account.address, true]);
      await f.escrow.write.setAttestor([f.att3.account.address, true]);
      await f.escrow.write.setThreshold([2n]);
      const terms = await depositAs(f);
      const a = await attestation(terms.intentId, OUTCOME.PAYOUT_SUCCEEDED);

      const [one] = await signAttestation([f.att1], f.escrow.address, a);
      await viem.assertions.revertWithCustomError(f.escrow.write.settle([a, [one]]), f.escrow, "InsufficientSignatures");
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([a, [one, one]]),
        f.escrow,
        "InvalidAttestorSignature",
      );

      const ordered = await signAttestation([f.att1, f.att2], f.escrow.address, a);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([a, [...ordered].reverse()]),
        f.escrow,
        "InvalidAttestorSignature",
      );
      await f.escrow.write.settle([a, ordered]);
      assert.equal((await f.escrow.read.getEscrow([terms.intentId])).status, RELEASED);
    });

    it("is blocked while paused", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);
      await f.escrow.write.pause();
      const a = await attestation(terms.intentId, OUTCOME.PAYOUT_SUCCEEDED);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([a, await signAttestation([f.att1], f.escrow.address, a)]),
        f.escrow,
        "EnforcedPause",
      );
    });
  });

  describe("refund", () => {
    it("is unavailable before refundAfter", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.refund([terms.intentId], { account: f.stranger.account }),
        f.escrow,
        "RefundNotYetAvailable",
      );
    });

    it("lets anyone refund after refundAfter, even while paused", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const before = await f.usdc.read.balanceOf([f.user.account.address]);
      const terms = await depositAs(f);
      await f.escrow.write.pause();
      await networkHelpers.time.increaseTo(terms.refundAfter);

      await viem.assertions.emitWithArgs(
        f.escrow.write.refund([terms.intentId], { account: f.stranger.account }),
        f.escrow,
        "Refunded",
        [terms.intentId, f.user.account.address, terms.amount, REFUND_REASON.TIMEOUT, `0x${"0".repeat(64)}`],
      );
      assert.equal(await f.usdc.read.balanceOf([f.user.account.address]), before);
    });

    it("races settle at the deadline: first to land wins", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);

      const a1 = await depositAs(f);
      const late = await attestation(a1.intentId, OUTCOME.PAYOUT_SUCCEEDED, 4n * HOUR);
      const lateSigs = await signAttestation([f.att1], f.escrow.address, late);
      await networkHelpers.time.increaseTo(a1.refundAfter + 1n);
      await f.escrow.write.settle([late, lateSigs]);
      assert.equal((await f.escrow.read.getEscrow([a1.intentId])).status, RELEASED);

      const a2 = await depositAs(f);
      const late2 = await attestation(a2.intentId, OUTCOME.PAYOUT_SUCCEEDED, 4n * HOUR);
      const late2Sigs = await signAttestation([f.att1], f.escrow.address, late2);
      await networkHelpers.time.increaseTo(a2.refundAfter);
      await f.escrow.write.refund([a2.intentId]);
      await viem.assertions.revertWithCustomError(f.escrow.write.settle([late2, late2Sigs]), f.escrow, "NotEscrowed");
    });

    it("keeps funds escrowed when the depositor is blocklisted", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);
      await f.usdc.write.setBlocked([f.user.account.address, true]);
      await networkHelpers.time.increaseTo(terms.refundAfter);
      await viem.assertions.revertWithCustomError(f.escrow.write.refund([terms.intentId]), f.usdc, "Blocked");
      assert.equal((await f.escrow.read.getEscrow([terms.intentId])).status, ESCROWED);
    });
  });

  describe("admin", () => {
    it("restricts admin functions to the owner", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const as = { account: f.stranger.account };
      for (const call of [
        f.escrow.write.setQuoteSigner([f.stranger.account.address], as),
        f.escrow.write.setAttestor([f.stranger.account.address, true], as),
        f.escrow.write.setThreshold([1n], as),
        f.escrow.write.configureToken([f.usdc.address, 1n], as),
        f.escrow.write.pause(as),
        f.escrow.write.sweepSurplus([f.usdc.address, f.stranger.account.address], as),
      ]) {
        await viem.assertions.revertWithCustomError(call, f.escrow, "OwnableUnauthorizedAccount");
      }
    });

    it("keeps threshold within the attestor set", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(f.escrow.write.setThreshold([0n]), f.escrow, "InvalidThreshold");
      await viem.assertions.revertWithCustomError(f.escrow.write.setThreshold([2n]), f.escrow, "InvalidThreshold");
      await viem.assertions.revertWithCustomError(
        f.escrow.write.setAttestor([f.att1.account.address, false]),
        f.escrow,
        "InvalidThreshold",
      );
    });

    it("rotated-out attestors can no longer settle", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      await f.escrow.write.setAttestor([f.att2.account.address, true]);
      await f.escrow.write.setAttestor([f.att1.account.address, false]);
      const terms = await depositAs(f);
      const a = await attestation(terms.intentId, OUTCOME.PAYOUT_SUCCEEDED);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.settle([a, await signAttestation([f.att1], f.escrow.address, a)]),
        f.escrow,
        "InvalidAttestorSignature",
      );
      await f.escrow.write.settle([a, await signAttestation([f.att2], f.escrow.address, a)]);
    });

    it("disables renounceOwnership", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(f.escrow.read.renounceOwnership(), f.escrow, "RenounceDisabled");
    });

    it("sweeps only surplus, never escrowed funds", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      const terms = await depositAs(f);
      await viem.assertions.revertWithCustomError(
        f.escrow.write.sweepSurplus([f.usdc.address, f.owner.account.address]),
        f.escrow,
        "InvalidAmount",
      );
      await f.usdc.write.transfer([f.escrow.address, USDC(3)], { account: f.user.account });
      await f.escrow.write.sweepSurplus([f.usdc.address, f.owner.account.address]);
      assert.equal(await f.usdc.read.balanceOf([f.owner.account.address]), USDC(3));
      assert.equal(await f.usdc.read.balanceOf([f.escrow.address]), terms.amount);
    });

    it("rejects zero addresses", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(f.escrow.write.setQuoteSigner([zeroAddress]), f.escrow, "ZeroAddress");
      await viem.assertions.revertWithCustomError(
        f.escrow.write.configureToken([zeroAddress, 1n]),
        f.escrow,
        "ZeroAddress",
      );
    });
  });

  describe("invariants (randomized)", () => {
    it("accounting holds and every intent ends in exactly one terminal state", async () => {
      const f = await networkHelpers.loadFixture(deployFixture);
      let seed = 42;
      const rand = (n: number) => {
        seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
        return seed % n;
      };

      const live: DepositTerms[] = [];
      const finished = new Map<Hex, number>();
      let released = 0n;

      for (let step = 0; step < 60; step++) {
        const op = rand(4);
        if (op === 0 || live.length === 0) {
          live.push(await depositAs(f, { amount: USDC(1 + rand(200)) }));
        } else if (op === 1 || op === 2) {
          const [t] = live.splice(rand(live.length), 1);
          const outcome = op === 1 ? OUTCOME.PAYOUT_SUCCEEDED : OUTCOME.PAYOUT_FAILED;
          const a = await attestation(t.intentId, outcome);
          await f.escrow.write.settle([a, await signAttestation([f.att1], f.escrow.address, a)]);
          finished.set(t.intentId, outcome === OUTCOME.PAYOUT_SUCCEEDED ? RELEASED : REFUNDED);
          if (outcome === OUTCOME.PAYOUT_SUCCEEDED) released += t.amount;
        } else {
          await networkHelpers.time.increase(Number(HOUR));
          const t0 = await now();
          for (let i = live.length - 1; i >= 0; i--) {
            if (live[i].refundAfter <= t0) {
              await f.escrow.write.refund([live[i].intentId]);
              finished.set(live[i].intentId, REFUNDED);
              live.splice(i, 1);
            }
          }
        }

        const expected = live.reduce((sum, t) => sum + t.amount, 0n);
        assert.equal(await f.escrow.read.totalEscrowed([f.usdc.address]), expected);
        assert.equal(await f.usdc.read.balanceOf([f.escrow.address]), expected);
      }

      for (const [id, status] of finished) {
        assert.equal((await f.escrow.read.getEscrow([id])).status, status);
      }
      assert.equal(await f.usdc.read.balanceOf([f.treasury.account.address]), released);
    });
  });
});
