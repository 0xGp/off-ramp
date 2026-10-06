-- Signed webhook deliveries from payout providers, deduplicated by body hash (deliveries are
-- retried for up to 24h). Recipient account numbers are reduced to the last 4 before storing.
create table provider_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event text not null,
  order_id text,
  status text,
  body_sha256 text not null unique,
  data jsonb not null,
  payout_id uuid references payouts (id),
  received_at timestamptz not null default now()
);

create index provider_events_order on provider_events (provider, order_id);
