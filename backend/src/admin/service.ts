import type { Db } from "../db/pool.ts";

/** A wallet MELO operates, by address only: keys never leave the env file. */
export interface BalanceView {
  label: string;
  network: string;
  address: string;
  asset: string;
  /** Base units as a decimal string; null when the RPC read failed. */
  units: string | null;
  decimals: number;
  /** Below this the wallet can't do its job (pay orders, pay gas). */
  warnBelowUnits: string | null;
  explorerUrl: string;
  error?: string;
}

export interface BalanceSource {
  balances(): Promise<BalanceView[]>;
}

/** A worker heartbeat older than this means it stopped. */
const HEARTBEAT_STALE_SECONDS = 60;
/** How long a payout may stay pending before it needs a look. */
const STUCK_PAYOUT_MINUTES = 15;
/** How long after a final payout the escrow should be settled. */
const STUCK_SETTLE_MINUTES = 10;

const countBy = (rows: { key: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.n]));

/** Read-only operator views over the database. Never returns key material or full account numbers. */
export class AdminService {
  readonly #db: Db;
  readonly #balances: BalanceSource | null;

  constructor(db: Db, balances: BalanceSource | null) {
    this.#db = db;
    this.#balances = balances;
  }

  async overview() {
    const q = <T extends object>(sql: string, params: unknown[] = []) => this.#db.query<T>(sql, params).then((r) => r.rows);
    const [users, deposits, payouts, volume, attention, heartbeats, jobs, balances] = await Promise.all([
      q<{ total: number; today: number }>(
        `select count(*)::int as total, count(*) filter (where created_at >= date_trunc('day', now()))::int as today from users`,
      ),
      q<{ key: string; n: number }>(`select status as key, count(*)::int as n from deposits group by status`),
      q<{ key: string; n: number }>(`select status as key, count(*)::int as n from payouts group by status`),
      q<{ usdc_total: string; usdc_today: string; ngn_total: string; ngn_today: string; fees_total: string }>(
        `select coalesce(sum(d.amount_units), 0)::text as usdc_total,
                coalesce(sum(d.amount_units) filter (where d.escrowed_at >= date_trunc('day', now())), 0)::text as usdc_today,
                coalesce(sum(p.fiat_minor) filter (where p.status = 'succeeded'), 0)::text as ngn_total,
                coalesce(sum(p.fiat_minor) filter (where p.status = 'succeeded' and p.completed_at >= date_trunc('day', now())), 0)::text as ngn_today,
                coalesce(sum(q.fee_units) filter (where d.status = 'released'), 0)::text as fees_total
         from deposits d join quotes q on q.id = d.quote_id left join payouts p on p.deposit_id = d.id
         where d.status <> 'awaiting_deposit'`,
      ),
      this.#attention(),
      q<{ name: string; pid: number; started_at: Date; seen_at: Date; age_seconds: number }>(
        `select name, pid, started_at, seen_at, extract(epoch from now() - seen_at)::int as age_seconds from service_heartbeats`,
      ),
      q<{ key: string; n: number }>(
        `select case when last_error is not null then 'failing' when locked_at is not null then 'running' else 'queued' end as key,
                count(*)::int as n
         from graphile_worker.jobs group by 1`,
      ).catch(() => []),
      this.#balances?.balances() ?? Promise.resolve([]),
    ]);
    const volumeRow = volume[0]!;
    return {
      generatedAt: new Date().toISOString(),
      users: users[0]!,
      deposits: countBy(deposits),
      payouts: countBy(payouts),
      volume: {
        usdcUnits: { total: volumeRow.usdc_total, today: volumeRow.usdc_today },
        ngnMinor: { total: volumeRow.ngn_total, today: volumeRow.ngn_today },
        feeUsdcUnits: volumeRow.fees_total,
      },
      attention,
      services: heartbeats.map((h) => ({
        name: h.name,
        pid: h.pid,
        startedAt: h.started_at.toISOString(),
        seenAt: h.seen_at.toISOString(),
        healthy: h.age_seconds <= HEARTBEAT_STALE_SECONDS,
      })),
      jobs: countBy(jobs),
      balances,
    };
  }

