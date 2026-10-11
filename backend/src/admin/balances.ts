import { createPublicClient, erc20Abi, type Address } from "viem";

import type { TreasuryFunder } from "../chain/treasury.ts";
import { rpcTransport } from "../chain/rpc.ts";
import type { DepositChain } from "../chains.ts";
import { parseUnits, USDC_DECIMALS } from "../lib/money.ts";
import type { BalanceSource, BalanceView } from "./service.ts";

const CACHE_MS = 15_000;
/** A Base USDC transfer costs well under this in ETH. */
const TREASURY_MIN_GAS_WEI = 100_000_000_000_000n; // 0.0001 ETH
/** Roughly ten settle transactions on Arc, where gas is paid in USDC. */
const ATTESTOR_MIN_USDC_UNITS = 50_000n; // 0.05 USDC

const ARC_EXPLORERS: Record<number, string> = { 5042: "https://explorer.arc.io", 5042002: "https://explorer.testnet.arc.io" };

const failed = (view: Omit<BalanceView, "units" | "error">, error: unknown): BalanceView => ({
  ...view,
  units: null,
  error: error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "read failed",
});

/** Live balances of the wallets MELO operates, read by address and cached briefly. */
export class OnchainBalances implements BalanceSource {
  readonly #treasury: TreasuryFunder | null;
  readonly #fundingCapUnits: bigint | null;
  readonly #attestor: Address | null;
  readonly #chains: { chain: DepositChain; rpcUrls: string }[];
  #cache: { at: number; value: Promise<BalanceView[]> } | null = null;

  constructor(opts: {
    treasury: TreasuryFunder | null;
    fundingCapUsdc: string | null;
    attestor: Address | null;
    chains: { chain: DepositChain; rpcUrls: string }[];
  }) {
    this.#treasury = opts.treasury;
    this.#fundingCapUnits = opts.fundingCapUsdc ? parseUnits(opts.fundingCapUsdc, USDC_DECIMALS) : null;
    this.#attestor = opts.attestor;
    this.#chains = opts.chains;
  }

  balances(): Promise<BalanceView[]> {
    if (!this.#cache || Date.now() - this.#cache.at > CACHE_MS) {
      this.#cache = { at: Date.now(), value: this.#read() };
    }
    return this.#cache.value;
  }

  async #read(): Promise<BalanceView[]> {
    const reads: Promise<BalanceView | BalanceView[]>[] = [];

    if (this.#treasury) {
      const treasury = this.#treasury;
      const base = { network: "Base", address: treasury.address, explorerUrl: `https://basescan.org/address/${treasury.address}` };
      reads.push(
        treasury.balances().then(
          ({ usdcUnits, ethWei }) => [
            {
              ...base,
              label: "Treasury float",
              asset: "USDC",
              units: usdcUnits.toString(),
              decimals: USDC_DECIMALS,
              warnBelowUnits: this.#fundingCapUnits?.toString() ?? null,
            },
            {
              ...base,
              label: "Treasury gas",
              asset: "ETH",
              units: ethWei.toString(),
              decimals: 18,
              warnBelowUnits: TREASURY_MIN_GAS_WEI.toString(),
            },
          ],
          (error) => [
            failed({ ...base, label: "Treasury float", asset: "USDC", decimals: USDC_DECIMALS, warnBelowUnits: null }, error),
          ],
        ),
      );
    }

    for (const { chain, rpcUrls } of this.#chains) {
      const client = createPublicClient({ transport: rpcTransport(rpcUrls) });
      const explorer = ARC_EXPLORERS[chain.id] ?? "";
      const usdcOf = (address: Address) =>
        client.readContract({ address: chain.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });
      const view = (label: string, address: Address, warnBelowUnits: bigint | null) => {
        const base = {
          label,
          network: chain.name,
          address,
          asset: "USDC",
          decimals: USDC_DECIMALS,
          warnBelowUnits: warnBelowUnits?.toString() ?? null,
          explorerUrl: explorer ? `${explorer}/address/${address}` : "",
        };
        return usdcOf(address).then(
          (units): BalanceView => ({ ...base, units: units.toString() }),
          (error) => failed(base, error),
        );
      };
      reads.push(view("Held in escrow", chain.escrow, null));
      if (this.#attestor) reads.push(view("Attestor gas", this.#attestor, ATTESTOR_MIN_USDC_UNITS));
    }

    return (await Promise.all(reads)).flat();
  }
}
