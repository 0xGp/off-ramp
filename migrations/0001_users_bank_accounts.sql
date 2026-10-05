create table users (
  id uuid primary key default gen_random_uuid(),
  privy_did text not null unique,
  wallet_address text unique check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The full account number is only stored encrypted (AES-256-GCM); the fingerprint is an
-- HMAC used for limits and duplicate checks without decrypting.
create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  institution_code text not null,
  institution_name text not null,
  account_name text not null,
  account_last4 char(4) not null,
  account_number_ciphertext bytea not null,
  account_fingerprint bytea not null,
  verified_at timestamptz not null,
  usable_from timestamptz not null,
  status text not null check (status in ('active', 'replaced')),
  created_at timestamptz not null default now(),
  replaced_at timestamptz
);

create unique index bank_accounts_one_active_per_user on bank_accounts (user_id) where status = 'active';
create index bank_accounts_fingerprint on bank_accounts (account_fingerprint);

create table audit_events (
  id bigint generated always as identity primary key,
  user_id uuid references users (id),
  kind text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_events_user on audit_events (user_id, created_at desc);
