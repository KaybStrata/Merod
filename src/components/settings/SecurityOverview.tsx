"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { KeyRound, Monitor, Smartphone, LogOut, OctagonX, ScrollText, Download, Plus, ShieldCheck, ShieldAlert, Gauge, Banknote, ArrowRight } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { Badge, Button, cx, useToast } from "@/components/ui";
import { TwoFactor, deviceName } from "./AccountSecurity";

/* ───────── shared panel ───────── */
export function Panel({ title, icon: Icon, action, children, className, sub }: { title: React.ReactNode; icon?: any; action?: React.ReactNode; children: React.ReactNode; className?: string; sub?: React.ReactNode }) {
  return (
    <section className={cx("surface min-w-0 rounded-2xl", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold">{Icon && <Icon className="size-4 text-accent-2" />}{title}</h3>
          {sub && <p className="mt-0.5 text-[11.5px] text-muted">{sub}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Honest security checks → score shown in the page header and on the Security tab. */
export function useSecurityScore(data: any) {
  const sessions = useApi<any>("/api/settings/sessions");
  const keys = useApi<any>("/api/me/keys");
  const devices = sessions.data?.sessions?.length ?? 0;
  const failing = (keys.data?.keys ?? []).filter((k: any) => k.status === "error" || k.status === "failed").length;
  const checks = [
    { ok: true, label: "Password set" },
    { ok: !!data?.user?.totp_enabled, label: "Two-factor authentication on" },
    { ok: devices > 0 && devices <= 3, label: "3 or fewer signed-in devices" },
    { ok: failing === 0, label: "No failing API keys" },
  ];
  return { score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100), checks, sessions, keys };
}

/* ───────── keys vault ───────── */
function KeysVault({ keys }: { keys: ReturnType<typeof useApi<any>> }) {
  const providers: Record<string, any> = Object.fromEntries((keys.data?.providers ?? []).map((p: any) => [p.id, p]));
  const rows = useMemo(() => {
    const m = new Map<string, any>();
    for (const k of keys.data?.keys ?? []) {
      const id = `${k.provider_id}:${k.environment}`;
      const r = m.get(id) ?? { provider: k.provider_id, env: k.environment, names: [] as string[], last4: null, status: k.status, tested: k.tested_at, error: k.last_error };
      r.names.push(k.name); r.last4 = r.last4 ?? k.last4;
      if (k.status === "error" || k.status === "failed") { r.status = k.status; r.error = k.last_error; }
      if (k.tested_at && (!r.tested || k.tested_at > r.tested)) r.tested = k.tested_at;
      m.set(id, r);
    }
    return [...m.values()];
  }, [keys.data]);
  const tone = (s: string) => (s === "ok" || s === "connected" || s === "active" ? "up" : s === "error" || s === "failed" ? "down" : "warn");
  const label = (s: string) => (s === "ok" || s === "connected" || s === "active" ? "Passing" : s === "error" || s === "failed" ? "Failing" : "Untested");
  return (
    <Panel title="Broker & AI keys vault" icon={KeyRound} sub="Encrypted at rest. Values are never shown again after saving."
      action={<Link href="/broker-keys#my-keys"><Button size="sm" variant="ghost"><Plus className="size-3.5" /> Add key</Button></Link>}>
      {!rows.length ? (
        <p className="py-6 text-center text-sm text-muted">{keys.loading ? "Loading keys…" : "No personal keys yet. Add Alpaca, an exchange, Claude or ChatGPT keys to trade and prompt with your own accounts."}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead><tr className="border-b border-line/70 text-left text-[10.5px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-medium">Provider</th><th className="px-2 py-2 font-medium">Key</th><th className="px-2 py-2 font-medium">Scope</th><th className="px-2 py-2 font-medium">Last tested</th><th className="px-2 py-2 font-medium">Status</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.provider}:${r.env}`} className="border-b border-line/50 last:border-0 hover:bg-panel-2/40">
                  <td className="px-4 py-2.5"><div className="font-semibold">{providers[r.provider]?.name ?? r.provider}</div><div className="text-[11px] text-faint">{providers[r.provider]?.category ?? ""}</div></td>
                  <td className="num px-2 py-2.5 text-muted">{r.last4 ? `••••${r.last4}` : "••••"}<span className="ml-1.5 text-[11px] text-faint">{r.names.length} field{r.names.length === 1 ? "" : "s"}</span></td>
                  <td className="px-2 py-2.5"><span className={cx("rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", r.env === "production" ? "bg-down-soft text-down" : "bg-panel-2 text-muted")}>{r.env === "production" ? "LIVE" : "PAPER"}</span></td>
                  <td className="px-2 py-2.5 text-muted">{r.tested ? ago(r.tested) : "never"}</td>
                  <td className="px-2 py-2.5"><Badge tone={tone(r.status)} title={r.error ?? undefined}>{label(r.status)}</Badge></td>
                  <td className="px-4 py-2.5 text-right"><Link href="/broker-keys#my-keys" className="text-[12px] text-accent-2 hover:underline">Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ───────── sessions ───────── */
function Sessions({ sessions }: { sessions: ReturnType<typeof useApi<any>> }) {
  const toast = useToast();
  const list: any[] = sessions.data?.sessions ?? [];
  return (
    <Panel title="Active sessions" icon={Monitor} sub={`${list.length} signed-in device${list.length === 1 ? "" : "s"}`}
      action={list.length > 1 ? <Button size="sm" variant="ghost" onClick={async () => { const r: any = await api("/api/settings/sessions?all=others", { method: "DELETE" }); toast(`Signed out ${r.revoked} other device(s)`, "up"); sessions.refresh(); }}><LogOut className="size-3.5" /> Others</Button> : undefined}>
      <ul className="space-y-1.5">
        {list.slice(0, 6).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-line/70 bg-bg-2/40 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2.5">
              {/iPhone|Android|iPad/.test(s.user_agent ?? "") ? <Smartphone className="size-4 shrink-0 text-muted" /> : <Monitor className="size-4 shrink-0 text-muted" />}
              <span className="min-w-0"><span className="block truncate text-[12.5px] font-medium">{deviceName(s.user_agent)}</span><span className="block truncate text-[11px] text-faint">{ago(s.created_at)}{s.ip ? ` · ${s.ip}` : ""}</span></span>
            </span>
            {s.current ? <Badge tone="up">This device</Badge> : <button className="text-[11.5px] text-muted hover:text-down" onClick={async () => { await api(`/api/settings/sessions?id=${s.id}`, { method: "DELETE" }); toast("Signed out that device", "up"); sessions.refresh(); }}>Revoke</button>}
          </li>
        ))}
        {!list.length && <li className="py-3 text-center text-sm text-muted">Loading…</li>}
      </ul>
    </Panel>
  );
}

/* ───────── risk tiles with sliders (0 = no limit) ───────── */
const USD_STEPS = [0, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000];
const BPS_STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, 5000];
const nearest = (steps: number[], v: number) => steps.reduce((bi, s, i) => (Math.abs(s - v) < Math.abs(steps[bi] - v) ? i : bi), 0);
const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function Tile({ label, value, display, steps, onChange, hint, tone }: { label: string; value: number; display: string; steps: number[]; onChange: (v: number) => void; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-bg-2/40 p-3">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={cx("num mt-1 text-[19px] font-semibold", tone)}>{display}</div>
      <input type="range" min={0} max={steps.length - 1} step={1} value={nearest(steps, value)} onChange={(e) => onChange(steps[Number(e.target.value)])}
        aria-label={label} className="mt-2 w-full accent-[var(--accent)]" />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-faint">{hint}</span>
        <input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} className="num h-6 w-24 rounded-md border border-line bg-panel px-1.5 text-right text-[11px] outline-none focus:border-accent" aria-label={`${label} exact value`} />
      </div>
    </div>
  );
}

export function RiskTiles({ data, refresh }: { data: any; refresh: () => void }) {
  const toast = useToast();
  const r = data.risk, p = data.permissions;
  const initial = { max_order_usd: +r.max_order_usd, max_daily_spend_usd: +r.max_daily_spend_usd, max_daily_loss_usd: +r.max_daily_loss_usd, max_slippage_bps: +r.max_slippage_bps, auto_max_order_usd: +p.auto_max_order_usd, auto_daily_cap_usd: +p.auto_daily_cap_usd };
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const lim = (n: number) => (n > 0 ? fmt(n) : "No limit");
  async function save() {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", json: { section: "risk", values: { max_order_usd: v.max_order_usd, max_daily_spend_usd: v.max_daily_spend_usd, max_daily_loss_usd: v.max_daily_loss_usd, max_slippage_bps: v.max_slippage_bps,
        min_liquidity_usd: +r.min_liquidity_usd, max_price_age_sec: +r.max_price_age_sec, block_risky_tokens: r.block_risky_tokens, trading_halted: r.trading_halted } } });
      await api("/api/settings", { method: "PATCH", json: { section: "automation", values: { mode: p.mode, auto_max_order_usd: v.auto_max_order_usd, auto_daily_cap_usd: v.auto_daily_cap_usd,
        allow_ai_prompts: p.allow_ai_prompts, allow_bots: p.allow_bots, allow_shortcuts: p.allow_shortcuts, allowed_asset_classes: p.allowed_asset_classes } } });
      toast("Risk limits saved", "up"); refresh();
    } catch (e: any) { toast(e.body?.issues?.[0] ? `${e.body.issues[0].path}: ${e.body.issues[0].message}` : e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <Panel title="Risk limits" icon={Gauge} sub="Apply to every manual, prompt, shortcut, bot and agent order. 0 = no limit. The engine always checks real buying power."
      action={<div className="flex gap-2">{dirty && <Button size="sm" variant="ghost" onClick={() => setV(initial)}>Reset</Button>}<Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save limits</Button></div>}>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="Max order size" value={v.max_order_usd} display={lim(v.max_order_usd)} steps={USD_STEPS} onChange={(x) => setV({ ...v, max_order_usd: x })} hint="per order" />
        <Tile label="Daily spend" value={v.max_daily_spend_usd} display={lim(v.max_daily_spend_usd)} steps={USD_STEPS} onChange={(x) => setV({ ...v, max_daily_spend_usd: x })} hint="buys per day" />
        <Tile label="Daily loss stop" value={v.max_daily_loss_usd} display={v.max_daily_loss_usd > 0 ? `-${fmt(v.max_daily_loss_usd)}` : "No limit"} tone={v.max_daily_loss_usd > 0 ? "text-down" : undefined} steps={USD_STEPS} onChange={(x) => setV({ ...v, max_daily_loss_usd: x })} hint="realized loss" />
        <Tile label="Max slippage" value={v.max_slippage_bps} display={`${(v.max_slippage_bps / 100).toFixed(2)}%`} steps={BPS_STEPS} onChange={(x) => setV({ ...v, max_slippage_bps: Math.max(1, x) })} hint="in basis points" />
        <Tile label="Automated order cap" value={v.auto_max_order_usd} display={lim(v.auto_max_order_usd)} steps={USD_STEPS} onChange={(x) => setV({ ...v, auto_max_order_usd: x })} hint="bots, agents, prompts" />
        <Tile label="Automated daily cap" value={v.auto_daily_cap_usd} display={lim(v.auto_daily_cap_usd)} steps={USD_STEPS} onChange={(x) => setV({ ...v, auto_daily_cap_usd: x })} hint="all automation / day" />
      </div>
    </Panel>
  );
}

/* ───────── real money + kill switch ───────── */
function RealMoney({ data, refresh, owner }: { data: any; refresh: () => void; owner: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const r = data.risk;
  const halted = !!r.trading_halted;
  async function kill() {
    if (!halted && !confirm("Engage the emergency stop? Every new order is rejected and all bots halt immediately.")) return;
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", json: { section: "risk", values: { max_order_usd: +r.max_order_usd, max_daily_spend_usd: +r.max_daily_spend_usd, max_daily_loss_usd: +r.max_daily_loss_usd, max_slippage_bps: +r.max_slippage_bps,
        min_liquidity_usd: +r.min_liquidity_usd, max_price_age_sec: +r.max_price_age_sec, block_risky_tokens: r.block_risky_tokens, trading_halted: !halted } } });
      toast(halted ? "Trading re-enabled" : "Emergency stop engaged: all trading halted", halted ? "up" : "down"); refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <Panel title="Real money" icon={Banknote} sub={data.user.trading_mode === "live" ? "Live trading mode" : "Paper trading mode · virtual funds"}>
      <div className="flex items-center gap-4">
        <button onClick={kill} disabled={busy} aria-label={halted ? "Release emergency stop" : "Engage emergency stop"}
          className={cx("flex size-20 shrink-0 flex-col items-center justify-center rounded-full border-2 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-60",
            halted ? "border-up/60 bg-up-soft text-up" : "border-down/60 bg-down-soft text-down hover:bg-down hover:text-white")}>
          <OctagonX className="mb-0.5 size-6" />{halted ? "Resume" : "Kill"}
        </button>
        <div className="min-w-0 text-[12.5px] text-muted">
          <div className="font-semibold text-text">{halted ? "Emergency stop is ON" : "Emergency stop"}</div>
          <p className="mt-0.5">{halted ? "Every new order is rejected and bots are halted. Tap Resume to trade again." : "One tap rejects every new order and halts all bots and agents. Takes effect immediately."}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 text-[12px]">
        <li className="flex items-center justify-between rounded-lg bg-bg-2/40 px-2.5 py-1.5"><span className="text-muted">Two-factor for real money</span>{data.user.totp_enabled ? <Badge tone="up">On</Badge> : <Badge tone="warn">Required</Badge>}</li>
        <li className="flex items-center justify-between rounded-lg bg-bg-2/40 px-2.5 py-1.5"><span className="text-muted">Real-money switch</span><span className="text-[11.5px] text-faint">{owner ? "Sidebar → Real money" : "Platform owner only"}</span></li>
        <li className="flex items-center justify-between rounded-lg bg-bg-2/40 px-2.5 py-1.5"><span className="text-muted">Live accounts</span><Link href="/wallet" className="flex items-center gap-1 text-[11.5px] text-accent-2 hover:underline">Wallet & Funds <ArrowRight className="size-3" /></Link></li>
      </ul>
    </Panel>
  );
}

/* ───────── audit log ───────── */
function AuditLog() {
  const a = useApi<any>("/api/settings/audit", { refreshMs: 30_000 });
  const list: any[] = a.data?.entries ?? [];
  return (
    <Panel title="Audit log" icon={ScrollText} sub={`Append-only and hash-chained · ${a.data?.total ?? "—"} entries`}
      action={<a href="/api/settings/audit?format=csv" className="flex items-center gap-1 text-[12px] text-accent-2 hover:underline"><Download className="size-3.5" /> CSV</a>}>
      <ol className="max-h-[300px] space-y-px overflow-y-auto">
        {list.map((e) => (
          <li key={e.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[12px] hover:bg-panel-2/40">
            <span className="num w-14 shrink-0 text-[11px] text-faint">{ago(e.created_at)}</span>
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{e.action}</span>{e.target ? <span className="text-faint"> · {String(e.target).slice(0, 24)}</span> : null}</span>
            <span className="shrink-0 rounded bg-panel-2 px-1.5 py-px text-[10px] text-muted">{e.actor_type}</span>
            <span className="num hidden shrink-0 text-[10px] text-faint sm:inline">#{e.hash}</span>
          </li>
        ))}
        {!list.length && <li className="py-4 text-center text-sm text-muted">{a.loading ? "Loading…" : "No entries yet."}</li>}
      </ol>
    </Panel>
  );
}

/** Security tab: the "Security & keys" overview from the design. */
export function SecurityOverview({ data, refresh, owner, score }: { data: any; refresh: () => void; owner: boolean; score: ReturnType<typeof useSecurityScore> }) {
  return (
    <div className="space-y-4">
      <div className="surface flex flex-wrap items-center gap-4 rounded-2xl px-4 py-3">
        {score.score === 100 ? <ShieldCheck className="size-8 text-up" /> : <ShieldAlert className="size-8 text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Security score <span className={cx("num", score.score === 100 ? "text-up" : "text-warn")}>{score.score}</span><span className="text-faint">/100</span></div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{score.checks.map((c) => <span key={c.label} className={cx("text-[11.5px]", c.ok ? "text-muted" : "text-warn")}>{c.ok ? "✓" : "○"} {c.label}</span>)}</div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <KeysVault keys={score.keys} />
          <RiskTiles data={data} refresh={refresh} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RealMoney data={data} refresh={refresh} owner={owner} />
            <AuditLog />
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <TwoFactor on={!!data.user.totp_enabled} refresh={refresh} />
          <Sessions sessions={score.sessions} />
        </div>
      </div>
    </div>
  );
}
