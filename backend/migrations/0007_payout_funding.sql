-- A provider can refuse an order outright (e.g. the locked rate drifted); that payout fails
-- without an order id and the escrow is refunded.
alter table payouts alter column provider_order_id drop not null;
alter table payouts add column failure_reason text;

-- Paycrest off-ramp orders are paid by sending `funding_amount_units` USDC to `funding_address`
-- on Base before `funding_valid_until`. An order that is never funded expires on its own, so an
-- orphaned or abandoned order cannot move money.
alter table payouts add column funding_address text;
alter table payouts add column funding_amount_units numeric(78, 0);
alter table payouts add column funding_valid_until timestamptz;
alter table payouts add column funding_tx_hash text unique;
