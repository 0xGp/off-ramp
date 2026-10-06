alter table deposits drop constraint deposits_status_check;
alter table deposits add constraint deposits_status_check
  check (status in ('awaiting_deposit', 'escrowed', 'released', 'refunded'));

-- The fiat leg for an escrowed deposit, and the onchain settlement that followed it.
-- `provider` is 'simulated' in development; Paycrest orders need a KYB-issued key (mainnet only).
create table payouts (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null unique references deposits (id),
  provider text not null,
  provider_order_id text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  amount_units numeric(78, 0) not null,
  fiat_minor numeric(78, 0) not null,
  completed_at timestamptz,
  settle_tx_hash text unique,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
