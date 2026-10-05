-- An offer shown to the user: USDC in on `chain_id`, NGN out to `bank_account_id`.
-- Amounts are integer base units (USDC: 6 decimals, NGN: kobo). `rate` is kept as the
-- provider's decimal string so the exact figure shown can be audited.
create table quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  bank_account_id uuid not null references bank_accounts (id),
  chain_id integer not null,
  token text not null check (token ~ '^0x[0-9a-fA-F]{40}$'),
  amount_units numeric(78, 0) not null check (amount_units > 0),
  fee_units numeric(78, 0) not null check (fee_units >= 0),
  payout_units numeric(78, 0) not null check (payout_units > 0 and payout_units + fee_units = amount_units),
  fee_bps integer not null,
  payout_network text not null,
  fiat_currency text not null,
  rate text not null,
  gross_fiat_minor numeric(78, 0) not null,
  fee_fiat_minor numeric(78, 0) not null,
  net_fiat_minor numeric(78, 0) not null,
  provider_ids text[] not null default '{}',
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  created_at timestamptz not null default now()
);

create index quotes_user on quotes (user_id, created_at desc);
