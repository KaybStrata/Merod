"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Cpu, Power, Brain, Layers, Plus, Briefcase, ListOrdered, Star, CalendarClock, Bot, ShieldCheck, BarChart3, Settings2, Loader2, CheckCircle2, Clock,
  Play, ListChecks, X, MoreVertical, RefreshCw, Trash2, Sparkles, FlaskConical, Search,
} from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useShell, useRealtime } from "@/components/shell/context";
import { MimicTabs } from "@/components/MimicTabs";
import { TimeRangePicker, range, barsQuery, type Range } from "@/components/TimeRange";
import { AssetIcon, Badge, Button, Empty, Input, Modal, Pills, Select, Sparkline, cx, useToast } from "@/components/ui";
import { ago, price as fmtPrice, usd } from "@/lib/format";

const pct = (x: number | null | undefined, d = 2) => (x == null || !isFinite(Number(x)) ? "—" : `${Number(x) >= 0 ? "+" : ""}${Number(x).toFixed(d)}%`);
const LABEL: Record<string, string> = { merod: "Merod traders", thirdParty: "Outside traders", modo: "Modo", backtest: "Backtest", momentum: "Momentum" };

/** A dark panel with a title row, matching the workspace look. */
function Panel({ icon: Icon, title, sub, action, children, className }: { icon: any; title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-2xl border border-line bg-panel/80 p-3", className)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 shrink-0 text-accent-2" />{title}</h3>
          {sub && <p className="mt-0.5 text-[11px] text-faint">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export default function AutoTradingWorkspace() {
  const { user } = useShell();
  const toast = useToast();
  const owner = user.role === "super_admin";
  const { data, refresh, setData } = useApi<any>(owner ? "/api/auto/workspace" : null, { refreshMs: 10_000 }) as any;
  useRealtime((e: any) => { if (e.type === "auto" || e.type === "order") refresh(); });
  const [busy, setBusy] = useState<string | null>(null);
  const [newStrategy, setNewStrategy] = useState<null | { assetIds?: string[] }>(null);
  const [detail, setDetail] = useState<any>(null);
  const [showSettings, setShowSettings] = useState(false);
  if (!owner) return <Empty icon={<Cpu className="size-6" />} title="Auto trading is for the platform owner">Ask the owner if you'd like access.</Empty>;

  async function act(body: any, msg?: string) {
    setBusy(body.action ?? "x");
    try { const r = await api("/api/auto/workspace", { method: "POST", json: body }); setData?.(r.workspace) ?? refresh(); if (msg) toast(msg, "up"); return r; }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function toggle() {
    setBusy("switch");
    try { await api("/api/auto", { method: "PATCH", json: { enabled: !data?.settings?.enabled } }); await refresh(); toast(data?.settings?.enabled ? "Auto trading is OFF" : "Auto trading is ON", "up"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  const s = data?.settings;
  const on = !!s?.enabled;
  const activeStrategies = (data?.strategies ?? []).filter((x: any) => x.enabled);
  const included = new Set<string>([...(s?.asset_ids ?? []), ...activeStrategies.flatMap((x: any) => x.asset_ids)]);

  return (
    <div className="space-y-3 pb-24">
      <MimicTabs />
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Cpu className="size-6 text-accent-2" /> Merod Multi-Screen Auto Trading Workspace</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Run several trading strategies at once across stocks and crypto. Pick the assets, and Merod trades them at the same time using its five data points (Merod traders, outside traders, Modo, backtests, momentum), testing every idea theoretically before real money moves.</p>
        </div>
        <button onClick={toggle} disabled={!data || busy === "switch"} className={cx("flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors", on ? "border-up/50 bg-up/10" : "border-line bg-panel")}>
          {busy === "switch" ? <Loader2 className="size-6 animate-spin text-faint" /> : <Power className={cx("size-6", on ? "text-up" : "text-faint")} />}
          <span>
            <span className="block text-sm font-semibold">Auto Trading: {on ? "ON" : "OFF"}</span>
            <span className="block text-[11px] text-muted">{activeStrategies.length} active task{activeStrategies.length === 1 ? "" : "s"} · Trading {included.size} asset{included.size === 1 ? "" : "s"}</span>
          </span>
          <span className={cx("relative ml-2 h-6 w-11 rounded-full transition-colors", on ? "bg-up" : "bg-panel-2")}><span className={cx("absolute top-0.5 size-5 rounded-full bg-white transition-all", on ? "left-[22px]" : "left-0.5")} /></span>
        </button>
      </div>

      <ModoAutopilot data={data} onChange={refresh} />

      {/* Strategy bar */}
      <div className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-line bg-panel/80 p-2">
        <span className="flex shrink-0 items-center gap-2 px-2 text-sm font-semibold"><Layers className="size-4 text-accent-2" /> Active Strategies ({activeStrategies.length})</span>
        {(data?.strategies ?? []).map((st: any) => (
          <div key={st.id} className={cx("group flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5", st.enabled ? "border-accent/40 bg-accent-soft" : "border-line opacity-60")}>
            <button onClick={() => act({ action: "strategy.update", id: st.id, enabled: !st.enabled }, st.enabled ? `Paused ${st.name}` : `Resumed ${st.name}`)} title={st.enabled ? "Pause" : "Resume"}
              className={cx("size-2 rounded-full", st.enabled ? (on ? "bg-up pulse-dot" : "bg-warn") : "bg-faint")} />
            <span className="text-left leading-tight">
              <span className="block text-xs font-semibold">{st.name}</span>
              <span className="block max-w-[180px] truncate text-[10px] text-muted">{st.label} · {st.assets.length} asset{st.assets.length === 1 ? "" : "s"} ({st.assets.slice(0, 3).map((a: any) => a.symbol).join(", ")}{st.assets.length > 3 ? ", …" : ""})</span>
            </span>
            <button onClick={() => confirm(`Delete strategy “${st.name}”? Open trades stay open.`) && act({ action: "strategy.delete", id: st.id }, "Strategy deleted")} className="hidden text-faint hover:text-down group-hover:block" title="Delete"><X className="size-3.5" /></button>
          </div>
        ))}
        {data && !data.strategies.length && <span className="shrink-0 px-2 text-xs text-faint">No strategies yet. Without one, Merod picks assets itself.</span>}
        <Button size="sm" className="ml-auto shrink-0" onClick={() => setNewStrategy({})}><Plus className="size-3.5" /> New Strategy</Button>
      </div>

      {/* Chart tiles */}
      {data?.tiles?.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.tiles.slice(0, 4).map((t: any) => <ChartTile key={t.id} t={t} on={on} onRemove={() => act({ action: "asset", assetId: t.id, include: false }, `${t.symbol} removed from hand-picked assets`)} />)}
        </div>
      ) : data && (
        <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-muted">Pick assets for auto trading with <b className="text-text">New Strategy</b>, the watchlist checkboxes, or <b className="text-text">Multi-Select Assets</b> below. Their live charts appear here.</div>
      )}

      {/* Positions · Queue · Watchlists */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-5" icon={Briefcase} title={`Active Positions (${data?.positions?.length ?? 0})`} sub="Real trades auto trading holds right now, at live prices.">
          {!data?.positions?.length ? <p className="py-6 text-center text-xs text-faint">{data?.theory?.trades < (s?.min_theory_trades ?? 5) ? "No real positions yet: auto trading is still building its theoretical record." : "No open auto positions."}</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-faint"><tr><th className="py-1">Asset</th><th>Side</th><th className="text-right">Size</th><th className="text-right">Entry</th><th className="text-right">Current</th><th className="text-right">P&L (ROI)</th></tr></thead>
              <tbody>{data.positions.map((p: any) => (
                <tr key={p.id} className="border-t border-line/60">
                  <td className="py-1.5"><span className="flex items-center gap-1.5 font-semibold"><AssetIcon symbol={p.symbol} size={18} />{p.symbol} <span className="font-normal text-faint">{p.asset_class === "crypto" ? "Crypto" : "Stock"}</span></span></td>
                  <td><Badge tone="up">Long</Badge></td>
                  <td className="num text-right">{Number(p.qty).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                  <td className="num text-right">{fmtPrice(Number(p.entry))}</td>
                  <td className="num text-right">{p.current != null ? fmtPrice(p.current) : "—"}</td>
                  <td className={cx("num text-right", Number(p.pnl) >= 0 ? "text-up" : "text-down")}>{p.pnl != null ? `${p.pnl >= 0 ? "+" : ""}${usd(p.pnl)} (${pct(p.roi)})` : "—"}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Panel>

        <Panel className="xl:col-span-4" icon={ListOrdered} title="Concurrent Trade Queue (Live)" sub="Latest decisions across all strategies. Tap one for Modo's explanation.">
          {!data?.queue?.length ? <p className="py-6 text-center text-xs text-faint">{on ? "Watching. Merod acts only when the data points agree." : "Turn auto trading on to start."}</p> : (
            <ol className="space-y-1">{data.queue.slice(0, 7).map((t: any, i: number) => (
              <li key={t.id}><button onClick={() => setDetail(t)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-panel-2">
                <span className="w-4 text-faint">{i + 1}</span>
                <span className="flex w-20 items-center gap-1.5 font-semibold"><AssetIcon symbol={t.symbol} size={16} />{t.symbol}</span>
                <span className="flex-1 truncate text-muted">{t.origin === "modo" ? "Modo · " : ""}{t.mode === "real" ? `Buy ${t.notional_usd ? usd(Number(t.notional_usd)) : ""}` : "Theoretical buy"}{t.strategy ? ` · ${t.strategy}` : ""}</span>
                <QueueState t={t} />
              </button></li>))}</ol>
          )}
        </Panel>

        <Panel className="xl:col-span-3" icon={Star} title="Watchlists (Multi-Select)" sub="Tick assets to let auto trading trade them.">
          <Watchlists data={data} included={included} busy={busy === "asset"} onToggle={(id, inc) => act({ action: "asset", assetId: id, include: inc })} />
        </Panel>
      </div>

      {/* Scheduler · Bots · Approvals · Risk */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <TaskScheduler data={data} act={act} busy={busy} />
        <Panel icon={Bot} title={`Bot Status (${data?.bots?.length ?? 0})`} sub="Strategies and bots running on Merod's servers.">
          {!data?.bots?.length ? <p className="py-4 text-center text-xs text-faint">No strategies or bots yet.</p> : (
            <ul className="space-y-1 text-xs">{data.bots.map((b: any) => (
              <li key={b.id} className="flex items-center gap-2">
                <span className={cx("size-1.5 rounded-full", b.status === "Running" ? "bg-up" : b.status === "Error" || b.status === "Halted" ? "bg-down" : "bg-warn")} />
                {b.kind === "bot" ? <Link href={`/bots/${b.id}`} className="flex-1 truncate hover:text-accent-2">{b.name}</Link> : <span className="flex-1 truncate">{b.name}</span>}
                <Badge tone={b.status === "Running" ? "up" : "neutral"}>{b.status}</Badge>
                <span className="w-14 text-right text-faint">{b.assets} asset{b.assets === 1 ? "" : "s"}</span>
              </li>))}</ul>
          )}
        </Panel>
        <Approvals data={data} refresh={refresh} />
        <Panel icon={BarChart3} title="Portfolio & Risk" sub="Paper account, from real prices and recorded snapshots.">
          <RiskBox r={data?.risk} />
        </Panel>
      </div>

      {/* Settings & learning */}
      <div className="rounded-2xl border border-line bg-panel/80">
        <button onClick={() => setShowSettings(!showSettings)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold">
          <span className="flex items-center gap-2"><Settings2 className="size-4 text-accent-2" /> Settings, theoretical record & what it learned</span>
          <span className="text-xs font-normal text-muted">{data?.theory ? `Theoretical ${data.theory.wins}/${data.theory.trades} wins · real ${data.realRecord.wins}/${data.realRecord.trades}` : ""}</span>
        </button>
        {showSettings && s && (
          <div className="grid grid-cols-1 gap-3 border-t border-line p-3 lg:grid-cols-3">
            <div>
              <p className="mb-2 text-xs text-muted">How much each data point counts. Weights move toward the ones that called theoretical and real trades right.</p>
              {Object.entries(s.weights).map(([k, v]: any) => (
                <div key={k} className="mb-1.5 flex items-center gap-2 text-xs"><span className="w-28 text-muted">{LABEL[k] ?? k}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-panel-2"><div className="h-1.5 rounded-full bg-accent-2" style={{ width: `${Math.min(100, (Number(v) / 2) * 100)}%` }} /></div>
                  <span className="num w-10 text-right">×{Number(v).toFixed(2)}</span></div>))}
            </div>
            <div className="lg:col-span-2"><SettingsForm s={s} onSaved={refresh} /></div>
          </div>
        )}
      </div>

      <p className="flex gap-1 text-[11px] text-faint"><ShieldCheck className="size-3 shrink-0" /> Every real order goes through Merod's risk checks; real-money auto trades also need the platform's “automated real money” setting, otherwise they wait in Execution Approvals. Real market prices only. Past results don't guarantee future results.</p>

      <CommandBar busy={busy} onPlan={(text) => act({ action: "plan", text }, "Strategy created")} onRun={() => act({ action: "run" }, "Ran all strategies")} onMulti={() => setNewStrategy({})} />

      <Modal open={!!newStrategy} onClose={() => setNewStrategy(null)} title="New strategy">
        {newStrategy && <StrategyForm kinds={data?.kinds ?? []} onCreate={async (b) => { const r = await act({ action: "strategy.create", ...b }, "Strategy started"); if (r) setNewStrategy(null); }} busy={busy === "strategy.create"} />}
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.symbol} · ${detail.mode === "real" ? "real" : "theoretical"} auto trade` : ""} wide>
        {detail && <TradeDetail t={detail} />}
      </Modal>
    </div>
  );
}

/* ───────────────────────── Pieces ───────────────────────── */
function ChartTile({ t, on, onRemove }: { t: any; on: boolean; onRemove: () => void }) {
  const [rng, setRng] = useState<Range>(range("6h"));
  const bars = useApi<any>(`/api/assets/${t.id}/bars?${barsQuery(rng.seconds)}`, { refreshMs: 30_000 });
  const closes = (bars.data?.bars ?? []).filter((b: any) => b.source !== "simulated").map((b: any) => Number(b.close));
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative rounded-2xl border border-line bg-panel/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/terminal/${t.id}`} className="flex min-w-0 items-center gap-2"><AssetIcon symbol={t.symbol} logo={t.logo_url} size={26} /><span className="truncate"><span className="font-semibold">{t.symbol}</span> <span className="text-xs text-faint">{t.name}</span></span></Link>
      </div>
      <div className="mt-1.5"><TimeRangePicker value={rng} onChange={setRng} size="sm" compact /></div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">{closes.length > 1 ? <Sparkline data={closes} width={220} height={70} className="h-[70px] w-full" /> : <div className="flex h-[70px] items-center text-[11px] text-faint">{bars.loading ? "Loading…" : "Real price history is still loading"}</div>}</div>
        <div className="text-right"><div className="num font-semibold">{t.live ? fmtPrice(Number(t.last_price)) : "—"}</div><div className={cx("num text-xs", Number(t.change_24h) >= 0 ? "text-up" : "text-down")}>{t.live ? pct(Number(t.change_24h)) : "no live price"}</div></div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
        <span className={cx("flex items-center gap-1 rounded-md border px-1.5 py-0.5", on ? "border-up/40 text-up" : "border-line text-muted")}><span className={cx("size-1.5 rounded-full", on ? "bg-up" : "bg-faint")} />Auto Trading</span>
        <span className="truncate rounded-md border border-line px-1.5 py-0.5 text-muted">{t.strategy}</span>
        <button onClick={() => setMenu(!menu)} className="ml-auto rounded p-0.5 text-faint hover:text-text"><MoreVertical className="size-3.5" /></button>
      </div>
      {menu && (
        <div className="absolute bottom-9 right-3 z-10 rounded-lg border border-line bg-panel p-1 text-xs shadow-lg">
          <Link href={`/terminal/${t.id}`} className="block rounded px-2 py-1 hover:bg-panel-2">Open full chart</Link>
          {t.strategy === "Hand-picked" && <button onClick={() => { setMenu(false); onRemove(); }} className="block w-full rounded px-2 py-1 text-left text-down hover:bg-panel-2">Stop auto trading it</button>}
        </div>
      )}
    </div>
  );
}

function QueueState({ t }: { t: any }) {
  const tone: Record<string, string> = { Executing: "text-accent-2", Holding: "text-up", Testing: "text-info", "Needs approval": "text-warn", Queued: "text-muted", Closed: Number(t.return_pct) > 0 ? "text-up" : "text-down", Failed: "text-down" };
  return (
    <span className={cx("flex w-28 items-center justify-end gap-1 text-[11px]", tone[t.state] ?? "text-muted")}>
      {t.state === "Executing" ? <RefreshCw className="size-3 animate-spin" /> : t.state === "Closed" ? <CheckCircle2 className="size-3" /> : t.state === "Testing" ? <FlaskConical className="size-3" /> : <Clock className="size-3" />}
      {t.state === "Closed" ? pct(Number(t.return_pct)) : t.state}
    </span>
  );
}

function Watchlists({ data, included, onToggle, busy }: { data: any; included: Set<string>; onToggle: (id: string, inc: boolean) => void; busy: boolean }) {
  const [tab, setTab] = useState<"mine" | "picks" | "volatility" | "hot">("mine");
  const list: any[] = data?.watchlists?.[tab] ?? [];
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {([["mine", "My Watchlist"], ["picks", "Top AI Picks"], ["volatility", "Volatility"], ["hot", "Crypto Hot"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-md border px-2 py-0.5 text-[11px]", tab === k ? "border-accent/50 bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>{l}</button>
        ))}
      </div>
      {!list.length ? <p className="py-4 text-center text-[11px] text-faint">{tab === "mine" ? "Your watchlist is empty (add from any asset page)." : tab === "picks" ? "No buy ideas from Modo in the last 24h." : "No assets with live prices yet."}</p> : (
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-faint"><tr><th className="w-6" /><th>Asset</th><th className="text-right">Price</th><th className="text-right">24h</th></tr></thead>
          <tbody>{list.slice(0, 9).map((a) => (
            <tr key={a.id} className="border-t border-line/60">
              <td className="py-1"><input type="checkbox" disabled={busy} checked={included.has(a.id)} onChange={(e) => onToggle(a.id, e.target.checked)} className="size-3.5 accent-[#38bdf8]" aria-label={`Auto trade ${a.symbol}`} /></td>
              <td><span className="flex items-center gap-1.5 font-semibold"><AssetIcon symbol={a.symbol} size={16} />{a.symbol}</span></td>
              <td className="num text-right">{fmtPrice(Number(a.last_price))}</td>
              <td className={cx("num text-right", Number(a.change_24h) >= 0 ? "text-up" : "text-down")}>{pct(Number(a.change_24h))}</td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  );
}

function TaskScheduler({ data, act, busy }: { data: any; act: (b: any, m?: string) => Promise<any>; busy: string | null }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", kind: "run", atTime: "09:30", days: "weekdays" });
  const KIND: Record<string, string> = { run: "Run all strategies", rebalance: "Rebalance & re-learn", take_profit_sweep: "Take-profit sweep", close_risky: "Close losing trades" };
  return (
    <Panel icon={CalendarClock} title="Task Scheduler" sub="Scheduled auto-trading tasks (US Eastern time)." action={<Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setAdding(!adding)}><Plus className="size-3.5" /> Add Task</Button>}>
      {adding && (
        <div className="mb-2 space-y-1.5 rounded-lg border border-line p-2 text-xs">
          <Input label="Name (optional)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Market open" />
          <Select label="Does" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <div className="grid grid-cols-2 gap-1.5">
            <Input label="At (ET)" type="time" value={f.atTime} onChange={(e) => setF({ ...f, atTime: e.target.value })} />
            <Select label="Days" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}><option value="weekdays">Weekdays</option><option value="daily">Every day</option></Select>
          </div>
          <Button size="sm" variant="primary" loading={busy === "task.save"} onClick={async () => { const r = await act({ action: "task.save", ...f, name: f.name || undefined }, "Task scheduled"); if (r) setAdding(false); }}>Save task</Button>
        </div>
      )}
      {!data?.tasks?.length ? <p className="py-4 text-center text-xs text-faint">No scheduled tasks. Add one, e.g. “Run all strategies” at 09:30 ET.</p> : (
        <ul className="space-y-1.5">{data.tasks.map((t: any) => (
          <li key={t.id} className="group flex items-center gap-2 text-xs">
            <button onClick={() => act({ action: "task.save", id: t.id, enabled: !t.enabled })} aria-label="Toggle task" className={cx("relative h-4 w-7 shrink-0 rounded-full transition-colors", t.enabled ? "bg-up" : "bg-panel-2")}>
              <span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", t.enabled ? "left-[14px]" : "left-0.5")} /></button>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.name}</span><span className="block truncate text-[10px] text-faint">{KIND[t.kind]} at {t.at_time} ET{t.last_result ? ` · last: ${t.last_result}` : ""}</span></span>
            <Badge>{t.days === "daily" ? "Daily" : "Weekdays"}</Badge>
            <button onClick={() => act({ action: "task.run", id: t.id }, "Task ran")} title="Run now" className="hidden text-faint hover:text-text group-hover:block"><Play className="size-3.5" /></button>
            <button onClick={() => act({ action: "task.delete", id: t.id }, "Task deleted")} title="Delete" className="hidden text-faint hover:text-down group-hover:block"><Trash2 className="size-3.5" /></button>
          </li>))}</ul>
      )}
    </Panel>
  );
}

function Approvals({ data, refresh }: { data: any; refresh: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function go(id: string, action: "approve" | "cancel") {
    setBusy(id);
    try { await api(`/api/orders/${id}`, { method: "POST", json: { action } }); toast(action === "approve" ? "Approved" : "Rejected", "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  return (
    <Panel icon={ShieldCheck} title="Execution Approvals" sub="Orders waiting for you (e.g. real-money auto trades).">
      {!data?.approvals?.length ? <p className="py-4 text-center text-xs text-faint">Nothing waiting for approval.</p> : (
        <ul className="space-y-1.5">{data.approvals.map((o: any) => (
          <li key={o.id} className="rounded-lg border border-line p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0"><b className={o.side === "buy" ? "text-up" : "text-down"}>{o.side.toUpperCase()}</b> {o.symbol} {o.notional_usd ? usd(Number(o.notional_usd)) : o.quantity ? `${Number(o.quantity)} units` : ""}
                <span className="block truncate text-[10px] text-faint">{o.source} · {o.status_reason ?? "needs your approval"} · {ago(o.created_at)}</span></span>
              <span className="flex shrink-0 gap-1">
                <Button size="sm" variant="primary" loading={busy === o.id} onClick={() => go(o.id, "approve")}>Approve</Button>
                <Button size="sm" onClick={() => go(o.id, "cancel")}>Reject</Button>
              </span>
            </div>
          </li>))}</ul>
      )}
    </Panel>
  );
}

function RiskBox({ r }: { r: any }) {
  if (!r) return <p className="text-xs text-faint">Loading…</p>;
  const row = (k: string, v: React.ReactNode, tone?: string) => <div className="flex justify-between text-xs"><span className="text-muted">{k}</span><span className={cx("num", tone)}>{v}</span></div>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between"><span className="text-xs text-muted">Total Equity</span><span><span className="num text-lg font-semibold">{usd(r.equity)}</span> {r.change24hPct != null && <span className={cx("num text-xs", r.change24hPct >= 0 ? "text-up" : "text-down")}>{pct(r.change24hPct)} (24h)</span>}</span></div>
      <div className="grid grid-cols-3 gap-1 text-center text-[10px] text-muted">
        <div><div>Realized P&L</div><div className={cx("num text-xs", r.realized >= 0 ? "text-up" : "text-down")}>{usd(r.realized, { sign: true })}</div></div>
        <div><div>Unrealized P&L</div><div className={cx("num text-xs", r.unrealized >= 0 ? "text-up" : "text-down")}>{usd(r.unrealized, { sign: true })}</div></div>
        <div><div>Total P&L</div><div className={cx("num text-xs", r.total >= 0 ? "text-up" : "text-down")}>{usd(r.total, { sign: true })}</div></div>
      </div>
      <div><div className="flex justify-between text-xs"><span className="text-muted">Exposure</span><span className="num">{r.exposurePct.toFixed(1)}%</span></div>
        <div className="mt-0.5 h-1.5 rounded-full bg-panel-2"><div className="h-1.5 rounded-full bg-accent-2" style={{ width: `${Math.min(100, r.exposurePct)}%` }} /></div></div>
      {row("Max drawdown (24h)", r.maxDrawdown24hPct != null ? `-${r.maxDrawdown24hPct.toFixed(2)}%` : "—", r.maxDrawdown24hPct ? "text-down" : undefined)}
      {row("Risk (VaR, 95%, 1 day)", r.var95Pct != null ? `${r.var95Pct.toFixed(2)}%` : "needs 5+ days of history")}
      {row("Open auto positions", r.openPositions)}
      {row("Assets trading", r.assetsTrading)}
      {r.unpriced > 0 && <p className="text-[10px] text-faint">{r.unpriced} holding{r.unpriced === 1 ? "" : "s"} without a live price (not counted).</p>}
    </div>
  );
}

function CommandBar({ busy, onPlan, onRun, onMulti }: { busy: string | null; onPlan: (t: string) => Promise<any>; onRun: () => void; onMulti: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel/90 p-2">
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && text.trim()) { if (await onPlan(text)) setText(""); } }}
        placeholder="Tell Merod what to trade or set up a new multi-task plan… e.g. “trade NVDA, TSLA and SOL with momentum”" className="h-10 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-sm outline-none placeholder:text-faint" />
      <Button onClick={onMulti}><ListChecks className="size-4" /> Multi-Select Assets</Button>
      <Button variant="primary" loading={busy === "plan" || busy === "run"} onClick={async () => { if (text.trim()) { if (await onPlan(text)) setText(""); } else onRun(); }}><Play className="size-4" /> {text.trim() ? "Create & Run" : "Run Task"}</Button>
    </div>
  );
}

function StrategyForm({ kinds, onCreate, busy }: { kinds: any[]; onCreate: (b: any) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("multi_asset");
  const [tf, setTf] = useState("5m");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<any[]>([]);
  const search = useApi<any>(`/api/assets?limit=12${term ? `&q=${encodeURIComponent(term)}` : "&sort=volume"}`);
  const results: any[] = (search.data?.assets ?? []).filter((a: any) => !(a.risk_flags ?? []).includes("demo_data"));
  const k = kinds.find((x) => x.id === kind);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={k?.label ?? "My strategy"} />
        <Select label="Chart timeframe" value={tf} onChange={(e) => setTf(e.target.value)}><option value="5m">5m</option><option value="1h">1h</option><option value="1d">1d</option></Select>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted">Strategy type</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{kinds.map((x) => (
          <button key={x.id} onClick={() => setKind(x.id)} className={cx("rounded-lg border p-2 text-left text-xs", kind === x.id ? "border-accent/60 bg-accent-soft" : "border-line hover:border-accent/30")}>
            <b className="block">{x.label}</b><span className="text-muted">{x.note}</span></button>))}</div>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted">Assets ({picked.length} selected)</div>
        {picked.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{picked.map((a) => <button key={a.id} onClick={() => setPicked(picked.filter((p) => p.id !== a.id))} className="flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs">{a.symbol}<X className="size-3" /></button>)}</div>}
        <label className="flex items-center gap-2 rounded-xl border border-line bg-bg-2 px-3"><Search className="size-4 text-faint" /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search stocks and coins" className="h-9 flex-1 bg-transparent text-sm outline-none" /></label>
        <div className="mt-1 max-h-48 overflow-y-auto">{results.map((a) => {
          const on = picked.some((p) => p.id === a.id);
          return (
            <button key={a.id} onClick={() => setPicked(on ? picked.filter((p) => p.id !== a.id) : [...picked, a])} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-panel-2">
              <input type="checkbox" readOnly checked={on} className="size-3.5 accent-[#38bdf8]" /><AssetIcon symbol={a.symbol} size={16} /><b>{a.symbol}</b><span className="truncate text-muted">{a.name}</span>
              <span className="ml-auto text-faint">{a.price_source && a.price_source !== "simulated" ? fmtPrice(Number(a.last_price)) : "no live price"}</span>
            </button>);
        })}</div>
      </div>
      <div className="flex justify-end"><Button variant="primary" loading={busy} disabled={!picked.length} onClick={() => onCreate({ name: name || undefined, kind, timeframe: tf, assetIds: picked.map((p) => p.id) })}><Sparkles className="size-4" /> Start strategy</Button></div>
    </div>
  );
}

function TradeDetail({ t }: { t: any }) {
  const lines = String(t.explain_before).split("\n");
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2 text-xs"><Badge tone={t.mode === "real" ? "accent" : "info"}>{t.mode === "real" ? "real" : "theoretical"}</Badge><Badge>{t.state}</Badge>{t.strategy && <Badge>{t.strategy}</Badge>}<span className="text-muted">{Math.round(Number(t.confidence) * 100)}% confidence · {ago(t.created_at)}</span></div>
      <div className="rounded-xl border border-line p-3"><div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint"><Brain className="size-3.5" /> Modo · Before</div>
        <p className="text-xs">{lines[0]}</p><ul className="mt-1 space-y-0.5 text-[11px] text-muted">{lines.slice(1).map((l, i) => <li key={i}>{l}</li>)}</ul></div>
      <div className="rounded-xl border border-line p-3"><div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint"><Clock className="size-3.5" /> Modo · During</div><p className="text-xs text-muted">{t.explain_during ?? "—"}</p></div>
      <div className="rounded-xl border border-line p-3"><div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint"><CheckCircle2 className="size-3.5" /> Modo · After</div><p className="text-xs text-muted">{t.explain_after ?? (t.status === "open" ? "Still open." : "—")}</p></div>
    </div>
  );
}

function SettingsForm({ s, onSaved }: { s: any; onSaved: () => void }) {
  const toast = useToast();
  const accounts = useApi<any>("/api/wallet/accounts");
  const accts = useMemo(() => (accounts.data?.accounts ?? []).filter((a: any) => a.status === "active" && a.kind !== "wallet" && a.kind !== "paper"), [accounts.data]);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({ accountId: s.account_id ?? "", markets: s.markets, tradeUsd: Number(s.trade_usd), maxDailyUsd: Number(s.max_daily_usd), maxOpen: Number(s.max_open),
      minConfidence: Math.round(Number(s.min_confidence) * 100), minTheoryTrades: Number(s.min_theory_trades), minTheoryWinRate: Math.round(Number(s.min_theory_win_rate) * 100),
      takeProfitPct: Number(s.take_profit_pct), stopLossPct: Number(s.stop_loss_pct) });
  }, [s.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    try {
      await api("/api/auto", { method: "PATCH", json: { accountId: f.accountId || null, markets: f.markets, tradeUsd: f.tradeUsd, maxDailyUsd: f.maxDailyUsd, maxOpen: f.maxOpen,
        minConfidence: f.minConfidence / 100, minTheoryTrades: f.minTheoryTrades, minTheoryWinRate: f.minTheoryWinRate / 100, takeProfitPct: f.takeProfitPct, stopLossPct: f.stopLossPct } });
      toast("Settings saved", "up"); onSaved();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Select label="Trade in account" value={f.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">Paper account</option>{accts.map((a: any) => <option key={a.id} value={a.id}>{a.label} (real)</option>)}
        </Select>
        <div><div className="mb-1 text-xs text-muted">Markets (when no assets are picked)</div><Pills size="sm" value={f.markets} onChange={(v) => set("markets", v)} options={[{ value: "both", label: "Both" }, { value: "crypto", label: "Crypto" }, { value: "stocks", label: "Stocks" }]} /></div>
        <Input label="$ per trade" type="number" min={1} value={f.tradeUsd} onChange={(e) => set("tradeUsd", Number(e.target.value))} />
        <Input label="Max $ per day" type="number" min={1} value={f.maxDailyUsd} onChange={(e) => set("maxDailyUsd", Number(e.target.value))} />
        <Input label="Max open trades" type="number" min={1} value={f.maxOpen} onChange={(e) => set("maxOpen", Number(e.target.value))} />
        <Input label="Min confidence (%)" type="number" min={30} max={95} value={f.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} />
        <Input label="Take profit (%)" type="number" min={0.1} value={f.takeProfitPct} onChange={(e) => set("takeProfitPct", Number(e.target.value))} />
        <Input label="Stop loss (%)" type="number" min={0.1} value={f.stopLossPct} onChange={(e) => set("stopLossPct", Number(e.target.value))} />
        <Input label="Theoretical trades before real" type="number" min={0} value={f.minTheoryTrades} onChange={(e) => set("minTheoryTrades", Number(e.target.value))} />
        <Input label="Theoretical win rate needed (%)" type="number" min={0} max={100} value={f.minTheoryWinRate} onChange={(e) => set("minTheoryWinRate", Number(e.target.value))} />
      </div>
      <div className="mt-2 flex justify-end"><Button variant="primary" loading={busy} onClick={save}>Save settings</Button></div>
    </div>
  );
}

/** Modo Autopilot: Modo scans news + markets and trades on its own, learning from every result. */
function ModoAutopilot({ data, onChange }: { data: any; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const s = data?.settings;
  const on = !!s?.modo_autopilot;
  const thoughts: any[] = s?.modo_thoughts ?? [];
  const m = data?.modo;
  async function patch(body: any, msg?: string) {
    setBusy(true);
    try { await api("/api/auto", { method: "PATCH", json: body }); onChange(); if (msg) toast(msg, "up"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <section className={cx("rounded-2xl border p-3", on ? "border-accent/50 bg-accent-soft/40" : "border-line bg-panel/80")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-accent-2" /> Modo Autopilot {on && <Badge tone="up">ON</Badge>}</h2>
          <p className="mt-0.5 text-xs text-muted">Modo scans news and articles, reads what other traders are doing (traders with profitable recent trades count more), checks momentum and your positions, and places its own trades: no limit on how many. It sells when it changes its mind, at take-profit / stop-loss, or after 24h, and trains itself on every profitable and unprofitable result.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select aria-label="Minimum confidence" value={String(Math.round(Number(s?.modo_min_confidence ?? 0.5) * 100))} disabled={!s || busy} onChange={(e) => patch({ modoMinConfidence: Number(e.target.value) / 100 }, "Saved")}>
            {[40, 50, 60, 70, 80].map((v) => <option key={v} value={v}>Trade at {v}%+ confidence</option>)}
          </Select>
          <button onClick={() => patch({ modoAutopilot: !on }, on ? "Modo Autopilot is OFF" : "Modo Autopilot is ON: Modo is thinking…")} disabled={!s || busy} aria-label="Modo Autopilot switch"
            className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-up" : "bg-panel-2")}>
            {busy ? <Loader2 className="absolute left-3.5 top-1.5 size-4 animate-spin text-white" /> : <span className={cx("absolute top-1 size-5 rounded-full bg-white transition-all", on ? "left-[26px]" : "left-1")} />}
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3">
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="rounded-lg border border-line bg-bg/40 p-2"><div className="text-faint">Modo trades</div><div className="num text-sm font-semibold">{m?.trades ?? 0}</div><div className="text-faint">{m?.open ?? 0} open</div></div>
          <div className="rounded-lg border border-line bg-bg/40 p-2"><div className="text-faint">Win rate</div><div className="num text-sm font-semibold">{m?.closed ? `${Math.round((m.wins / m.closed) * 100)}%` : "—"}</div><div className="text-faint">{m?.wins ?? 0}/{m?.closed ?? 0} closed</div></div>
          <div className="rounded-lg border border-line bg-bg/40 p-2"><div className="text-faint">Total return</div><div className={cx("num text-sm font-semibold", Number(m?.total_return) >= 0 ? "text-up" : "text-down")}>{m?.closed ? pct(Number(m.total_return)) : "—"}</div><div className="text-faint">{s?.modo_last_run_at ? `thought ${ago(s.modo_last_run_at)}` : "not run yet"}</div></div>
        </div>
        <div className="max-h-28 overflow-y-auto rounded-lg border border-line bg-bg/40 p-2 lg:col-span-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Modo's latest thinking</div>
          {thoughts.length === 0 ? <p className="text-[11px] text-faint">{on ? "Thinking… the first pass appears here within a minute." : "Turn it on to watch Modo scan the news and trade."}</p>
            : <ul className="space-y-0.5">{thoughts.slice(-10).map((t, i) => <li key={i} className={cx("text-[11px] leading-snug", t.kind === "idea" || t.kind === "news" ? "text-text" : t.kind === "warn" ? "text-warn" : "text-muted")}>• {t.text}</li>)}</ul>}
        </div>
      </div>
      <p className="mt-2 text-[10px] text-faint">Trades use the account and “$ per trade” from Settings below (paper by default). Real-money trades also need the real-money switches in Admin and still pass every risk check.</p>
    </section>
  );
}
