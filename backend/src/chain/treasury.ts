import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";

import { rpcTransport } from "./rpc.ts";

/** Native USDC on Base mainnet (https://developers.circle.com/stablecoins/usdc-contract-addresses). */
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export interface SignedTransfer {
  hash: Hex;
  raw: Hex;
}

export type TransferReceipt = { status: "unknown" } | { status: "pending" } | { status: "success" | "reverted"; blockNumber: bigint };

/** The MELO treasury on Base: pays Paycrest orders from its USDC float. */
export interface TreasuryFunder {
  readonly address: Address;
  /** USDC base units and native ETH (wei) available for gas. */
  balances(): Promise<{ usdcUnits: bigint; ethWei: bigint }>;
  /** Signs, without broadcasting, a USDC transfer; the hash is known before anything is sent. */
  signTransfer(to: Address, amountUnits: bigint): Promise<SignedTransfer>;
  /** Broadcasts a signed transfer; rebroadcasting the same bytes can never pay twice. */
  broadcast(raw: Hex): Promise<void>;
  receipt(hash: Hex): Promise<TransferReceipt>;
}

const baseClient = (rpcUrls: string) => createPublicClient({ chain: base, transport: rpcTransport(rpcUrls) });

export class RpcTreasuryFunder implements TreasuryFunder {
  readonly address: Address;
  readonly #account: PrivateKeyAccount;
  readonly #client: ReturnType<typeof baseClient>;

  /** `rpcUrls` is comma-separated; later URLs are fallbacks. */
  constructor(privateKey: Hex, rpcUrls: string) {
    this.#account = privateKeyToAccount(privateKey);
    this.address = this.#account.address;
    this.#client = baseClient(rpcUrls);
  }

  async balances() {
    const [usdcUnits, ethWei] = await Promise.all([
      this.#client.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [this.address] }),
      this.#client.getBalance({ address: this.address }),
    ]);
    return { usdcUnits, ethWei };
  }

  async signTransfer(to: Address, amountUnits: bigint): Promise<SignedTransfer> {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amountUnits] });
    const [nonce, fees, gas] = await Promise.all([
      this.#client.getTransactionCount({ address: this.address, blockTag: "pending" }),
      this.#client.estimateFeesPerGas(),
      this.#client.estimateGas({ account: this.address, to: BASE_USDC, data }),
    ]);
    const raw = await this.#account.signTransaction({
      type: "eip1559",
      chainId: base.id,
      to: BASE_USDC,
      data,
      nonce,
      // Headroom so a fee spike between signing and inclusion doesn't strand the transfer.
      gas: (gas * 12n) / 10n,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    return { hash: keccak256(raw), raw };
  }

  async broadcast(raw: Hex): Promise<void> {
    try {
      await this.#client.sendRawTransaction({ serializedTransaction: raw });
    } catch (error) {
      // A rebroadcast of an already-known or already-mined transaction is not an error here.
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("already known") || message.includes("nonce too low")) return;
      throw error;
    }
  }

  async receipt(hash: Hex): Promise<TransferReceipt> {
    try {
      const receipt = await this.#client.getTransactionReceipt({ hash });
      return { status: receipt.status === "success" ? "success" : "reverted", blockNumber: receipt.blockNumber };
    } catch {
      try {
        await this.#client.getTransaction({ hash });
        return { status: "pending" };
      } catch {
        
        return { status: "unknown" };
      }
    }
  }
}
