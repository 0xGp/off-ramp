-- The treasury's funding transfer is signed, and its hash and bytes stored, before it is broadcast.
-- Retries rebroadcast the same bytes (same nonce), so a payout can never be funded twice.
alter table payouts add column funding_raw_tx text;
alter table payouts add column funded_at timestamptz;
-- Why the treasury did not fund an order (cap, too late, low balance); the order then expires.
alter table payouts add column funding_skipped text;
