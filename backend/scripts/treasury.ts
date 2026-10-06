// Read-only: prints the treasury address and its Base mainnet balances. Never prints the key.
// Usage: node --env-file=.env scripts/treasury.ts
import { formatEther } from "viem";

import { RpcTreasuryFunder } from "../src/chain/treasury.ts";
import { formatUnits, USDC_DECIMALS } from "../src/lib/money.ts";

const key = process.env.TREASURY_PRIVATE_KEY;
if (!key) throw new Error("TREASURY_PRIVATE_KEY is not set in .env");

const funder = new RpcTreasuryFunder(key as `0x${string}`, process.env.BASE_RPC_URL ?? "https://mainnet.base.org");
const { usdcUnits, ethWei } = await funder.balances();
console.log(`treasury (Base mainnet): ${funder.address}`);
console.log(`  USDC: ${formatUnits(usdcUnits, USDC_DECIMALS)}`);
console.log(`  ETH:  ${formatEther(ethWei)}`);
console.log(`funding: ${process.env.PAYOUT_FUNDING ?? "off"}, cap ${process.env.PAYOUT_FUNDING_MAX_USDC ?? "5"} USDC per order`);
