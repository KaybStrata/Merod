"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Wand2, Layers, Rocket, Sparkles, Send, Calendar, Plus, ArrowUpRight, RefreshCw, LineChart, List, ArrowLeftRight, BarChart, BarChart3, Clock, FlaskConical, Save, Copy, Target, X,
  Timer, Activity, TrendingUp, TrendingDown, Waves, CalendarClock, Newspaper, ShieldCheck, Percent, GitMerge, Filter, Search,
} from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle } from "@/components/shell/context";
import { Modal, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { fmtPct, fmtUsd, toneOf } from "@/components/agents/common";

type Cfg = { asset: string; timeframe: "15m" | "1h" | "1d"; from?: string; to?: string; strategy: any; enabled: { entry: boolean; exit: boolean; risk: boolean }; positionPct: number; maxDrawdownPct: number };
const DEFAULT: Cfg = { asset: "SOL", timeframe: "1h", strategy: { kind: "momentum", tradeUsd: 100, takeProfitPct: 3, stopLossPct: 1.5, maxOpen: 1, minChangePct: 1.5, rsiMax: 70 }, enabled: { entry: true, exit: true, risk: true }, positionPct: 2, maxDrawdownPct: 15 };
const KINDS: [string, string][] = [["momentum", "Momentum"], ["mean_reversion", "Mean reversion"], ["breakout", "Breakout"], ["dip", "Dip buying"], ["dca", "DCA"], ["news", "News reaction"]];
const KIND_DEFAULTS: Record<string, any> = {
  momentum: { minChangePct: 1.5, rsiMax: 75 }, mean_reversion: { rsiBuy: 30, rsiSell: 70 }, breakout: { lookback: 20, minVolumeRise: 1.3 },
  dip: { dipPct: 3 }, dca: { everyHours: 24 }, news: { minChangePct: 1 },
};
const PROMPTS = ["RSI dip in an uptrend", "Trend following with dynamic exit", "BTC momentum with risk control"];

type Rule = { label: string; key?: string; suffix?: string };
function entryRules(s: any): Rule[] {
  if (s.kind === "momentum" || s.kind === "news") return [{ label: "24h change ≥", key: "minChangePct", suffix: "%" }, { label: "MACD(12,26) > 0" }, { label: "RSI(14) <", key: "rsiMax" }];
  if (s.kind === "mean_reversion") return [{ label: "RSI(14) ≤", key: "rsiBuy" }];
  if (s.kind === "breakout") return [{ label: "Close > 20-bar high" }, { label: "Volume ×", key: "minVolumeRise" }];
  if (s.kind === "dip") return [{ label: "Price ≤ recent high −", key: "dipPct", suffix: "%" }];
  if (s.kind === "dca") return [{ label: "Every", key: "everyHours", suffix: "h" }];
  return [];
}
function exitCondition(s: any): Rule | null {
  return s.kind === "momentum" || s.kind === "news" ? { label: "MACD < 0 and RSI < 45" } : s.kind === "mean_reversion" ? { label: "RSI(14) ≥", key: "rsiSell" } : s.kind === "breakout" ? { label: "Close < 20-bar low" } : null;
}

/** Block palette (design 07). Indicator/trigger blocks switch the strategy logic; action/filter blocks set its exits and risk. */
const PALETTE: { group: string; items: { label: string; icon: any; kind?: string; patch?: (s: any) => any; hint: string }[] }[] = [
  { group: "Triggers", items: [
    { label: "On candle close", icon: Timer, hint: "Evaluated on every closed bar of the timeframe" },
    { label: "Schedule (DCA)", icon: CalendarClock, kind: "dca", hint: "Buy on a fixed schedule" },
    { label: "News reaction", icon: Newspaper, kind: "news", hint: "Enter on a news-driven move" },
  ] },
  { group: "Indicators", items: [
    { label: "RSI", icon: Activity, kind: "mean_reversion", hint: "Buy oversold, sell overbought" },
    { label: "MACD momentum", icon: TrendingUp, kind: "momentum", hint: "Trend + momentum confirmation" },
    { label: "20-bar breakout", icon: BarChart3, kind: "breakout", hint: "Close above the 20-bar high on volume" },
    { label: "Price dip", icon: TrendingDown, kind: "dip", hint: "Buy a % drop from the recent high" },
  ] },
  { group: "Actions", items: [
    { label: "Take profit", icon: Target, patch: (s) => ({ takeProfitPct: s.takeProfitPct || 4 }), hint: "Sell at a % gain" },
    { label: "Stop loss", icon: ShieldCheck, patch: (s) => ({ stopLossPct: s.stopLossPct || 2 }), hint: "Sell at a % loss" },
    { label: "Position size", icon: Percent, hint: "Edit on the Buy node" },
  ] },
  { group: "Filters", items: [
    { label: "Max open positions", icon: Filter, patch: (s) => ({ maxOpen: s.maxOpen || 1 }), hint: "Cap concurrent positions" },
    { label: "Volume filter", icon: Waves, kind: "breakout", hint: "Require rising volume" },
  ] },
];

const TONE: Record<string, string> = { trigger: "#6aa8ff", indicator: "#b9a3f0", logic: "var(--accent)", action: "var(--up)", exit: "var(--down)", filter: "var(--muted)" };

/** Strategy Builder (design 07): block palette → node canvas → backtest with equity curve, stats and monthly returns. */
export default function StrategyBuilder() {
  const toast = useToast();
  const router = useRouter();
  const saved = useApi<any>("/api/builder");
  const [tab, setTab] = useState<"build" | "optimize" | "versions">("build");
  const [text, setText] = useState("");
  const [name, setName] = useState("SOL Momentum");
  const [cfg, setCfg] = useState<Cfg>(DEFAULT);
  const [bt, setBt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [chartTab, setChartTab] = useState<"equity" | "returns" | "log" | "dist">("equity");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [capital, setCapital] = useState(1000);
  const [opt, setOpt] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const words = name.trim().split(/\s+/);
  usePageTitle({ section: "Automate · Strategies · Builder", title: name || "Strategy", accent: words.length > 1 ? words[words.length - 1] : undefined }, [name]);
  const s = cfg.strategy;
  const setS = (p: any) => setCfg((c) => ({ ...c, strategy: { ...c.strategy, ...p } }));
  async function backtest(c = cfg) {
    setBusy(true);
    try { const r: any = await api("/api/builder", { method: "POST", json: { action: "backtest", config: c } }); setBt(r.backtest); }
    catch (e: any) { toast(e.message, "down"); setBt(null); } finally { setBusy(false); }
  }
  useEffect(() => { backtest(DEFAULT); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function draft(t = text) {
    if (!t.trim()) return; setBusy(true);
    try {
      const r: any = await api("/api/builder", { method: "POST", json: { action: "draft", text: t } });
      setCfg({ ...DEFAULT, ...r.config, enabled: DEFAULT.enabled, positionPct: cfg.positionPct, maxDrawdownPct: cfg.maxDrawdownPct });
      setName(t.length <= 40 ? t.charAt(0).toUpperCase() + t.slice(1) : `${r.config.asset} ${KINDS.find(([k]) => k === r.config.strategy.kind)?.[1] ?? "Strategy"}`);
      if (r.backtest?.error) { toast(r.backtest.error, "down"); setBt(null); } else setBt(r.backtest);
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  async function save(note?: string) { try { const r: any = await api("/api/builder", { method: "POST", json: { action: "save", name, config: cfg, backtest: bt, note } }); toast(`Saved ${name} v${r.version}`, "up"); saved.refresh(); } catch (e: any) { toast(e.message, "down"); } }
  async function doDeploy() { try { const r: any = await api("/api/builder", { method: "POST", json: { action: "deploy", name, config: cfg, capitalUsd: capital } }); await save("Deployed"); toast(`${r.agent.name} created as a paper agent. Review, then start.`, "up"); router.push(`/agents/${r.agent.id}`); } catch (e: any) { toast(e.message, "down"); } }
  async function optimize() {
    setBusy(true); setOpt(null);
    try {
      const grid = [[2, 1], [3, 1.5], [4, 2], [5, 2.5], [6, 3]];
      const out = [];
      for (const [tp, sl] of grid) { const c = { ...cfg, strategy: { ...s, takeProfitPct: tp, stopLossPct: sl } }; const r: any = await api("/api/builder", { method: "POST", json: { action: "backtest", config: c } }); out.push({ tp, sl, ...r.backtest }); }
      setOpt(out.sort((a, b) => (b.sharpe ?? -9) - (a.sharpe ?? -9)));
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  function applyBlock(it: (typeof PALETTE)[number]["items"][number]) {
    if (it.kind && it.kind !== s.kind) {
      const keep = { tradeUsd: s.tradeUsd, takeProfitPct: s.takeProfitPct, stopLossPct: s.stopLossPct, maxOpen: s.maxOpen };
      setCfg((c) => ({ ...c, strategy: { kind: it.kind, ...keep, ...KIND_DEFAULTS[it.kind!] } }));
      toast(`${it.label}: strategy logic set to ${KINDS.find(([k]) => k === it.kind)?.[1]}`, "neutral");
    } else if (it.patch) { setS(it.patch(s)); setCfg((c) => ({ ...c, enabled: { ...c.enabled, exit: true, risk: true } })); }
    else toast(it.hint, "neutral");
  }
  const versions = useMemo(() => (saved.data?.strategies ?? []).find((x: any) => x.name === name)?.versions ?? [], [saved.data, name]);
  const latestVersion = versions[0]?.version ?? 0;
  const field = "h-8 rounded-lg border border-line bg-panel-2/70 px-2 text-[12.5px] outline-none focus:border-accent/60";
  const Val = ({ r }: { r: Rule }) => !r.key ? null : editKey === r.key
    ? <input autoFocus type="number" step={0.1} defaultValue={s[r.key]} onBlur={(e) => { setS({ [r.key!]: Number(e.target.value) }); setEditKey(null); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="w-14 rounded bg-bg-2 px-1 text-accent-2 outline-none" />
    : <button onClick={() => setEditKey(r.key!)} className="font-semibold text-accent-2 hover:underline">{s[r.key] ?? "—"}{r.suffix}</button>;

  // ---- canvas layout ----
  const entries = entryRules(s), exitCond = exitCondition(s);
  const NW = 196, NH = 66;
  type N = { id: string; x: number; y: number; tone: keyof typeof TONE; label: string; body: React.ReactNode; off?: boolean; onRemove?: () => void };
  const nodes: N[] = [];
  const rowsY = (n: number, i: number, h = 360) => (h - (n * NH + (n - 1) * 18)) / 2 + i * (NH + 18) + 18;
  nodes.push({ id: "trigger", x: 16, y: rowsY(1, 0), tone: "trigger", label: "Trigger", body: <>On <select value={cfg.timeframe} onChange={(e) => setCfg({ ...cfg, timeframe: e.target.value as any })} className="rounded bg-bg-2 px-1 font-semibold text-accent-2 outline-none"><option value="15m">15m</option><option value="1h">1h</option><option value="1d">1d</option></select> candle close · <input value={cfg.asset} onChange={(e) => setCfg({ ...cfg, asset: e.target.value.toUpperCase() })} className="w-14 rounded bg-bg-2 px-1 font-semibold text-accent-2 outline-none" aria-label="Asset" /></> });
  entries.forEach((r, i) => nodes.push({ id: `in${i}`, x: 252, y: rowsY(entries.length, i), tone: s.kind === "dca" ? "trigger" : "indicator", label: s.kind === "dca" ? "Schedule" : "Condition", off: !cfg.enabled.entry, body: <>{r.label} <Val r={r} /></> }));
  const hasRisk = cfg.enabled.risk;
  nodes.push({ id: "and", x: 488, y: rowsY(1, 0) + 8, tone: "logic", label: entries.length > 1 ? "AND" : "Pass", off: !cfg.enabled.entry, body: <>{entries.length > 1 ? "All conditions true" : "Condition true"}{hasRisk && s.maxOpen ? <> · open &lt; <Val r={{ label: "", key: "maxOpen" }} /></> : null}</> });
  nodes.push({ id: "buy", x: 700, y: rowsY(1, 0), tone: "action", label: "Action · Buy", body: <>Buy <select value={cfg.positionPct} onChange={(e) => setCfg({ ...cfg, positionPct: Number(e.target.value) })} className="rounded bg-bg-2 px-1 font-semibold text-accent-2 outline-none">{[1, 2, 5, 10, 25, 50, 100].map((v) => <option key={v} value={v}>{v}%</option>)}</select> of equity</> });
  const exits: N[] = [];
  if (exitCond) exits.push({ id: "xc", x: 0, y: 0, tone: "exit", label: "Exit · Signal", off: !cfg.enabled.exit, body: <>{exitCond.label} <Val r={exitCond} /></> });
  if (s.takeProfitPct) exits.push({ id: "tp", x: 0, y: 0, tone: "exit", label: "Exit · Take profit", off: !cfg.enabled.exit, onRemove: () => setS({ takeProfitPct: 0 }), body: <>Sell at +<Val r={{ label: "", key: "takeProfitPct", suffix: "%" }} /></> });
  if (s.stopLossPct) exits.push({ id: "sl", x: 0, y: 0, tone: "exit", label: "Exit · Stop loss", off: !cfg.enabled.exit, onRemove: () => setS({ stopLossPct: 0 }), body: <>Sell at −<Val r={{ label: "", key: "stopLossPct", suffix: "%" }} /></> });
  if (hasRisk) exits.push({ id: "dd", x: 0, y: 0, tone: "filter", label: "Risk guard", body: <>Halt if drawdown &gt; <select value={cfg.maxDrawdownPct} onChange={(e) => setCfg({ ...cfg, maxDrawdownPct: Number(e.target.value) })} className="rounded bg-bg-2 px-1 font-semibold text-accent-2 outline-none">{[5, 10, 15, 20, 30, 50].map((v) => <option key={v} value={v}>{v}%</option>)}</select></> });
  exits.forEach((n, i) => { n.x = 936; n.y = rowsY(exits.length, i); nodes.push(n); });
  const edges: [string, string][] = [...entries.map((_, i) => ["trigger", `in${i}`] as [string, string]), ...entries.map((_, i) => [`in${i}`, "and"] as [string, string]), ["and", "buy"], ...exits.map((n) => ["buy", n.id] as [string, string])];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const CW = 936 + NW + 16, CH = 380;

  const filteredPalette = PALETTE.map((g) => ({ ...g, items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length);

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-60 rounded-lg border border-transparent bg-transparent px-1.5 text-[14px] font-semibold outline-none hover:border-line focus:border-accent/60" aria-label="Strategy name" />
        <span className="rounded-md border border-line-2 px-1.5 py-0.5 text-[10.5px] text-muted">Draft · v{latestVersion + 1}</span>
        {bt && !bt.ddBreached && <span className="flex items-center gap-1 rounded-md border border-up/30 bg-up-soft px-1.5 py-0.5 text-[10.5px] text-up"><span className="size-1.5 rounded-full bg-up" /> Paper ready</span>}
        {bt?.ddBreached && <span className="rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn">Drawdown above {cfg.maxDrawdownPct}%</span>}
        <div className="flex gap-0.5 rounded-lg border border-line p-0.5">
          {([["build", "Build", Wand2], ["optimize", "Optimize", Target], ["versions", "Versions", Layers]] as const).map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={cx("flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px]", tab === k ? "nav-active" : "text-muted hover:text-text")}><I className="size-3.5" />{l}</button>)}
        </div>
        <span className="flex items-center gap-1 rounded-lg border border-line bg-panel-2/70 px-2 py-1 text-[11.5px]"><Calendar className="size-3.5 text-muted" /><input type="date" value={cfg.from ?? ""} onChange={(e) => setCfg({ ...cfg, from: e.target.value || undefined })} className="bg-transparent outline-none" /> – <input type="date" value={cfg.to ?? ""} onChange={(e) => setCfg({ ...cfg, to: e.target.value || undefined })} className="bg-transparent outline-none" /></span>
        <div className="ml-auto flex gap-1.5">
          <Btn onClick={() => { setName(`${name} (copy)`); toast("Duplicated: save it to keep a separate history", "neutral"); }}><Copy className="size-3.5" /> Duplicate</Btn>
          <Btn onClick={() => save()}><Save className="size-3.5" /> Save</Btn>
          <Btn onClick={() => backtest()} disabled={busy}><FlaskConical className="size-3.5" /> {busy ? "Running…" : "Backtest"}</Btn>
          <Btn gold onClick={() => setDeployOpen(true)} disabled={!bt}><Rocket className="size-3.5" /> Deploy to paper</Btn>
        </div>
      </div>

      {/* describe */}
      <div className="flex items-center gap-2 rounded-xl border border-line-2 bg-panel/80 px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-accent-2" />
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") draft(); }} maxLength={8000} placeholder="Describe a strategy and Merod builds the blocks… e.g. “RSI dip in an uptrend on SOL, 4% take profit”" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        <div className="hidden gap-1 lg:flex">{PROMPTS.map((p) => <button key={p} onClick={() => { setText(p); draft(p); }} className="rounded-full border border-line-2 px-2.5 py-0.5 text-[11px] text-muted hover:border-accent/40 hover:text-text">{p}</button>)}</div>
        <button onClick={() => draft()} disabled={busy || !text.trim()} className="flex size-8 items-center justify-center rounded-lg bg-grad text-bg disabled:opacity-50" aria-label="Build"><Send className="size-4" /></button>
      </div>

      {tab === "build" && (
        <div className="grid gap-3 lg:grid-cols-[210px_1fr]">
          {/* palette */}
          <aside className="surface rounded-2xl p-2.5">
            <div className="relative mb-2"><Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blocks" className="h-8 w-full rounded-lg border border-line bg-bg-2/60 pl-7 pr-2 text-[12px] outline-none focus:border-accent/60" /></div>
            {filteredPalette.map((g) => (
              <div key={g.group} className="mb-2">
                <div className="px-1 pb-1 pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-faint">{g.group}</div>
                {g.items.map((it) => {
                  const active = it.kind ? it.kind === s.kind : it.label === "Take profit" ? !!s.takeProfitPct : it.label === "Stop loss" ? !!s.stopLossPct : false;
                  return (
                    <button key={it.label} onClick={() => applyBlock(it)} title={it.hint} className={cx("mb-0.5 flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px]", active ? "border-accent/50 bg-accent-soft text-text" : "border-transparent text-muted hover:border-line-2 hover:bg-panel-2 hover:text-text")}>
                      <it.icon className={cx("size-3.5 shrink-0", active ? "text-accent-2" : "text-faint")} /><span className="flex-1 truncate">{it.label}</span>{!active && <Plus className="size-3 text-faint" />}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="mt-2 border-t border-line pt-2">
              <div className="px-1 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-faint">Sections</div>
              {(["entry", "exit", "risk"] as const).map((k) => (
                <label key={k} className="flex items-center justify-between px-1 py-1 text-[12px] capitalize text-muted">{k}
                  <button onClick={() => setCfg({ ...cfg, enabled: { ...cfg.enabled, [k]: !cfg.enabled[k] } })} aria-pressed={cfg.enabled[k]} className={cx("relative h-4 w-7 rounded-full", cfg.enabled[k] ? "bg-up" : "bg-line-2")}><span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", cfg.enabled[k] ? "left-[14px]" : "left-0.5")} /></button>
                </label>
              ))}
            </div>
          </aside>

          {/* canvas */}
          <section className="surface min-w-0 rounded-2xl">
            <header className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-[12px]">
              <GitMerge className="size-4 text-accent-2" /><span className="font-semibold">Logic</span>
              <span className="text-faint">{KINDS.find(([k]) => k === s.kind)?.[1]} · {nodes.length} blocks · click a gold value to edit</span>
              <select value={s.kind} onChange={(e) => applyBlock({ label: KINDS.find(([k]) => k === e.target.value)![1], icon: Activity, kind: e.target.value, hint: "" })} className={cx(field, "ml-auto")} aria-label="Strategy type">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </header>
            <div className="overflow-auto" style={{ backgroundImage: "radial-gradient(var(--line-2) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
              <div className="relative" style={{ width: CW, height: CH }}>
                <svg width={CW} height={CH} className="absolute inset-0">
                  <defs><marker id="sb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--accent)" /></marker></defs>
                  {edges.map(([a, b], i) => { const A = byId.get(a), B = byId.get(b); if (!A || !B) return null;
                    const x1 = A.x + NW, y1 = A.y + NH / 2, x2 = B.x - 3, y2 = B.y + NH / 2, m = (x1 + x2) / 2;
                    return <path key={i} d={`M${x1} ${y1} C ${m} ${y1}, ${m} ${y2}, ${x2} ${y2}`} fill="none" stroke="var(--accent)" strokeOpacity={B.off ? 0.18 : 0.5} strokeWidth="1.2" markerEnd="url(#sb-arrow)" />; })}
                </svg>
                {nodes.map((n) => (
                  <div key={n.id} className={cx("absolute rounded-xl border border-line-2 bg-panel/95 px-2.5 py-2 shadow-[0_8px_24px_-14px_rgba(0,0,0,.9)]", n.off && "opacity-40")} style={{ left: n.x, top: n.y, width: NW, height: NH, borderLeft: `3px solid ${TONE[n.tone]}` }}>
                    <div className="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: TONE[n.tone] }}>{n.label}{n.onRemove && <button onClick={n.onRemove} className="text-faint hover:text-text" aria-label="Remove"><X className="size-3" /></button>}</div>
                    <div className="mt-1 text-[12.5px] leading-snug">{n.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === "optimize" && (
        <section className="surface rounded-2xl p-4">
          <div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">Optimize exits</h3><Btn gold onClick={optimize} disabled={busy}><Target className="size-3.5" /> {busy ? "Testing…" : "Run 5 variants"}</Btn></div>
          <p className="mt-1 text-[12px] text-muted">Tests take-profit / stop-loss pairs on the same real history and ranks them by Sharpe. Beware overfitting: confirm the winner on another date range before deploying.</p>
          {opt && <table className="mt-3 w-full text-[13px]"><thead className="text-left text-[10.5px] uppercase tracking-wider text-faint"><tr><th className="py-1.5">TP / SL</th><th className="text-right">Return</th><th className="text-right">Max DD</th><th className="text-right">Sharpe</th><th className="text-right">Win rate</th><th /></tr></thead>
            <tbody>{opt.map((o) => <tr key={`${o.tp}${o.sl}`} className="border-t border-line/60"><td className="py-1.5">+{o.tp}% / -{o.sl}%</td><td className={cx("num text-right", toneOf(o.returnPct))}>{fmtPct(o.returnPct)}</td><td className="num text-right">-{o.maxDrawdownPct.toFixed(1)}%</td><td className="num text-right">{o.sharpe?.toFixed(2) ?? "—"}</td><td className="num text-right">{o.winRate?.toFixed(0) ?? "—"}%</td><td className="text-right"><button onClick={() => { setS({ takeProfitPct: o.tp, stopLossPct: o.sl }); setBt(o); setTab("build"); }} className="text-[12px] text-accent-2">Use</button></td></tr>)}</tbody></table>}
        </section>
      )}
      {tab === "versions" && (
        <section className="surface rounded-2xl p-4">
          {(saved.data?.strategies ?? []).map((st: any) => <div key={st.id} className="mb-3"><div className="text-[13px] font-semibold">{st.name}</div>{(st.versions ?? []).map((v: any) => <button key={v.version} onClick={() => { setName(st.name); setCfg({ ...DEFAULT, ...v.config }); backtest({ ...DEFAULT, ...v.config }); setTab("build"); }} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-panel-2"><Clock className="size-3.5 text-faint" /><span className="font-medium">v{v.version}</span><span className="text-[11px] text-muted">{v.note ?? ""}</span><span className={cx("num ml-auto", toneOf(Number(v.ret)))}>{v.ret != null ? fmtPct(Number(v.ret)) : "—"}</span><span className="text-[11px] text-muted">{v.win != null ? `${Number(v.win).toFixed(1)}% WR` : ""}</span><span className="w-16 text-right text-[11px] text-faint">{ago(v.created_at)}</span></button>)}</div>)}
          {!(saved.data?.strategies ?? []).length && <p className="text-[13px] text-muted">No saved strategies yet. Save a version to keep its backtest evidence.</p>}
        </section>
      )}

      {/* backtest */}
      <section className="surface rounded-2xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><BarChart3 className="size-4 text-accent-2" /> Backtest</h3>
          {bt && <span className="text-[11px] text-faint">{bt.asset} · {bt.timeframe} · {bt.from} → {bt.to} · {bt.trades.toLocaleString()} trades · {bt.bars} real bars · fees {bt.assumptions.feeBps}bps · slippage {bt.assumptions.slippageBps}bps</span>}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-line p-0.5">
            {([["equity", "Equity", LineChart], ["returns", "Returns", BarChart3], ["log", "Trades", List], ["dist", "Distribution", BarChart]] as const).map(([k, l, I]) => <button key={k} onClick={() => setChartTab(k)} className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-[11px]", chartTab === k ? "nav-active" : "text-muted")}><I className="size-3.5" />{l}</button>)}
          </div>
          <button onClick={() => backtest()} className="flex size-7 items-center justify-center rounded-lg border border-line-2 text-muted" aria-label="Re-run"><RefreshCw className={cx("size-3.5", busy && "animate-spin")} /></button>
        </header>
        {!bt ? <p className="py-14 text-center text-[13px] text-muted">{busy ? "Running backtest on real history…" : "Run a backtest to see results."}</p> : (
          <div className="grid gap-4 p-3.5 xl:grid-cols-[1.5fr_0.8fr_1fr]">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2"><span className={cx("num text-[1.6rem] font-semibold", toneOf(bt.returnPct))}>{fmtUsd(bt.startValue * (1 + bt.returnPct / 100), 0)}</span><span className={cx("num text-[13px]", toneOf(bt.returnPct))}>{fmtPct(bt.returnPct)}</span><span className="text-[11px] text-faint">from {fmtUsd(bt.startValue, 0)}</span></div>
              {chartTab === "equity" && <Equity points={bt.equity} start={bt.startValue} />}
              {chartTab === "returns" && <Returns points={bt.equity} />}
              {chartTab === "log" && <div className="mt-2 max-h-[210px] overflow-y-auto text-[12px]">{[...bt.tradeLog].reverse().map((t: any, i: number) => <div key={i} className="flex justify-between border-b border-line/60 py-1"><span className="text-muted">{new Date(t.t).toLocaleString()}</span><span className={t.side === "buy" ? "text-up" : "text-down"}>{t.side}</span><span className="num">{fmtUsd(t.price)}</span><span className={cx("num w-20 text-right", toneOf(t.pnl))}>{t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""}</span></div>)}{!bt.tradeLog?.length && <p className="py-8 text-center text-muted">No trades in this range.</p>}</div>}
              {chartTab === "dist" && <Dist trades={bt.tradeLog} />}
            </div>
            <div className="grid grid-cols-2 content-start gap-2">
              <Kpi label="CAGR" value={bt.cagr == null ? "—" : fmtPct(bt.cagr)} tone={toneOf(bt.cagr)} />
              <Kpi label="Max drawdown" value={`-${bt.maxDrawdownPct.toFixed(2)}%`} tone="text-down" />
              <Kpi label="Sharpe" value={bt.sharpe == null ? "—" : bt.sharpe.toFixed(2)} />
              <Kpi label="Win rate" value={bt.winRate == null ? "—" : `${bt.winRate.toFixed(1)}%`} />
              <Kpi label="Profit factor" value={bt.profitFactor == null ? "—" : bt.profitFactor.toFixed(2)} />
              <Kpi label="Trades" value={bt.trades.toLocaleString()} />
              {(bt.scenarios ?? []).slice(0, 2).map((sc: any) => <Kpi key={sc.key} label={sc.label} value={fmtPct(sc.returnPct)} tone={toneOf(sc.returnPct)} />)}
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Monthly returns</div>
              <MonthlyHeatmap points={bt.equity} />
              <p className="mt-2 text-[10px] text-faint">{bt.label}{bt.simulatedData ? " Includes simulated bars." : ""} Past results on real history; not a forecast.</p>
            </div>
          </div>
        )}
      </section>

      <Modal open={deployOpen} onClose={() => setDeployOpen(false)} title={`Deploy ${name}`}>
        <div className="space-y-3 text-sm"><p className="text-muted">Creates a paper agent ({cfg.asset}, {KINDS.find(([k]) => k === s.kind)?.[1]}) with this strategy, its risk limits and a daily loss cap from the drawdown guard. It starts stopped so you can review it. Live deployment stays locked.</p>
          <label className="block"><span className="text-xs text-muted">Capital ($)</span><input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className={cx(field, "mt-1 h-9 w-full")} /></label>
          <div className="flex justify-end"><Btn gold onClick={doDeploy}><Rocket className="size-3.5" /> Deploy to paper <ArrowUpRight className="size-3.5" /></Btn></div></div>
      </Modal>
    </div>
  );
}

function Btn({ children, gold, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { gold?: boolean }) {
  return <button {...p} className={cx("inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium disabled:opacity-50", gold ? "bg-grad font-semibold text-bg" : "border border-line-2 bg-panel/60 hover:border-accent/50", className)}>{children}</button>;
}
function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-line bg-bg-2/60 px-2.5 py-2"><div className="truncate text-[10px] text-faint">{label}</div><div className={cx("num mt-0.5 text-[15px] font-semibold", tone)}>{value}</div></div>;
}
/** Month-by-month returns from the equity curve (rows = years). */
function MonthlyHeatmap({ points }: { points: { t: number; v: number }[] }) {
  if (!points?.length) return <p className="text-[12px] text-muted">No data.</p>;
  const ends = new Map<string, number>();
  let prev = points[0].v;
  const starts = new Map<string, number>();
  for (const p of points) { const d = new Date(p.t), k = `${d.getFullYear()}-${d.getMonth()}`; if (!starts.has(k)) starts.set(k, prev); ends.set(k, p.v); prev = p.v; }
  const rets = new Map([...ends].map(([k, v]) => [k, ((v - starts.get(k)!) / starts.get(k)!) * 100]));
  const years = [...new Set([...rets.keys()].map((k) => Number(k.split("-")[0])))].sort();
  const max = Math.max(0.5, ...[...rets.values()].map(Math.abs));
  const M = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  return (
    <div className="text-[10px]">
      <div className="grid grid-cols-[34px_repeat(12,1fr)] gap-0.5 text-center text-faint"><span />{M.map((m, i) => <span key={i}>{m}</span>)}</div>
      {years.map((y) => (
        <div key={y} className="mt-0.5 grid grid-cols-[34px_repeat(12,1fr)] gap-0.5">
          <span className="num text-faint">{y}</span>
          {M.map((_, m) => { const r = rets.get(`${y}-${m}`); const a = r == null ? 0 : 0.15 + (Math.abs(r) / max) * 0.7;
            return <span key={m} title={r == null ? "" : `${M[m]} ${y}: ${r.toFixed(2)}%`} className="num flex h-5 items-center justify-center rounded-[3px] text-[8.5px]" style={{ background: r == null ? "var(--panel-2)" : r >= 0 ? `color-mix(in srgb, var(--up) ${a * 100}%, transparent)` : `color-mix(in srgb, var(--down) ${a * 100}%, transparent)` }}>{r == null ? "" : r.toFixed(Math.abs(r) >= 10 ? 0 : 1)}</span>; })}
        </div>
      ))}
    </div>
  );
}
function Equity({ points, start }: { points: { t: number; v: number }[]; start: number }) {
  if (!points?.length) return null;
  const W = 760, H = 190, pct = points.map((p) => ((p.v - start) / start) * 100), min = Math.min(0, ...pct), max = Math.max(0, ...pct), span = max - min || 1;
  const x = (i: number) => 40 + (i / Math.max(1, points.length - 1)) * (W - 50), y = (v: number) => 8 + (1 - (v - min) / span) * (H - 30);
  const d = pct.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" "), last = pct[pct.length - 1], c = last >= 0 ? "var(--up)" : "var(--down)";
  const ticks = [min, min + span / 3, min + (2 * span) / 3, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity="0.3" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      {ticks.map((t) => <g key={t}><line x1={40} x2={W - 10} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 4" /><text x={0} y={y(t) + 3} fontSize="10" fill="var(--muted)">{t >= 0 ? "+" : ""}{t.toFixed(span < 5 ? 1 : 0)}%</text></g>)}
      <path d={`${d} L${x(points.length - 1)} ${y(min)} L${x(0)} ${y(min)} Z`} fill="url(#eq)" /><path d={d} fill="none" stroke={c} strokeWidth="1.8" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill="#fff" />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const p = points[Math.round(f * (points.length - 1))]; return <text key={f} x={x(Math.round(f * (points.length - 1)))} y={H - 4} fontSize="10" fill="var(--muted)" textAnchor="middle">{new Date(p.t).toLocaleDateString([], points[points.length - 1].t - points[0].t < 120 * 86_400_000 ? { month: "short", day: "numeric" } : { month: "short", year: "2-digit" })}</text>; })}
    </svg>
  );
}
function Returns({ points }: { points: { t: number; v: number }[] }) {
  const r = points.slice(1).map((p, i) => ((p.v - points[i].v) / points[i].v) * 100), mx = Math.max(0.01, ...r.map(Math.abs));
  return <div className="mt-2 flex h-[190px] items-center gap-px">{r.map((v, i) => <span key={i} className={cx("flex-1", v >= 0 ? "self-end bg-up/70" : "self-start bg-down/70")} style={{ height: `${(Math.abs(v) / mx) * 50}%`, marginTop: v >= 0 ? 0 : "95px", marginBottom: v >= 0 ? "95px" : 0 }} />)}</div>;
}
function Dist({ trades }: { trades: any[] }) {
  const p = trades.filter((t) => t.pnl != null).map((t) => t.pnl as number);
  if (!p.length) return <p className="py-10 text-center text-xs text-muted">No closed trades.</p>;
  const lo = Math.min(...p), hi = Math.max(...p), n = 16, w = (hi - lo) / n || 1, bins = Array(n).fill(0);
  for (const v of p) bins[Math.min(n - 1, Math.floor((v - lo) / w))]++;
  const mx = Math.max(...bins);
  return <div className="mt-2 flex h-[190px] items-end gap-1">{bins.map((b, i) => <span key={i} title={`${(lo + i * w).toFixed(1)} → ${(lo + (i + 1) * w).toFixed(1)}: ${b}`} className={cx("flex-1 rounded-t", lo + (i + 0.5) * w >= 0 ? "bg-up/70" : "bg-down/70")} style={{ height: `${(b / mx) * 100}%` }} />)}</div>;
}
