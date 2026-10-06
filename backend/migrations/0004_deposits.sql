-- MELO-signed DepositTerms for a quote, and the onchain deposit that used them.
-- One per quote. uint values are stored as numerics; addresses and hashes as 0x hex.
create table deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  quote_id uuid not null unique references quotes (id),
  chain_id integer not null,
  escrow text not null,
  intent_id text not null unique check (intent_id ~ '^0x[0-9a-f]{64}$'),
  depositor text not null,
  token text not null,
  amount_units numeric(78, 0) not null check (amount_units > 0),
  payee text not null,
  recipient_commitment text not null,
  quote_expiry timestamptz not null,
  refund_after timestamptz not null check (refund_after > quote_expiry),
  signature text not null,
  status text not null default 'awaiting_deposit' check (status in ('awaiting_deposit', 'escrowed')),
  tx_hash text unique,
  block_number numeric(78, 0),
  escrowed_at timestamptz,
  created_at timestamptz not null default now()
);

create index deposits_user on deposits (user_id, created_at desc);
