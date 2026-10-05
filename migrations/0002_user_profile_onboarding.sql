-- Profile copied from the user's Google login (via Privy) so MELO can send bank-change alerts.
alter table users
  add column email text,
  add column display_name text,
  -- Set once the account has both a wallet and a payout bank account.
  add column onboarded_at timestamptz;
