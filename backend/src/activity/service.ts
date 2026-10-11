import type { Db } from "../db/pool.ts";
import type { QuoteService, QuoteView } from "../quotes/service.ts";
import type { User } from "../users/service.ts";

/** One cash-out whose USDC reached the escrow, with its payout and settlement. */
export interface ActivityView {
  id: string;
  chainId: number;
  escrow: string;
  depositStatus: "escrowed" | "released" | "refunded";
  depositTxHash: string;
  escrowedAt: string;
  quote: QuoteView;
  payout: {
    status: "pending" | "succeeded" | "failed";
    providerOrderId: string;
    fiatMinor: string;
    settleTxHash: string | null;
  } | null;
}

interface ActivityRow {
  id: string;
  quote_id: string;
  chain_id: number;
  escrow: string;
  status: ActivityView["depositStatus"];
  tx_hash: string;
  escrowed_at: Date;
  payout_status: "pending" | "succeeded" | "failed" | null;
  provider_order_id: string | null;
  fiat_minor: string | null;
  settle_tx_hash: string | null;
}

const SELECT = `
  select d.id, d.quote_id, d.chain_id, d.escrow, d.status, d.tx_hash, d.escrowed_at,
         p.status as payout_status, p.provider_order_id, p.fiat_minor, p.settle_tx_hash
  from deposits d
  left join payouts p on p.deposit_id = d.id
  where d.user_id = $1 and d.status <> 'awaiting_deposit'`;

export class ActivityService {
  readonly #db: Db;
  readonly #quotes: QuoteService;

  constructor(db: Db, quotes: QuoteService) {
    this.#db = db;
    this.#quotes = quotes;
  }

  async list(user: User, limit = 50): Promise<ActivityView[]> {
    const { rows } = await this.#db.query<ActivityRow>(`${SELECT} order by d.escrowed_at desc limit $2`, [user.id, limit]);
    return this.#views(user, rows);
  }

  async get(user: User, id: string): Promise<ActivityView | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await this.#db.query<ActivityRow>(`${SELECT} and d.id = $2`, [user.id, id]);
    return (await this.#views(user, rows))[0] ?? null;
  }

  async #views(user: User, rows: ActivityRow[]): Promise<ActivityView[]> {
    const views: ActivityView[] = [];
    for (const row of rows) {
      const quote = await this.#quotes.get(user, row.quote_id);
      if (!quote) continue;
      views.push({
        id: row.id,
        chainId: row.chain_id,
        escrow: row.escrow,
        depositStatus: row.status,
        depositTxHash: row.tx_hash,
        escrowedAt: row.escrowed_at.toISOString(),
        quote,
        payout: row.payout_status
          ? {
              status: row.payout_status,
              providerOrderId: row.provider_order_id!,
              fiatMinor: row.fiat_minor!,
              settleTxHash: row.settle_tx_hash,
            }
          : null,
      });
    }
    return views;
  }
}
