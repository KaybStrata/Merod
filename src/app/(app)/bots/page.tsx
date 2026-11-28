"use client";
import { SectionTabs } from "@/components/SectionTabs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Plus, OctagonX, PauseCircle, PlayCircle, Sparkles, Loader2, X, LayoutTemplate, Zap, Trash2, Pencil } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Card, Empty, Input, Modal, PaperBadge, Select, StatusPill, Toggle, cx, useToast } from "@/components/ui";
import { PlanCard } from "@/components/shell/PlanCard";
import { CopyBotsPanel } from "@/components/CopyBots";
import { useShell } from "@/components/shell/context";
import { usd, ago, tone } from "@/lib/format";
import { AutoModesBar } from "@/components/AutoModesBar";
import { BotTradingSwitch } from "@/components/BotTradingSwitch";

const SCHEDULES = [["every_15s", "15 seconds"], ["every_1m", "1 minute"], ["every_5m", "5 minutes"], ["every_15m", "15 minutes"], ["every_1h", "1 hour"]];

/** "AURORA, AI, SEXYANIMAL +18 more" instead of a wall of tickers. */
const fewSymbols = (syms?: string[] | null) => !syms?.length ? "" : syms.length <= 3 ? syms.join(", ") : `${syms.slice(0, 3).join(", ")} +${syms.length - 3} more`;

