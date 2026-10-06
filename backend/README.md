# MELO backend

TypeScript API and worker for MELO's USDC → NGN off-ramp. Intended as its own repository; see ADR-0012 in the engineering handbook for the model (Privy account wallets, saved bank account, one-tap cash-out into `MeloEscrow`).

Phase 1 of 6 (done): Privy sign-in verification, users, verified bank accounts, job runner.

## Stack
- Node 24, running TypeScript directly (type stripping, no build step). `tsc` is for typechecking only.
- Fastify API, PostgreSQL via `pg`, jobs on Postgres with graphile-worker. No Redis.
- `api` and `worker` are two processes from one codebase.

## Run locally
```bash
npm install
npm run db:start          # Postgres in ./.pgdata on port 54329 (databases melo, melo_test)
cp .env.example .env      # fill PRIVY_*, DATA_ENCRYPTION_KEY
npm run dev:api           # applies migrations, serves on :4000
npm run dev:worker        # in another terminal
npm test                  # uses melo_test and resets it
```

Or, from the repo root, run everything (Postgres, migrations, API, worker, web on :3100) in one terminal:
```bash
npm run dev               # Ctrl-C stops all of it
```

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | – | DB ping |
| GET | `/v1/banks` | – | Paycrest NGN institutions (cached 1 h) |
| GET | `/v1/me` | Privy token | Creates the account on first call (audited); returns Google email and name, wallet address, active bank account and `onboarding` |
| POST | `/v1/bank-accounts/verify` | Privy token | Name check only, nothing stored |
| PUT | `/v1/me/bank-account` | Privy token | Save or replace the payout account; returns the same body as `/v1/me` |
| POST | `/v1/quotes` | Privy token | `{chainId, amount}` (USDC decimal string). Needs a usable bank account. Prices the payout (amount minus `MELO_FEE_BPS`) at Paycrest's live sell rate on Base, stores the offer for `QUOTE_TTL_SECONDS` (default 90). `no-route` when no provider can fill the amount |
| GET | `/v1/quotes/:id` | Privy token | The caller's own quote |
| POST | `/v1/quotes/:id/deposit` | Privy token | MELO-signed `DepositTerms` (EIP-712, domain `MeloEscrow`/`1`) for an unexpired quote; one per quote. Refund opens `DEPOSIT_REFUND_DELAY_MINUTES` after quote expiry. Needs `QUOTE_SIGNER_PRIVATE_KEY` and `ESCROW_PAYEE_ADDRESS` |
| POST | `/v1/deposits/:id/confirm` | Privy token | `{txHash}`. Reads the receipt and marks the deposit `escrowed` only if it emitted the matching `Deposited` event; `chain-pending` until the receipt exists |
| GET | `/v1/deposits/:id` | Privy token | The caller's own deposit |
| POST | `/v1/webhooks/paycrest` | `X-Paycrest-Signature` | HMAC-SHA256 of the raw body with `PAYCREST_API_SECRET`. Stores each delivery once (account number reduced to last 4); `settled` completes the payout, `refunded`/`expired` fail it, then `escrow_settle` is queued |

### After a deposit (worker)

Confirming a deposit queues `payout_start` in the same transaction. The worker then runs
`payout_start` → `payout_poll` (every 5 s) → `escrow_settle`, which signs an attestation with
`ATTESTOR_PRIVATE_KEY` and calls `settle` on the escrow: a successful payout releases the USDC to
`ESCROW_PAYEE_ADDRESS`, a failed one refunds the depositor. Every step is safe to retry.
The Paycrest webhook and the poll share the job key `settle:<payoutId>`, so whichever reports
the outcome first queues the single settlement.

`PAYOUT_PROVIDER=simulated` (default) fakes the payout (`SIM_PAYOUT_SECONDS`, `SIM_PAYOUT_OUTCOME`).
`PAYOUT_PROVIDER=paycrest` places a real mainnet order for the quote's bank account and records
Paycrest's funding instructions (`funding_address`, `funding_amount_units`, `funding_valid_until`
on `payouts`). An order Paycrest refuses (e.g. rate drift) fails the payout with `failure_reason`.

Funding (`PAYOUT_FUNDING=on`, needs `TREASURY_PRIVATE_KEY`): `payout_fund` runs on the serial
`treasury` queue and sends exactly `amountToTransfer` USDC on Base from the treasury. The transfer
is signed and its hash and bytes stored before broadcast; retries rebroadcast the same bytes and a
payout is never re-signed, so it can't be paid twice. It skips (`funding_skipped`) orders above
`PAYOUT_FUNDING_MAX_USDC`, with under a minute left, or when the treasury lacks USDC or gas; an
unfunded order expires, polling reports it failed, and the escrow refunds the depositor. With
funding off, orders are created and simply expire.

Treasury balances (read-only, never prints the key): `node --env-file=.env scripts/treasury.ts`.

End-to-end on Arc Testnet (live quote, real deposit and settlement, with `npm run dev` running):

```bash
node --env-file=.env scripts/e2e-deposit.ts 1
```

`onboarding` is `{ complete, nextStep: "wallet" | "bank-account" | null, completedAt }`. The web app sends signed-in users to account setup until `complete` is true. `completedAt` is recorded once, the first time both the wallet and a bank account exist.

Auth is `Authorization: Bearer <Privy access token>`. Errors use `{ "error": { "code", "message" } }`, the same envelope as the web client.

## Security rules in code
- Privy tokens are verified locally (ES256, `iss` = `privy.io`, `aud` = app ID) with the dashboard verification key.
- Account numbers are encrypted with AES-256-GCM (key derived from `DATA_ENCRYPTION_KEY` via HKDF) and never returned, logged or put in audit events; only the last 4 digits are.
- Changing an existing bank account requires a login from the last `FRESH_AUTH_SECONDS` (default 5 min), and the new account can't receive payouts for `BANK_CHANGE_COOLDOWN_HOURS` (default 24 h).
- The change, its audit event and its alert job commit in one transaction.
- Email delivery for the alert is not wired yet; the job logs a masked line.

## Layout
```
migrations/          versioned SQL, applied in order under an advisory lock
src/api/             Fastify app (buildApp) and entrypoint
src/auth/privy.ts    token verifier, embedded-wallet lookup
src/bank-accounts/   save, verify, cooldown rules
src/paycrest/        keyless Paycrest client (institutions, verify-account)
src/users/           user upsert and wallet linking
src/worker/          graphile-worker tasks and entrypoint
test/                node:test; unit tests and API tests against real Postgres
```
