"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { BACKEND_URL } from "@/lib/api/account";
import { formatUnits, shortHex } from "@/lib/money";

const REFRESH_MS = 15_000;

class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function admin<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/v1/admin/${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new AdminError(res.status, body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

// ---- API shapes -------------------------------------------------------------

interface Balance {
  label: string;
  network: string;
  address: string;
  asset: string;
  units: string | null;
  decimals: number;
  warnBelowUnits: string | null;
  explorerUrl: string;
  error?: string;
}

interface Overview {
  generatedAt: string;
  users: { total: number; today: number };
  deposits: Record<string, number>;
  payouts: Record<string, number>;
  volume: { usdcUnits: { total: string; today: string }; ngnMinor: { total: string; today: string }; feeUsdcUnits: string };
  attention: { depositId: string; reason: string; since: string; detail: string | null }[];
  services: { name: string; pid: number; startedAt: string; seenAt: string; healthy: boolean }[];
  jobs: Record<string, number>;
  balances: Balance[];
}

interface Cashout {
  id: string;
  status: string;
  chainId: number;
  amountUnits: string;
  depositTxHash: string | null;
  createdAt: string;
  escrowedAt: string | null;
  depositor: string;
  userEmail: string | null;
  quotedNgnMinor: string;
  feeUnits: string;
  rate: string;
  bankName: string;
  accountLast4: string;
  accountName: string;
  payoutStatus: string | null;
  providerOrderId: string | null;
  paidNgnMinor: string | null;
  fundingTxHash: string | null;
  fundingSkipped: string | null;
  failureReason: string | null;
  settleTxHash: string | null;
  settledAt: string | null;
}

interface AuditEvent {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  createdAt: string;
  userEmail: string | null;
}

interface Webhook {
  id: string;
  provider: string;
  event: string;
  orderId: string | null;
  status: string | null;
  payoutId: string | null;
  receivedAt: string;
}

interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
  walletAddress: string | null;
  createdAt: string;
  onboardedAt: string | null;
  bankName: string | null;
  accountLast4: string | null;
  cashouts: number;
  volumeUnits: string;
}

interface Job {
  id: string;
  task: string;
  key: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: string;
  lockedAt: string | null;
}

// ---- formatting -------------------------------------------------------------

const ARC_EXPLORER: Record<number, string> = { 5042: "https://explorer.arc.io", 5042002: "https://explorer.testnet.arc.io" };
const usdc = (units: string | null | undefined) => (units == null ? "—" : formatUnits(BigInt(units), 6, 2));
const ngn = (minor: string | null | undefined) => (minor == null ? "—" : `₦${formatUnits(BigInt(minor), 2, 2)}`);
const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function TxLink({ href, hash }: { href: string; hash: string | null }) {
  if (!hash) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs underline-offset-2 hover:underline">
      {shortHex(hash)} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

const TONE = {
  good: "bg-emerald-100 text-emerald-900",
  warn: "bg-amber-100 text-amber-900",
  bad: "bg-red-100 text-red-900",
  idle: "bg-muted text-muted-foreground",
} as const;

function Pill({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

function statusTone(status: string | null): keyof typeof TONE {
  if (status === "released" || status === "succeeded") return "good";
  if (status === "refunded" || status === "failed") return "bad";
  if (status === "escrowed" || status === "pending") return "warn";
  return "idle";
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold tracking-[-0.02em] text-ink">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold tracking-[-0.03em] text-ink tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</p> : null}
    </div>
  );
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">{children}</tbody>
      </table>
    </div>
  );
}

// ---- sign-in ----------------------------------------------------------------

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => admin("login", { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: () => {
      setPassword("");
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) login.mutate();
  };
  return (
    <main className="flex flex-1 items-center justify-center bg-paper p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-white p-6">
        <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-ink">MELO operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the admin password.</p>
        <label className="mt-5 block text-sm font-medium text-ink" htmlFor="admin-password">
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-border bg-white px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {login.error ? (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {login.error.message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!password || login.isPending}
          className="mt-4 h-11 w-full rounded-xl bg-ink text-sm font-semibold text-white transition-opacity disabled:opacity-50"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

// ---- dashboard --------------------------------------------------------------

const TABS = ["Cash-outs", "Activity", "Webhooks", "Users", "Jobs"] as const;
type Tab = (typeof TABS)[number];
const STATUSES = ["", "escrowed", "released", "refunded", "awaiting_deposit"] as const;

function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("Cash-outs");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("");
  const opts = { refetchInterval: REFRESH_MS, retry: false } as const;

  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => admin<Overview>("overview"), ...opts });
  const cashouts = useQuery({
    queryKey: ["admin", "cashouts", status],
    queryFn: () => admin<{ cashouts: Cashout[] }>(`cashouts?limit=200${status ? `&status=${status}` : ""}`),
    enabled: tab === "Cash-outs",
    ...opts,
  });
  const events = useQuery({
    queryKey: ["admin", "events"],
    queryFn: () => admin<{ audit: AuditEvent[]; webhooks: Webhook[] }>("events?limit=200"),
    enabled: tab === "Activity" || tab === "Webhooks",
    ...opts,
  });
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => admin<{ users: AdminUser[] }>("users?limit=200"),
    enabled: tab === "Users",
    ...opts,
  });
  const jobs = useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: () => admin<{ jobs: Job[] }>("jobs?limit=200"),
    enabled: tab === "Jobs",
    ...opts,
  });

  const signedOut = [overview, cashouts, events, users, jobs].some((q) => q.error instanceof AdminError && q.error.status === 401);
  useEffect(() => {
    if (signedOut) onSignedOut();
  }, [signedOut, onSignedOut]);

  const logout = async () => {
    await admin("logout", { method: "POST" }).catch(() => null);
    onSignedOut();
  };

  const o = overview.data;
  const worker = o?.services.find((s) => s.name === "worker");

  return (
    <main className="flex-1 bg-paper">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-ink">MELO operations</h1>
            <p className="text-xs text-muted-foreground">
              {o ? `Updated ${new Date(o.generatedAt).toLocaleTimeString()} · refreshes every 15s` : "Loading…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={!o ? "idle" : worker?.healthy ? "good" : "bad"}>
              Worker {!o ? "…" : worker ? (worker.healthy ? `up · seen ${ago(worker.seenAt)}` : `down · last ${ago(worker.seenAt)}`) : "never seen"}
            </Pill>
            <Pill tone={(o?.jobs.failing ?? 0) > 0 ? "bad" : "idle"}>
              Jobs {o?.jobs.queued ?? 0} queued · {o?.jobs.running ?? 0} running · {o?.jobs.failing ?? 0} failing
            </Pill>
            <button
              type="button"
              onClick={() => overview.refetch()}
              className="inline-flex size-9 items-center justify-center rounded-full text-ink hover:bg-white"
              aria-label="Refresh"
            >
              <RefreshCw className={`size-4 ${overview.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
            </button>
            <button
              type="button"
              onClick={logout}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink hover:bg-white"
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
        </header>

        {overview.error && !signedOut ? (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            {overview.error.message}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="USDC cashed out" value={usdc(o?.volume.usdcUnits.total)} sub={`${usdc(o?.volume.usdcUnits.today)} today`} />
          <Stat label="Naira paid" value={ngn(o?.volume.ngnMinor.total)} sub={`${ngn(o?.volume.ngnMinor.today)} today`} />
          <Stat label="Fees earned (USDC)" value={usdc(o?.volume.feeUsdcUnits)} sub="on released cash-outs" />
          <Stat
            label="Cash-outs"
            value={o ? (o.deposits.escrowed ?? 0) + (o.deposits.released ?? 0) + (o.deposits.refunded ?? 0) : "—"}
            sub={o ? `${o.deposits.released ?? 0} released · ${o.deposits.escrowed ?? 0} in escrow · ${o.deposits.refunded ?? 0} refunded` : undefined}
          />
          <Stat label="Users" value={o?.users.total ?? "—"} sub={o ? `${o.users.today} new today` : undefined} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Wallets" aside={<span className="text-xs text-muted-foreground">addresses only · keys stay on the server</span>}>
            {o && o.balances.length === 0 ? <p className="text-sm text-muted-foreground">No operating wallets configured.</p> : null}
            <ul className="flex flex-col divide-y divide-border">
              {o?.balances.map((b) => {
                const low = b.units != null && b.warnBelowUnits != null && BigInt(b.units) < BigInt(b.warnBelowUnits);
                return (
                  <li key={`${b.label}-${b.network}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {b.label} <span className="font-normal text-muted-foreground">· {b.network}</span>
                      </p>
                      <a
                        href={b.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:underline"
                      >
                        {shortHex(b.address)} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </div>
                    <div className="text-right">
                      <p className={`font-display text-lg font-bold tabular-nums ${low ? "text-red-700" : "text-ink"}`}>
                        {b.units == null ? "unavailable" : `${formatUnits(BigInt(b.units), b.decimals, b.decimals === 18 ? 6 : 2)} ${b.asset}`}
                      </p>
                      {low ? (
                        <p className="text-xs text-red-700">
                          below {formatUnits(BigInt(b.warnBelowUnits!), b.decimals, b.decimals === 18 ? 6 : 2)} — top up
                        </p>
                      ) : b.error ? (
                        <p className="max-w-56 truncate text-xs text-muted-foreground" title={b.error}>
                          {b.error}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section
            title="Needs attention"
            aside={o && o.attention.length > 0 ? <Pill tone="bad">{o.attention.length}</Pill> : <Pill tone="good">all clear</Pill>}
          >
            {o && o.attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing stuck. Every cash-out is moving or finished.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {o?.attention.map((a) => (
                  <li key={`${a.depositId}-${a.reason}`} className="flex gap-2.5 rounded-xl bg-amber-50 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{a.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        cash-out <span className="font-mono">{a.depositId.slice(0, 8)}</span> · since {ago(a.since)}
                        {a.detail ? ` · ${a.detail}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <nav className="flex flex-wrap gap-1 rounded-full bg-white p-1 sm:self-start" aria-label="Dashboard views">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`h-9 rounded-full px-4 text-sm font-medium transition-colors ${tab === t ? "bg-ink text-white" : "text-ink hover:bg-muted"}`}
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === "Cash-outs" ? (
          <Section
            title="Cash-outs"
            aside={
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
                className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
                aria-label="Filter by status"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s ? s.replace("_", " ") : "All funded + unfunded"}
                  </option>
                ))}
              </select>
            }
          >
            <Table
              empty={cashouts.isPending ? "Loading…" : "No cash-outs."}
              head={["Created", "User", "USDC", "Naira", "Bank", "Escrow", "Payout", "Deposit tx", "Funding tx", "Settle tx"]}
            >
              {(cashouts.data?.cashouts ?? []).map((c) => {
                const arc = ARC_EXPLORER[c.chainId] ?? "";
                return (
                  <tr key={c.id} className="align-top">
                    <td className="py-2.5 pr-4">
                      <p>{time(c.createdAt)}</p>
                      <p className="font-mono text-xs text-muted-foreground">{c.id.slice(0, 8)}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <p>{c.userEmail ?? "—"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{shortHex(c.depositor)}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <p>{usdc(c.amountUnits)}</p>
                      <p className="text-xs text-muted-foreground">fee {usdc(c.feeUnits)}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <p>{ngn(c.paidNgnMinor ?? c.quotedNgnMinor)}</p>
                      <p className="text-xs text-muted-foreground">@ {c.rate}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <p>{c.bankName}</p>
                      <p className="text-xs text-muted-foreground">
                        ••{c.accountLast4} · {c.accountName}
                      </p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Pill tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Pill>
                    </td>
                    <td className="py-2.5 pr-4">
                      {c.payoutStatus ? <Pill tone={statusTone(c.payoutStatus)}>{c.payoutStatus}</Pill> : <span className="text-muted-foreground">—</span>}
                      {c.fundingSkipped ? <p className="mt-1 max-w-48 text-xs text-red-700">not funded: {c.fundingSkipped}</p> : null}
                      {c.failureReason ? <p className="mt-1 max-w-48 text-xs text-red-700">{c.failureReason}</p> : null}
                      {c.providerOrderId ? <p className="mt-1 font-mono text-xs text-muted-foreground">{shortHex(c.providerOrderId, 8, 4)}</p> : null}
                    </td>
                    <td className="py-2.5 pr-4">
                      <TxLink hash={c.depositTxHash} href={`${arc}/tx/${c.depositTxHash}`} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <TxLink hash={c.fundingTxHash} href={`https://basescan.org/tx/${c.fundingTxHash}`} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <TxLink hash={c.settleTxHash} href={`${arc}/tx/${c.settleTxHash}`} />
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Section>
        ) : null}

        {tab === "Activity" ? (
          <Section title="Activity log" aside={<span className="text-xs text-muted-foreground">latest 200 events</span>}>
            <Table empty={events.isPending ? "Loading…" : "No events yet."} head={["When", "Event", "User", "Details"]}>
              {(events.data?.audit ?? []).map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{time(e.createdAt)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{e.kind}</td>
                  <td className="py-2 pr-4">{e.userEmail ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <code className="block max-w-xl truncate font-mono text-xs text-muted-foreground" title={JSON.stringify(e.data)}>
                      {JSON.stringify(e.data)}
                    </code>
                  </td>
                </tr>
              ))}
            </Table>
          </Section>
        ) : null}

        {tab === "Webhooks" ? (
          <Section title="Paycrest webhooks" aside={<span className="text-xs text-muted-foreground">verified deliveries only</span>}>
            <Table empty={events.isPending ? "Loading…" : "No webhooks received yet."} head={["Received", "Event", "Order", "Status", "Matched payout"]}>
              {(events.data?.webhooks ?? []).map((w) => (
                <tr key={w.id}>
                  <td className="py-2 pr-4 whitespace-nowrap">{time(w.receivedAt)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{w.event}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{w.orderId ? shortHex(w.orderId, 8, 4) : "—"}</td>
                  <td className="py-2 pr-4">{w.status ? <Pill tone={statusTone(w.status)}>{w.status}</Pill> : "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{w.payoutId?.slice(0, 8) ?? "—"}</td>
                </tr>
              ))}
            </Table>
          </Section>
        ) : null}

        {tab === "Users" ? (
          <Section title="Users">
            <Table empty={users.isPending ? "Loading…" : "No users yet."} head={["Joined", "User", "Wallet", "Bank", "Cash-outs", "Volume (USDC)"]}>
              {(users.data?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-4 whitespace-nowrap">{time(u.createdAt)}</td>
                  <td className="py-2 pr-4">
                    <p>{u.displayName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{u.email ?? "no email"}</p>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{u.walletAddress ? shortHex(u.walletAddress) : "—"}</td>
                  <td className="py-2 pr-4">{u.bankName ? `${u.bankName} ••${u.accountLast4}` : <span className="text-muted-foreground">not set</span>}</td>
                  <td className="py-2 pr-4">{u.cashouts}</td>
                  <td className="py-2 pr-4">{usdc(u.volumeUnits)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        ) : null}

        {tab === "Jobs" ? (
          <Section title="Worker queue" aside={<span className="text-xs text-muted-foreground">finished jobs leave the queue</span>}>
            <Table empty={jobs.isPending ? "Loading…" : "Queue is empty."} head={["Task", "Key", "Attempts", "Next run", "State", "Last error"]}>
              {(jobs.data?.jobs ?? []).map((j) => (
                <tr key={j.id} className="align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{j.task}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{j.key ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {j.attempts}/{j.maxAttempts}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{time(j.runAt)}</td>
                  <td className="py-2 pr-4">
                    <Pill tone={j.lastError ? "bad" : j.lockedAt ? "warn" : "idle"}>{j.lastError ? "retrying" : j.lockedAt ? "running" : "queued"}</Pill>
                  </td>
                  <td className="py-2 pr-4">
                    <code className="block max-w-md truncate font-mono text-xs text-red-700" title={j.lastError ?? ""}>
                      {j.lastError ?? ""}
                    </code>
                  </td>
                </tr>
              ))}
            </Table>
          </Section>
        ) : null}
      </div>
    </main>
  );
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["admin", "session"],
    queryFn: () => admin<{ ok: true }>("session"),
    retry: false,
    enabled: !!BACKEND_URL,
  });
  const signOut = useCallback(() => {
    queryClient.removeQueries({ queryKey: ["admin"] });
    queryClient.setQueryData(["admin", "session"], null);
  }, [queryClient]);

  if (!BACKEND_URL) {
    return <main className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">The admin dashboard needs the MELO backend.</main>;
  }
  if (session.isPending) {
    return <main className="flex-1 bg-paper" />;
  }
  if (!session.data) {
    return <Login onDone={() => queryClient.invalidateQueries({ queryKey: ["admin"] })} />;
  }
  return <Dashboard onSignedOut={signOut} />;
}