export default function BotsPage() {
  const { user } = useShell();
  const { data, refresh } = useApi<any>("/api/bots", { refreshMs: 10000 });
  const strategies = useApi<any>("/api/bots/strategies");
  const toast = useToast();
  const [creating, setCreating] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const agentsApi = useApi<any>("/api/agents", { refreshMs: 15000 });
  const bots: any[] = data?.bots ?? [];
  const agents: any[] = agentsApi.data?.agents ?? [];
  const running = bots.filter((b) => b.status === "running").length + agents.filter((a) => a.status === "running").length;
  const reload = () => { refresh(); agentsApi.refresh(); };
  async function bulk(kind: "bot" | "agent", id: string, status: "pause" | "resume" | "delete") {
    try { await api("/api/bots/bulk", { method: "POST", json: { targets: [{ kind, id }], status } }); toast(status === "delete" ? "Deleted" : status === "pause" ? "Turned off" : "Turned on", "up"); reload(); }
    catch (e: any) { toast(e.message, "down"); }
  }

  async function emergency(action: "stop" | "pause_all") {
    if (action === "stop" && !confirm("Emergency stop: halt ALL bots, cancel ALL open orders and engage your trading halt?")) return;
    setBusy(action);
    try {
      const r = await api("/api/bots/emergency", { method: "POST", json: { action } });
      toast(action === "stop" ? `Emergency stop engaged — ${r.cancelled} orders cancelled` : `Paused ${r.paused} bots`, action === "stop" ? "down" : "neutral");
      refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function control(id: string, action: string) {
    try { await api(`/api/bots/${id}`, { method: "POST", json: { action } }); refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }

  return (
    <div className="space-y-5">
      <SectionTabs tabs={[{ href: "/bots", label: "Bots", icon: Bot }, { href: "/agents", label: "Command center", icon: Sparkles }, { href: "/agents/fleets", label: "Fleet builder", icon: LayoutTemplate }, { href: "/shortcuts", label: "Shortcut buttons", icon: Zap }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Bots</h1>
          <p className="text-sm text-muted">Every bot in one list (AI bots included) — automated strategies running on Merod's servers that keep working when your browser is closed. Profit is never guaranteed.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotTradingSwitch />
          <Button onClick={() => emergency("pause_all")} loading={busy === "pause_all"}><PauseCircle className="size-4" /> Pause all</Button>
          <Button variant="danger" onClick={() => emergency("stop")} loading={busy === "stop"}><OctagonX className="size-4" /> Emergency stop</Button>
          <Button variant="outline" onClick={() => setPromptOpen(true)}><Sparkles className="size-4" /> Create with prompt</Button>
          <Button variant="primary" onClick={() => setCreating("dip_rebound_loop")}><Plus className="size-4" /> New bot</Button>
        </div>
      </div>
      {user.role === "super_admin" && <CopyBotsPanel compact />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Bots", bots.length + agents.length], ["Running", running], ["Paused", bots.filter((b) => b.status === "paused").length + agents.filter((a) => a.status === "paused").length], ["Total P&L", usd(bots.reduce((s, b) => s + Number(b.pnl_usd), 0) + agents.reduce((s, a) => s + Number(a.metrics?.pnl ?? 0), 0), { sign: true })]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-line bg-panel/80 p-4"><div className="text-xs text-muted">{k}</div><div className="num mt-1 text-xl font-semibold">{v}</div></div>
        ))}
      </div>

      <Card title="Auto bots" icon={<Zap className="size-4 text-accent-2" />}>
        <p className="mb-2 text-xs text-muted">Four helpers that run on their own for every bot and agent. Switch them per bot on its own page, attach them on the Map, or say “turn on auto gainer” in any prompt box.</p>
        <AutoModesBar />
      </Card>

      <Card title="Your bots" icon={<Bot className="size-4 text-accent-2" />} pad={false}>
        {bots.length + agents.length === 0 ? <div className="p-4"><Empty icon={<Bot className="size-6" />} title="No bots yet" action={<Button size="sm" variant="primary" onClick={() => setCreating("dip_rebound_loop")}>Create a bot</Button>}>Start from a template below, describe one in plain English, or configure it manually. New bots run in paper mode.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-faint"><tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Bot</th><th className="hidden px-3 font-medium xl:table-cell">Strategy</th><th className="px-2 font-medium">Assets</th><th className="px-2 font-medium">Status</th>
                <th className="px-2 text-right font-medium">P&L</th><th className="px-2 text-right font-medium" title="Trades today">Today</th><th className="hidden px-3 font-medium xl:table-cell">Last activity</th><th className="px-3" /></tr></thead>
              <tbody>
                {bots.map((b) => (
                  <tr key={b.id} className="border-b border-line/60 hover:bg-panel-2/40">
                    <td className="max-w-[220px] px-3 py-2.5"><Link href={`/bots/${b.id}`} className="line-clamp-2 font-medium hover:text-accent-2">{b.name}</Link><div className="mt-0.5 flex items-center gap-1"><Badge>bot</Badge><PaperBadge paper={b.is_paper} /></div>{b.last_log && <div className="mt-0.5 truncate text-[11px] text-faint xl:hidden" title={b.last_log.message}>{ago(b.last_log.created_at)} · {b.last_log.message}</div>}</td>
                    <td className="hidden px-3 text-muted xl:table-cell">{b.strategy_name}</td>
                    <td className="max-w-[160px] px-2 text-[12.5px]" title={(b.symbols ?? []).join(", ")}>{fewSymbols(b.symbols) || <span className="text-faint">{b.strategy_id === "watchlist_monitor" ? "Watchlist" : b.strategy_id === "meme_discovery" ? "New launches" : "—"}</span>}</td>
                    <td className="px-2"><StatusPill status={b.status} /></td>
                    <td className={cx("num whitespace-nowrap px-2 text-right", tone(b.pnl_usd))}>{usd(b.pnl_usd, { sign: true })}</td>
                    <td className="num px-2 text-right">{b.trades_today}</td>
                    <td className="hidden max-w-[260px] truncate px-3 text-xs text-muted xl:table-cell" title={b.last_log?.message}>{b.last_log ? `${ago(b.last_log.created_at)} · ${b.last_log.message}` : "—"}</td>
                    <td className="whitespace-nowrap px-3 text-right">
                      {b.status === "running" ? <Button size="sm" onClick={() => control(b.id, "pause")} title="Turn off (pause)"><PauseCircle className="size-3.5" /><span className="hidden xl:inline"> Pause</span></Button>
                        : ["draft", "paused", "stopped", "error", "halted"].includes(b.status) && <Button size="sm" variant="success" onClick={() => control(b.id, b.status === "paused" ? "resume" : "start")} title="Turn on"><PlayCircle className="size-3.5" /><span className="hidden xl:inline"> {b.status === "paused" ? "Resume" : "Start"}</span></Button>}
                      <Link href={`/bots/${b.id}?tab=config`} className="ml-1 inline-flex items-center gap-1 rounded-lg border border-line px-1.5 py-1 text-[12px] text-muted hover:text-text" title="Edit this bot" aria-label={`Edit ${b.name}`}><Pencil className="size-3.5" /></Link>
                      <button onClick={async () => { if (!confirm(`Delete “${b.name}”? It stops and is removed; its past trades stay in your history.`)) return; await bulk("bot", b.id, "delete"); }}
                        className="ml-1 inline-flex items-center gap-1 rounded-lg border border-line px-1.5 py-1 text-[12px] text-muted hover:border-down/50 hover:text-down" title="Delete this bot" aria-label={`Delete ${b.name}`}><Trash2 className="size-3.5" /></button>
                    </td>
                  </tr>
                ))}
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-line/60 hover:bg-panel-2/40">
                    <td className="max-w-[220px] px-3 py-2.5"><Link href={`/agents/${a.id}`} className="line-clamp-2 font-medium hover:text-accent-2">{a.name}</Link><div className="mt-0.5 flex items-center gap-1"><Badge>AI bot</Badge>{a.fleet_name && <span className="text-[11px] text-faint">{a.fleet_name}</span>}</div></td>
                    <td className="hidden px-3 text-muted xl:table-cell">{a.roleName}</td>
                    <td className="max-w-[160px] px-2 text-[12.5px]" title={(a.symbols ?? []).join(", ")}>{fewSymbols(a.symbols) || <span className="text-faint">—</span>}</td>
                    <td className="px-2"><StatusPill status={a.status} /></td>
                    <td className={cx("num whitespace-nowrap px-2 text-right", tone(a.metrics?.pnl ?? 0))}>{usd(a.metrics?.pnl ?? 0, { sign: true })}</td>
                    <td className="num px-2 text-right">{a.metrics?.trades24h ?? 0}</td>
                    <td className="hidden max-w-[260px] truncate px-3 text-xs text-muted xl:table-cell" title={a.last_event}>{a.last_event ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 text-right">
                      {a.status === "running" ? <Button size="sm" onClick={() => bulk("agent", a.id, "pause")} title="Turn off (pause)"><PauseCircle className="size-3.5" /><span className="hidden xl:inline"> Pause</span></Button>
                        : <Button size="sm" variant="success" onClick={() => bulk("agent", a.id, "resume")} title="Turn on"><PlayCircle className="size-3.5" /><span className="hidden xl:inline"> Start</span></Button>}
                      <Link href={`/agents/${a.id}`} className="ml-1 inline-flex items-center gap-1 rounded-lg border border-line px-1.5 py-1 text-[12px] text-muted hover:text-text" title="Edit this AI bot" aria-label={`Edit ${a.name}`}><Pencil className="size-3.5" /></Link>
                      <button onClick={() => { if (confirm(`Delete “${a.name}”? It stops, open orders are cancelled and it's archived; past trades stay in your history.`)) void bulk("agent", a.id, "delete"); }}
                        className="ml-1 inline-flex items-center gap-1 rounded-lg border border-line px-1.5 py-1 text-[12px] text-muted hover:border-down/50 hover:text-down" title="Delete this agent" aria-label={`Delete ${a.name}`}><Trash2 className="size-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Templates" icon={<LayoutTemplate className="size-4 text-accent-2" />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {(strategies.data?.strategies ?? []).map((s: any) => (
            <button key={s.id} onClick={() => setCreating(s.id)} disabled={s.id === "news_monitor"} className="rounded-xl border border-line bg-bg-2/50 p-3 text-left transition-colors hover:border-accent/50 disabled:opacity-50">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold">{s.name}</span><Badge>{s.category}</Badge></div>
              <p className="mt-1 text-xs text-muted">{s.description}</p>
            </button>
          ))}
        </div>
      </Card>

      <Modal open={!!creating} onClose={() => setCreating(null)} title="Create bot" wide>
        {creating && <BotForm strategies={strategies.data?.strategies ?? []} initialStrategy={creating} onCreated={(id) => { setCreating(null); refresh(); location.assign(`/bots/${id}`); }} />}
      </Modal>
      <Modal open={promptOpen} onClose={() => { setPromptOpen(false); refresh(); }} title="Create a bot with a prompt" wide>
        <PromptCreate onDone={refresh} />
      </Modal>
    </div>
  );
}

function PromptCreate({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("Buy at a 3% dip and sell at 5% increase, then rinse and repeat");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [cid, setCid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(t = text) {
    if (!t.trim()) return;
    setBusy(true);
    setMsgs((m) => [...m, { id: `u${Date.now()}`, role: "user", content: t }]);
    try {
      const r = await api("/api/ai/prompt", { method: "POST", json: { text: t, conversationId: cid } });
      setCid(r.conversationId); setMsgs((m) => [...m, ...(Array.isArray(r.messages) && r.messages.length ? r.messages : [r.message])]); setText("");
    } catch (e: any) { setMsgs((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: e.message }]); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Describe the strategy and include the asset and amount, e.g. “Buy $100 of SOL at a 3% dip and sell at +5%, repeat”. Merod prepares a bot with safe limits for you to review.</p>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto">
        {msgs.map((m) => m.role === "user"
          ? <div key={m.id} className="ml-auto w-fit max-w-[85%] rounded-xl bg-accent px-3 py-1.5 text-sm text-white">{m.content}</div>
          : <div key={m.id} className="text-sm"><div>{m.content}</div><PlanCard message={m} onChip={(s) => send(s)} onDone={onDone} /></div>)}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} className="h-10 flex-1 rounded-xl border border-line bg-bg-2 px-3 text-sm outline-none focus:border-accent" placeholder="Describe your bot…" />
        <Button variant="primary" onClick={() => send()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Send"}</Button>
      </div>
    </div>
  );
}

function BotForm({ strategies, initialStrategy, onCreated }: { strategies: any[]; initialStrategy: string; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [strategyId, setStrategyId] = useState(initialStrategy);
  const strat = strategies.find((s) => s.id === strategyId);
  const [params, setParams] = useState<Record<string, any>>({});
  const [assets, setAssets] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [f, setF] = useState({ name: "", description: "", budgetUsd: 0, maxPositionUsd: 0, maxDailySpendUsd: 0, maxDailyLossUsd: 0, minLiquidityUsd: 50000,
    maxSlippageBps: 100, maxPriceDeviationPct: 5, profitTargetPct: "", stopLossPct: "", schedule: "every_1m", approvalRequired: false, start: true, markets: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (strat) setParams(Object.fromEntries(strat.params.map((p: any) => [p.key, p.default ?? ""]))); }, [strategyId]); // eslint-disable-line
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => api(`/api/assets?q=${encodeURIComponent(q)}&limit=6`).then((r) => setResults(r.assets)).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q]);
  const noAssets = ["watchlist_monitor", "meme_discovery", "news_monitor"].includes(strategyId);

  async function submit() {
    setBusy(true);
    try {
      const cleanParams = Object.fromEntries(Object.entries(params).map(([k, v]) => {
        const def = strat?.params.find((p: any) => p.key === k);
        return [k, def?.type === "number" ? (v === "" || v == null ? null : Number(v)) : v];
      }));
      const r = await api("/api/bots", { method: "POST", json: {
        name: f.name || strat?.name, description: f.description, strategyId, params: cleanParams, assetIds: assets.map((a) => a.id),
        markets: f.markets ? f.markets.split(",").map((s) => s.trim()).filter(Boolean) : [], isPaper: true,
        budgetUsd: Number(f.budgetUsd), maxPositionUsd: Number(f.maxPositionUsd), maxDailySpendUsd: Number(f.maxDailySpendUsd), maxDailyLossUsd: Number(f.maxDailyLossUsd),
        minLiquidityUsd: Number(f.minLiquidityUsd), maxSlippageBps: Number(f.maxSlippageBps), maxPriceDeviationPct: Number(f.maxPriceDeviationPct),
        profitTargetPct: f.profitTargetPct ? Number(f.profitTargetPct) : null, stopLossPct: f.stopLossPct ? Number(f.stopLossPct) : null,
        schedule: f.schedule, approvalRequired: f.approvalRequired, start: f.start,
      } });
      toast(`Bot “${r.bot.name}” ${r.bot.status}`, "up");
      onCreated(r.bot.id);
    } catch (e: any) { toast(e.body?.issues?.[0] ? `${e.body.issues[0].path}: ${e.body.issues[0].message}` : e.message, "down"); } finally { setBusy(false); }
  }
  const num = (k: keyof typeof f, label: string, hint?: string) => <Input label={label} hint={hint} type="number" min="0" step="any" value={f[k] as any} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn"><PaperBadge /> Bots run with virtual funds. Real-money automation is disabled until approved.</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Strategy" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
          {strategies.map((s) => <option key={s.id} value={s.id} disabled={s.id === "news_monitor"}>{s.name}</option>)}
        </Select>
        <Input label="Name" placeholder={strat?.name} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
      </div>
      {strat && <p className="text-xs text-muted">{strat.description}</p>}

      {!noAssets && (
        <div className="relative">
          <span className="mb-1 block text-xs font-medium text-muted">Assets (up to 20)</span>
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-bg-2 p-2">
            {assets.map((a) => <span key={a.id} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-xs">{a.symbol} <span className="text-faint">{a.venue}</span><button onClick={() => setAssets(assets.filter((x) => x.id !== a.id))}><X className="size-3" /></button></span>)}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SOL, NVDA, contract…" className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none" />
          </div>
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
              {results.map((a) => <button key={a.id} onClick={() => { if (!assets.some((x) => x.id === a.id) && assets.length < 20) setAssets([...assets, a]); setQ(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-panel-2"><b>{a.symbol}</b> <span className="text-muted">{a.name} · {a.venue}</span>{a.risk_flags?.includes("demo_data") && <Badge tone="warn" className="ml-2">DEMO</Badge>}</button>)}
            </div>
          )}
        </div>
      )}
      {strategyId === "meme_discovery" && <Input label="Networks to scan (comma-separated)" placeholder="solana, solana-demo" value={f.markets} onChange={(e) => setF({ ...f, markets: e.target.value })} hint="Leave empty for all networks" />}

      {strat?.params?.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium">Strategy settings</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {strat.params.map((p: any) => p.type === "boolean"
              ? <div key={p.key} className="flex items-end pb-2"><Toggle checked={!!params[p.key]} onChange={(v) => setParams({ ...params, [p.key]: v })} label={p.label} /></div>
              : p.type === "select"
                ? <Select key={p.key} label={p.label} value={params[p.key] ?? ""} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}>{p.options.map((o: string) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}</Select>
                : <Input key={p.key} label={p.label} type={p.type === "number" ? "number" : "text"} step="any" value={params[p.key] ?? ""} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })} />)}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-sm font-medium">Risk limits</div>
        <div className="grid gap-3 sm:grid-cols-4">
          {num("maxPositionUsd", "Max position ($)", "0 = no limit")}
          {num("minLiquidityUsd", "Min liquidity ($)")}{num("maxSlippageBps", "Max slippage (bps)")}{num("maxPriceDeviationPct", "Max price deviation (%)")}
          {num("profitTargetPct", "Profit target (%)", "optional")}{num("stopLossPct", "Stop-loss (%)", "optional")}
          <Select label="Check every" value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })}>{SCHEDULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </div>
      </div>
      <Input label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} />
      <div className="flex flex-wrap items-center gap-5">
        <Toggle checked={f.approvalRequired} onChange={(v) => setF({ ...f, approvalRequired: v })} label="Require my approval for each trade" />
        <Toggle checked={f.start} onChange={(v) => setF({ ...f, start: v })} label="Start immediately" />
      </div>
      <div className="flex justify-end border-t border-line pt-4"><Button variant="primary" loading={busy} onClick={submit} disabled={!noAssets && assets.length === 0}>Create bot</Button></div>
    </div>
  );
}
