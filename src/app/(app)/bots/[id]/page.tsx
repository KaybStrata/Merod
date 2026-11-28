"use client";
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PlayCircle, PauseCircle, Square, Activity, LineChart, Settings2, FlaskConical, AlertTriangle, Trash2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Card, Input, PaperBadge, Pills, Select, SourceBadge, Stat, StatusPill, Toggle, cx, useToast } from "@/components/ui";
import { useRealtime } from "@/components/shell/context";
import { usd, pct, price, qty, ago, tone } from "@/lib/format";
import { AutoModesBar } from "@/components/AutoModesBar";

const LEVEL_TONE: Record<string, string> = { observation: "text-muted", trigger: "text-accent-2", instruction: "text-[#4aa8ff]", order: "text-warn", result: "text-up", warning: "text-warn", error: "text-down", control: "text-text" };

export default function BotDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data, refresh, error } = useApi<any>(`/api/bots/${id}`, { refreshMs: 8000 });
  const [logs, setLogs] = useState<any[]>([]);
  const [level, setLevel] = useState("all");
  const [tab, setTab] = useState<"activity" | "orders" | "config" | "backtest">("activity");
  const [busy, setBusy] = useState<string | null>(null);

  const loadLogs = async () => {
    try { const r = await api(`/api/bots/${id}/logs${level !== "all" ? `?level=${level}` : ""}`); setLogs(r.logs); } catch { /* ignore */ }
  };
  useEffect(() => { loadLogs(); const t = setInterval(loadLogs, 10000); return () => clearInterval(t); }, [id, level]); // eslint-disable-line
  useRealtime((e) => {
    if (e.channel !== `bot:${id}` || e.type !== "log") return;
    if (level !== "all" && e.payload.level !== level) return;
    setLogs((l) => [{ id: `rt${e.payload.ts}${Math.random()}`, level: e.payload.level, message: e.payload.message, data: e.payload.data, created_at: new Date(e.payload.ts).toISOString() }, ...l].slice(0, 300));
    if (["result", "order", "control"].includes(e.payload.level)) refresh();
  }, `bot:${id}`);

  async function control(action: string) {
    setBusy(action);
    try { await api(`/api/bots/${id}`, { method: "POST", json: { action } }); refresh(); loadLogs(); toast(`Bot ${action === "stop" ? "stopped" : action === "pause" ? "paused" : "running"}`, "up"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function remove() {
    if (!confirm("Delete this bot and its activity log?")) return;
    try { await api(`/api/bots/${id}`, { method: "DELETE" }); router.push("/bots"); } catch (e: any) { toast(e.message, "down"); }
  }

  if (error) return <div className="py-16 text-center text-muted">{error} · <Link href="/bots" className="text-accent-2">Back to bots</Link></div>;
  if (!data) return <div className="py-16 text-center text-muted">Loading…</div>;
  const { bot, assets, orders, stats, strategy } = data;
  const st = bot.state ?? {};

  return (
    <div className="space-y-5">
      <Link href="/bots" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" /> Agents & Bots</Link>
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-panel/80 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="page-title">{bot.name}</h1><StatusPill status={bot.status} /><PaperBadge paper={bot.is_paper} /></div>
          <p className="mt-1 text-sm text-muted">{bot.strategy_name} · {bot.account_label} · checks every {bot.schedule.replace("every_", "")}{bot.last_tick_at ? ` · last check ${ago(bot.last_tick_at)}` : ""}</p>
          {bot.description && <p className="mt-1 text-sm">{bot.description}</p>}
          {bot.created_from_prompt && <p className="mt-1 text-xs text-faint">Created from prompt: “{bot.created_from_prompt}”</p>}
          <div className="mt-2"><div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Auto switches for this bot</div><AutoModesBar scope="bot" scopeRef={bot.id} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-bg-2 px-3 py-1.5 text-xs text-muted" title="Auto-training only reduces risk; changes are revertible on the Auto-Training page">
            <Link href="/training" className="hover:text-text">Auto-training</Link>
            <select value={bot.auto_training ?? "inherit"} className="bg-transparent text-text outline-none"
              onChange={async (e) => { try { await api("/api/training", { method: "POST", json: { kind: "bot", id, mode: e.target.value } }); refresh(); toast("Auto-training updated", "up"); } catch (err: any) { toast(err.message, "down"); } }}>
              <option value="inherit">Inherit</option><option value="on">On</option><option value="off">Off</option>
            </select>
          </label>
          {bot.status === "running" ? (
            <Button onClick={() => control("pause")} loading={busy === "pause"}><PauseCircle className="size-4" /> Pause</Button>
          ) : (
            <Button variant="success" onClick={() => control(bot.status === "paused" ? "resume" : "start")} loading={busy === "start" || busy === "resume"}><PlayCircle className="size-4" /> {bot.status === "paused" ? "Resume" : "Start"}</Button>
          )}
          {!["stopped", "draft"].includes(bot.status) && <Button variant="danger" onClick={() => control("stop")} loading={busy === "stop"}><Square className="size-4" /> Terminate</Button>}
          {bot.status !== "running" && <Button variant="ghost" onClick={remove}><Trash2 className="size-4" /></Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Box><Stat label="Realized P&L" value={<span className={tone(bot.pnl_usd)}>{usd(bot.pnl_usd, { sign: true })}</span>} /></Box>
        <Box><Stat label="Unrealized P&L" value={<span className={tone(stats.unrealized)}>{usd(stats.unrealized, { sign: true })}</span>} /></Box>
        <Box><Stat label="Filled orders" value={stats.filled} sub={<span className="text-muted">{stats.rejected} rejected · {stats.pending} awaiting approval</span>} /></Box>
        <Box><Stat label="Win rate" value={stats.wins + stats.losses ? `${((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(0)}%` : "—"} sub={<span className="text-muted">{stats.wins}W / {stats.losses}L</span>} /></Box>
        <Box><Stat label="Spent today" value={usd(bot.spent_today_usd)} sub={<span className="text-muted">cap {usd(bot.max_daily_spend_usd)}</span>} /></Box>
        <Box><Stat label="Trades today" value={String(bot.trades_today)} sub={<span className="text-muted">fees {usd(stats.fees)}</span>} /></Box>
      </div>

      {bot.strategy_id === "dip_rebound_loop" && (
        <Card title="Loop state">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Stat label="Phase" value={<span className="text-base">{String(st.phase ?? "waiting_dip").replace(/_/g, " ")}</span>} />
            <Stat label="Reference high" value={st.ref ? price(st.ref) : "—"} />
            <Stat label="Buy trigger" value={st.ref ? price(st.ref * (1 - bot.params.dip_pct / 100)) : "—"} sub={<span className="text-muted">−{bot.params.dip_pct}%</span>} />
            <Stat label="Entry / sell target" value={st.entry ? `${price(st.entry)} → ${price(st.entry * (1 + bot.params.take_profit_pct / 100))}` : "—"} sub={<span className="text-muted">+{bot.params.take_profit_pct}%</span>} />
            <Stat label="Cycles completed" value={st.cycles ?? 0} sub={<span className="text-muted">{bot.params.repeat ? (bot.params.max_cycles ? `of ${bot.params.max_cycles}` : "repeat on") : "single cycle"}</span>} />
          </div>
        </Card>
      )}

      {assets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {assets.map((a: any) => (
            <Link key={a.id} href={`/terminal/${a.id}`} className="flex items-center gap-2 rounded-xl border border-line bg-panel/80 px-3 py-2 text-sm hover:border-accent/50">
              <b>{a.symbol}</b> <span className="num">{price(a.last_price)}</span> <span className={cx("num", tone(a.change_24h))}>{pct(a.change_24h)}</span> <SourceBadge source={a.price_source} />
            </Link>
          ))}
        </div>
      )}

      <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3", bot.allow_risky ? "border-down/50 bg-down-soft/30" : "border-line bg-panel/80")}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">Never reject trades {bot.allow_risky && <Badge tone="down">ON</Badge>}</div>
          <p className="mt-0.5 text-xs text-muted">Buys go through even when a coin is flagged (new listing, unverified, low liquidity), below the minimum liquidity, or above the max slippage. Those findings still show in the log as &quot;allowed&quot;. Buying power, the emergency stop and a live price still apply, because a trade can&apos;t execute without them.{!bot.is_paper && " This bot uses real money: risky coins can drop to zero or be impossible to sell."}</p>
        </div>
        <Toggle checked={!!bot.allow_risky} disabled={busy === "risky"} onChange={async (v) => {
          if (v && !bot.is_paper && !confirm("This bot trades real money. Let it buy flagged, low-liquidity coins without rejecting?")) return;
          setBusy("risky");
          try { await api(`/api/bots/${id}`, { method: "PATCH", json: { allowRisky: v } }); refresh(); loadLogs(); toast(v ? "This bot won't reject trades for risk flags, liquidity or slippage" : "Risk rejections are back on for this bot", v ? "neutral" : "up"); }
          catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
        }} />
      </div>

      <Pills value={tab} onChange={setTab} options={[{ value: "activity", label: "Activity log" }, { value: "orders", label: `Orders (${orders.length})` }, { value: "config", label: "Configuration" }, { value: "backtest", label: "Backtest" }]} />

      {tab === "activity" && (
        <Card title="Live decision log" icon={<Activity className="size-4 text-accent-2" />} action={
          <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-40">
            {["all", "observation", "trigger", "instruction", "order", "result", "warning", "error", "control"].map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>}>
          {logs.length === 0 ? <p className="text-sm text-muted">No activity yet{bot.status !== "running" ? " — start the bot to begin." : "."}</p> : (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto font-mono text-xs">
              {logs.map((l) => (
                <div key={l.id} className="flex gap-3 border-b border-line/40 py-1.5">
                  <span className="w-16 shrink-0 text-faint">{new Date(l.created_at).toLocaleTimeString()}</span>
                  <span className={cx("w-20 shrink-0 uppercase", LEVEL_TONE[l.level])}>{l.level}</span>
                  <span className="min-w-0 break-words">{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "orders" && (
        <Card title="Orders placed by this bot" pad={false}>
          {orders.length === 0 ? <p className="p-4 text-sm text-muted">No orders yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-faint"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Time</th><th className="px-3 font-medium">Side</th><th className="px-3 font-medium">Asset</th><th className="px-3 text-right font-medium">Qty</th><th className="px-3 text-right font-medium">Avg price</th><th className="px-3 text-right font-medium">P&L</th><th className="px-3 font-medium">Status</th><th className="px-4 font-medium">Reason</th></tr></thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} className="border-b border-line/60">
                      <td className="px-4 py-2 text-muted">{ago(o.created_at)}</td>
                      <td className={cx("px-3 font-medium", o.side === "buy" ? "text-up" : "text-down")}>{o.side.toUpperCase()}</td>
                      <td className="px-3">{o.symbol}</td>
                      <td className="num px-3 text-right">{qty(o.filled_quantity || o.quantity)}</td>
                      <td className="num px-3 text-right">{price(o.avg_fill_price)}</td>
                      <td className={cx("num px-3 text-right", tone(o.realized_pnl))}>{o.side === "sell" && o.status === "filled" ? usd(o.realized_pnl, { sign: true }) : "—"}</td>
                      <td className="px-3"><StatusPill status={o.status} /></td>
                      <td className="max-w-[260px] truncate px-4 text-xs text-muted" title={o.status_reason}>{o.status_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {orders.some((o: any) => o.status === "pending_approval") && <p className="px-4 py-3 text-xs text-warn">Some orders are waiting for your approval — review them in <Link href="/portfolio" className="underline">Portfolio → Orders</Link>.</p>}
        </Card>
      )}

      {tab === "config" && <ConfigEditor bot={bot} strategy={strategy} onSaved={refresh} />}
      {tab === "backtest" && <Backtest bot={bot} assets={assets} />}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) { return <div className="rounded-xl border border-line bg-panel/80 p-4">{children}</div>; }

function ConfigEditor({ bot, strategy, onSaved }: { bot: any; strategy: any; onSaved: () => void }) {
  const toast = useToast();
  const locked = bot.status === "running";
  const [p, setP] = useState<Record<string, any>>(bot.params ?? {});
  const [f, setF] = useState({ name: bot.name, budgetUsd: bot.budget_usd, maxPositionUsd: bot.max_position_usd, maxDailySpendUsd: bot.max_daily_spend_usd, maxDailyLossUsd: bot.max_daily_loss_usd,
    minLiquidityUsd: bot.min_liquidity_usd, maxSlippageBps: bot.max_slippage_bps, schedule: bot.schedule, approvalRequired: bot.approval_required });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const params = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, strategy?.params?.find((x: any) => x.key === k)?.type === "number" ? (v === "" || v == null ? null : Number(v)) : v]));
      await api(`/api/bots/${bot.id}`, { method: "PATCH", json: { ...f, budgetUsd: Number(f.budgetUsd), maxPositionUsd: Number(f.maxPositionUsd), maxDailySpendUsd: Number(f.maxDailySpendUsd),
        maxDailyLossUsd: Number(f.maxDailyLossUsd), minLiquidityUsd: Number(f.minLiquidityUsd), maxSlippageBps: Number(f.maxSlippageBps), params } });
      toast("Configuration saved", "up"); onSaved();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const n = (k: keyof typeof f, label: string) => <Input label={label} type="number" step="any" disabled={locked} value={f[k] as any} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
  return (
    <Card title="Configuration" icon={<Settings2 className="size-4 text-accent-2" />}>
      {locked && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Pause the bot to edit its configuration.</p>}
      <div className="space-y-4">
        <Input label="Name" disabled={locked} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        {strategy?.params?.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {strategy.params.map((d: any) => d.type === "boolean"
              ? <div key={d.key} className="flex items-end pb-2"><Toggle disabled={locked} checked={!!p[d.key]} onChange={(v) => setP({ ...p, [d.key]: v })} label={d.label} /></div>
              : d.type === "select"
                ? <Select key={d.key} label={d.label} disabled={locked} value={p[d.key] ?? ""} onChange={(e) => setP({ ...p, [d.key]: e.target.value })}>{d.options.map((o: string) => <option key={o} value={o}>{o}</option>)}</Select>
                : <Input key={d.key} label={d.label} disabled={locked} type={d.type === "number" ? "number" : "text"} step="any" value={p[d.key] ?? ""} onChange={(e) => setP({ ...p, [d.key]: e.target.value })} />)}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          {n("budgetUsd", "Budget ($) · 0 = no limit")}{n("maxPositionUsd", "Max position ($) · 0 = no limit")}{n("maxDailySpendUsd", "Max daily spend ($) · 0 = no limit")}{n("maxDailyLossUsd", "Max daily loss ($) · 0 = no limit")}
          {n("minLiquidityUsd", "Min liquidity ($)")}{n("maxSlippageBps", "Max slippage (bps)")}
          <Select label="Check every" disabled={locked} value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })}>{["every_15s", "every_1m", "every_5m", "every_15m", "every_1h"].map((s) => <option key={s} value={s}>{s.replace("every_", "")}</option>)}</Select>
        </div>
        <Toggle disabled={locked} checked={f.approvalRequired} onChange={(v) => setF({ ...f, approvalRequired: v })} label="Require my approval for each trade" />
        <div className="flex justify-end"><Button variant="primary" disabled={locked} loading={busy} onClick={save}>Save configuration</Button></div>
      </div>
    </Card>
  );
}

function Backtest({ bot, assets }: { bot: any; assets: any[] }) {
  const toast = useToast();
  const [opts, setOpts] = useState({ assetId: assets[0]?.id ?? "", timeframe: "1h", feeBps: 30, slippageBps: 10, startCash: 10000 });
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { const r = await api(`/api/bots/${bot.id}/backtest`, { method: "POST", json: { ...opts, feeBps: Number(opts.feeBps), slippageBps: Number(opts.slippageBps), startCash: Number(opts.startCash) } }); setRes(r.result); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <Card title="Backtest" icon={<FlaskConical className="size-4 text-accent-2" />}>
      <div className="grid gap-3 sm:grid-cols-6">
        <Select label="Asset" value={opts.assetId} onChange={(e) => setOpts({ ...opts, assetId: e.target.value })} className="sm:col-span-2">
          {assets.length === 0 && <option value="">No assets</option>}
          {assets.map((a: any) => <option key={a.id} value={a.id}>{a.symbol} · {a.venue}</option>)}
        </Select>
        <Select label="Timeframe" value={opts.timeframe} onChange={(e) => setOpts({ ...opts, timeframe: e.target.value })}><option value="1h">1 hour</option><option value="1d">1 day</option></Select>
        <Input label="Fees (bps)" type="number" value={opts.feeBps} onChange={(e) => setOpts({ ...opts, feeBps: e.target.value as any })} />
        <Input label="Slippage (bps)" type="number" value={opts.slippageBps} onChange={(e) => setOpts({ ...opts, slippageBps: e.target.value as any })} />
        <Input label="Starting cash ($)" type="number" value={opts.startCash} onChange={(e) => setOpts({ ...opts, startCash: e.target.value as any })} />
      </div>
      <div className="mt-3 flex justify-end"><Button variant="primary" loading={busy} onClick={run} disabled={!opts.assetId}><LineChart className="size-4" /> Run backtest</Button></div>
      {res && (
        <div className="mt-5 space-y-4">
          {res.dataWarning && <div className="flex gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn"><AlertTriangle className="mt-px size-3.5 shrink-0" />{res.dataWarning}</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat label="Return" value={<span className={tone(res.returnPct)}>{pct(res.returnPct)}</span>} />
            <Stat label="Buy & hold" value={<span className={tone(res.buyHoldPct)}>{pct(res.buyHoldPct)}</span>} />
            <Stat label="End value" value={usd(res.endValue)} />
            <Stat label="Max drawdown" value={<span className="text-down">{pct(-res.maxDrawdownPct)}</span>} />
            <Stat label="Trades" value={res.tradeCount} />
            <Stat label="Win rate" value={res.winRate == null ? "—" : `${res.winRate.toFixed(0)}%`} />
          </div>
          <EquityCurve points={res.equity} start={res.startValue} />
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel text-left text-faint"><tr><th className="py-1.5 font-medium">Time</th><th className="font-medium">Side</th><th className="text-right font-medium">Price</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">P&L</th></tr></thead>
              <tbody>{res.trades.slice().reverse().map((t: any, i: number) => (
                <tr key={i} className="border-t border-line/50"><td className="py-1 text-muted">{new Date(t.ts).toLocaleString()}</td><td className={t.side === "buy" ? "text-up" : "text-down"}>{t.side}</td>
                  <td className="num text-right">{price(t.price)}</td><td className="num text-right">{qty(t.qty)}</td><td className={cx("num text-right", tone(t.pnl))}>{t.pnl != null ? usd(t.pnl, { sign: true }) : ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">Assumes {res.assumptions.feeBps} bps fees and {res.assumptions.slippageBps} bps slippage per trade over {res.bars} bars. {res.disclaimer}</p>
        </div>
      )}
      {!res && <Badge className="mt-3">Uses stored price history; results are illustrative and never guarantee future performance.</Badge>}
    </Card>
  );
}

function EquityCurve({ points, start }: { points: { ts: number; value: number }[]; start: number }) {
  const W = 800, H = 200;
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.value), min = Math.min(...vals, start), max = Math.max(...vals, start), span = max - min || 1;
    const x = (i: number) => (i / (points.length - 1)) * W, y = (v: number) => H - 8 - ((v - min) / span) * (H - 16);
    return { d: points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" "), base: y(start), up: vals[vals.length - 1] >= start };
  }, [points, start]);
  if (!path) return null;
  const c = path.up ? "var(--up)" : "var(--down)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full rounded-xl border border-line bg-bg-2/50" preserveAspectRatio="none">
      <line x1="0" x2={W} y1={path.base} y2={path.base} stroke="var(--line-2)" strokeDasharray="4 4" />
      <path d={`${path.d} L${W},${H} L0,${H} Z`} fill={c} opacity=".08" />
      <path d={path.d} fill="none" stroke={c} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
