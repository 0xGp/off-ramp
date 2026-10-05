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