  /** Cash-outs that won't finish on their own, or are taking longer than they should. */
  async #attention() {
    const { rows } = await this.#db.query<{ deposit_id: string; reason: string; since: Date; detail: string | null }>(
      `select d.id as deposit_id, 'payout pending over ${STUCK_PAYOUT_MINUTES} min' as reason, p.created_at as since, p.provider_order_id as detail
         from payouts p join deposits d on d.id = p.deposit_id
        where p.status = 'pending' and p.created_at < now() - interval '${STUCK_PAYOUT_MINUTES} minutes'
       union all
       select d.id, 'treasury did not fund the order', p.updated_at, p.funding_skipped
         from payouts p join deposits d on d.id = p.deposit_id
        where p.status = 'pending' and p.funding_skipped is not null
       union all
       select d.id, 'payout ' || p.status || ' but escrow not settled', p.completed_at, p.settle_tx_hash
         from payouts p join deposits d on d.id = p.deposit_id
        where p.status <> 'pending' and d.status = 'escrowed'
          and p.completed_at < now() - interval '${STUCK_SETTLE_MINUTES} minutes'
       union all
       select d.id, 'escrowed without a payout', d.escrowed_at, null
         from deposits d left join payouts p on p.deposit_id = d.id
        where d.status = 'escrowed' and p.id is null and d.escrowed_at < now() - interval '5 minutes'
       order by since`,
    );
    return rows.map((r) => ({ depositId: r.deposit_id, reason: r.reason, since: r.since.toISOString(), detail: r.detail }));
  }

  async cashouts(opts: { limit: number; status?: string }) {
    const { rows } = await this.#db.query(
      `select d.id, d.status, d.chain_id as "chainId", d.amount_units as "amountUnits", d.tx_hash as "depositTxHash",
              d.created_at as "createdAt", d.escrowed_at as "escrowedAt", d.depositor,
              u.email as "userEmail", u.id as "userId",
              q.net_fiat_minor as "quotedNgnMinor", q.fee_units as "feeUnits", q.rate,
              b.institution_name as "bankName", b.account_last4 as "accountLast4", b.account_name as "accountName",
              p.status as "payoutStatus", p.provider_order_id as "providerOrderId", p.fiat_minor as "paidNgnMinor",
              p.funding_tx_hash as "fundingTxHash", p.funded_at as "fundedAt", p.funding_skipped as "fundingSkipped",
              p.failure_reason as "failureReason", p.settle_tx_hash as "settleTxHash", p.settled_at as "settledAt",
              p.completed_at as "payoutCompletedAt"
         from deposits d
         join users u on u.id = d.user_id
         join quotes q on q.id = d.quote_id
         join bank_accounts b on b.id = q.bank_account_id
         left join payouts p on p.deposit_id = d.id
        where ($1::text is null or d.status = $1)
        order by d.created_at desc
        limit $2`,
      [opts.status ?? null, opts.limit],
    );
    return rows;
  }

  async events(opts: { limit: number }) {
    const [audit, webhooks] = await Promise.all([
      this.#db.query(
        `select e.id, e.kind, e.data, e.created_at as "createdAt", u.email as "userEmail"
           from audit_events e left join users u on u.id = e.user_id
          order by e.id desc limit $1`,
        [opts.limit],
      ),
      this.#db.query(
        `select id, provider, event, order_id as "orderId", status, payout_id as "payoutId", received_at as "receivedAt"
           from provider_events order by id desc limit $1`,
        [opts.limit],
      ),
    ]);
    return { audit: audit.rows, webhooks: webhooks.rows };
  }

  async users(opts: { limit: number }) {
    const { rows } = await this.#db.query(
      `select u.id, u.email, u.display_name as "displayName", u.wallet_address as "walletAddress",
              u.created_at as "createdAt", u.onboarded_at as "onboardedAt",
              b.institution_name as "bankName", b.account_last4 as "accountLast4", b.account_name as "accountName",
              (select count(*)::int from deposits d where d.user_id = u.id and d.status <> 'awaiting_deposit') as "cashouts",
              (select coalesce(sum(d.amount_units), 0)::text from deposits d
                where d.user_id = u.id and d.status <> 'awaiting_deposit') as "volumeUnits"
         from users u
         left join bank_accounts b on b.user_id = u.id and b.status = 'active'
        order by u.created_at desc
        limit $1`,
      [opts.limit],
    );
    return rows;
  }

  /** The worker's queue: what is waiting, running, or failing and why. */
  async jobs(opts: { limit: number }) {
    const { rows } = await this.#db
      .query(
        `select id::text, task_identifier as task, key, attempts, max_attempts as "maxAttempts", last_error as "lastError",
                run_at as "runAt", created_at as "createdAt", locked_at as "lockedAt"
           from graphile_worker.jobs order by run_at limit $1`,
        [opts.limit],
      )
      .catch(() => ({ rows: [] }));
    return rows;
  }
}
