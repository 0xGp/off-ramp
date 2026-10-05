# MELO — Product

Source of truth: `../MELO Engineering Handbook — Workbook.html`. This file summarises it for design work; the handbook wins on conflict.

## What it is
MELO is escrow-first crypto-to-fiat off-ramp infrastructure. V1 scope: USDC → NGN bank payouts, with Arc as the only implemented settlement chain. The domain model stays chain-agnostic.

## Mechanism (one sentence)
The user's USDC is locked in an onchain escrow contract on Arc and is released only after the NGN bank payout has been verified through an attestation policy; otherwise it is refunded.

## Audiences
- **Developers / fintech teams** integrating a USDC → NGN payout rail (landing page).
- **End users** cashing out USDC to a Nigerian bank account (app).

## Truth constraints (never invent)
- Status: in development, testnet only, not production-ready.
- No liquidity provider is selected or commercially confirmed.
- API endpoints are drafts (`IDEA` status); no public host exists.
- No customers, volumes, SLAs, fees, or benchmarks may be claimed.
- Arc testnet facts (from docs.arc.io): chain ID 5042002, USDC is the gas token, deterministic sub-second finality, USDC ERC-20 at `0x3600…0000`.

## Brand commitments
- Palette: lime + teal on light grey, bold black typography (user-pinned, 2026-09-29, after reference increase.com).
- Applies to both the landing page and the app.
