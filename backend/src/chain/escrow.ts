import {
  createPublicClient,
  createWalletClient,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { rpcTransport } from "./rpc.ts";

/** The parts of MeloEscrow (contracts/contracts/MeloEscrow.sol) the backend uses. */
export const escrowAbi = parseAbi([
  "struct DepositTerms { bytes32 intentId; address depositor; address token; uint256 amount; address payee; bytes32 recipientCommitment; uint64 quoteExpiry; uint64 refundAfter; }",
  "struct Attestation { bytes32 intentId; uint8 outcome; bytes32 evidenceHash; uint64 expiry; }",
  "struct Escrow { address depositor; uint64 refundAfter; uint8 status; address token; address payee; uint256 amount; }",
  "function deposit(DepositTerms terms, bytes quoteSignature)",
  "function settle(Attestation attestation, bytes[] signatures)",
  "function getEscrow(bytes32 intentId) view returns (Escrow)",
  "event Deposited(bytes32 indexed intentId, address indexed depositor, address indexed token, uint256 amount, address payee, bytes32 recipientCommitment, uint64 refundAfter)",
]);

export const depositTermsTypes = {
  DepositTerms: [
    { name: "intentId", type: "bytes32" },
    { name: "depositor", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "payee", type: "address" },
    { name: "recipientCommitment", type: "bytes32" },
    { name: "quoteExpiry", type: "uint64" },
    { name: "refundAfter", type: "uint64" },
  ],
} as const;

export const attestationTypes = {
  Attestation: [
    { name: "intentId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export const OUTCOME = { PAYOUT_SUCCEEDED: 1, PAYOUT_FAILED: 2 } as const;
export const ESCROW_STATUS = ["none", "escrowed", "released", "refunded"] as const;
export type EscrowStatus = (typeof ESCROW_STATUS)[number];

export interface Attestation {
  intentId: Hex;
  outcome: number;
  evidenceHash: Hex;
  expiry: bigint;
}

export interface DepositTerms {
  intentId: Hex;
  depositor: Address;
  token: Address;
  amount: bigint;
  payee: Address;
  recipientCommitment: Hex;
  quoteExpiry: bigint;
  refundAfter: bigint;
}

export function escrowDomain(chainId: number, escrow: Address) {
  return { name: "MeloEscrow", version: "1", chainId, verifyingContract: escrow } as const;
}

export class QuoteSigner {
  readonly #account: PrivateKeyAccount;

  constructor(privateKey: Hex) {
    this.#account = privateKeyToAccount(privateKey);
  }

  get address(): Address {
    return this.#account.address;
  }

  sign(chainId: number, escrow: Address, terms: DepositTerms): Promise<Hex> {
    return this.#account.signTypedData({
      domain: escrowDomain(chainId, escrow),
      types: depositTermsTypes,
      primaryType: "DepositTerms",
      message: terms,
    });
  }
}

export type SettleReceipt = { status: "pending" } | { status: "success" | "reverted"; blockNumber: bigint };

/** Signs payout outcomes and submits `settle`. With threshold 1 a single attestor suffices. */
export interface EscrowSettler {
  escrowStatus(chainId: number, escrow: Address, intentId: Hex): Promise<EscrowStatus>;
  submit(chainId: number, escrow: Address, attestation: Attestation): Promise<Hex>;
  receipt(chainId: number, txHash: Hex): Promise<SettleReceipt>;
}

export class RpcEscrowSettler implements EscrowSettler {
  readonly #account: PrivateKeyAccount;
  readonly #rpcUrls: Record<number, string>;
  readonly #clients = new Map<number, PublicClient>();

  /** Testnet: the key comes from env. Production attestor keys live in a KMS. */
  constructor(attestorKey: Hex, rpcUrls: Record<number, string>) {
    this.#account = privateKeyToAccount(attestorKey);
    this.#rpcUrls = rpcUrls;
  }

  get address(): Address {
    return this.#account.address;
  }

  #client(chainId: number): PublicClient {
    let client = this.#clients.get(chainId);
    if (!client) {
      const url = this.#rpcUrls[chainId];
      if (!url) throw new Error(`No RPC configured for chain ${chainId}`);
      client = createPublicClient({ transport: rpcTransport(url, 15_000) });
      this.#clients.set(chainId, client);
    }
    return client;
  }

  async escrowStatus(chainId: number, escrow: Address, intentId: Hex): Promise<EscrowStatus> {
    const state = await this.#client(chainId).readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "getEscrow",
      args: [intentId],
    });
    return ESCROW_STATUS[state.status] ?? "none";
  }

  async submit(chainId: number, escrow: Address, attestation: Attestation): Promise<Hex> {
    const signature = await this.#account.signTypedData({
      domain: escrowDomain(chainId, escrow),
      types: attestationTypes,
      primaryType: "Attestation",
      message: attestation,
    });
    const client = this.#client(chainId);
    const wallet = createWalletClient({ account: this.#account, transport: rpcTransport(this.#rpcUrls[chainId]!, 15_000) });
    const { request } = await client.simulateContract({
      account: this.#account,
      address: escrow,
      abi: escrowAbi,
      functionName: "settle",
      args: [attestation, [signature]],
    });
    return wallet.writeContract({ ...request, chain: null });
  }

  async receipt(chainId: number, txHash: Hex): Promise<SettleReceipt> {
    try {
      const receipt = await this.#client(chainId).getTransactionReceipt({ hash: txHash });
      return { status: receipt.status, blockNumber: receipt.blockNumber };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return { status: "pending" };
      throw error;
    }
  }
}

export interface DepositedEvent {
  intentId: Hex;
  depositor: Address;
  token: Address;
  amount: bigint;
  payee: Address;
  recipientCommitment: Hex;
  refundAfter: bigint;
}

export type DepositReceipt =
  | { status: "pending" }
  | { status: "reverted" }
  | { status: "success"; blockNumber: bigint; events: DepositedEvent[] };

export interface DepositReader {
  /** `Deposited` events emitted by `escrow` in the transaction. */
  receipt(chainId: number, escrow: Address, txHash: Hex): Promise<DepositReceipt>;
}

export class RpcDepositReader implements DepositReader {
  readonly #clients = new Map<number, PublicClient>();

  constructor(rpcUrls: Record<number, string>) {
    for (const [id, url] of Object.entries(rpcUrls)) {
      this.#clients.set(Number(id), createPublicClient({ transport: rpcTransport(url) }));
    }
  }

  async receipt(chainId: number, escrow: Address, txHash: Hex): Promise<DepositReceipt> {
    const client = this.#clients.get(chainId);
    if (!client) throw new Error(`No RPC configured for chain ${chainId}`);
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return { status: "pending" };
      throw error;
    }
    if (receipt.status !== "success") return { status: "reverted" };
    const events = parseEventLogs({ abi: escrowAbi, eventName: "Deposited", logs: receipt.logs })
      .filter((log) => isAddressEqual(log.address, escrow))
      .map((log) => log.args);
    return { status: "success", blockNumber: receipt.blockNumber, events };
  }
}
