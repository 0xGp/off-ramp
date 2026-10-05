# off-ramp

MELO: cash out USDC to a Nigerian bank account.

- `web/`: Next.js app (Privy Google sign-in, cash-out flow)
- `backend/`: API and worker (Fastify, Postgres): accounts, bank accounts, quotes via Paycrest
- `contracts/`: `MeloEscrow` (Hardhat), deployed to Arc Testnet and Base Sepolia

Run everything locally with `npm run dev` (database, API, worker and web). See `backend/README.md` for environment setup.
