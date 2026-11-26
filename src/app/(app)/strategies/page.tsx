"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, BarChart3, SlidersHorizontal, Layers, Rocket, Sparkles, Paperclip, Image as ImageIcon, Send, ChevronDown, Calendar, Pencil, Braces, Plus, ArrowUpRight, ArrowDownRight, ShieldCheck, MoreVertical, RefreshCw, Maximize2, LineChart, List, ArrowLeftRight, BarChart, Clock, FlaskConical, Save, Copy, Target, X, MoreHorizontal, ArrowRight } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Modal, cx, useToast } from "@/components/ui";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { ago } from "@/lib/format";
import { fmtPct, fmtUsd, toneOf } from "@/components/agents/common";

type Cfg = { asset: string; timeframe: "15m" | "1h" | "1d"; from?: string; to?: string; strategy: any; enabled: { entry: boolean; exit: boolean; risk: boolean }; positionPct: number; maxDrawdownPct: number };
const DEFAULT: Cfg = { asset: "SOL", timeframe: "1h", strategy: { kind: "momentum", tradeUsd: 100, takeProfitPct: 3, stopLossPct: 1.5, maxOpen: 1, minChangePct: 1.5, rsiMax: 70 }, enabled: { entry: true, exit: true, risk: true }, positionPct: 2, maxDrawdownPct: 15 };
const KINDS: [string, string][] = [["momentum", "Momentum"], ["mean_reversion", "Mean reversion"], ["breakout", "Breakout"], ["dip", "Dip buying"], ["dca", "DCA"], ["news", "News reaction"]];
const PROMPTS = ["Trend following with dynamic exit", "Mean reversion on oversold conditions", "BTC momentum with risk control"];

function entryRules(s: any): { label: string; key?: string; suffix?: string }[] {
  if (s.kind === "momentum" || s.kind === "news") return [{ label: "24h change ≥", key: "minChangePct", suffix: "%" }, { label: "MACD(12,26) > 0" }, { label: "RSI(14) <", key: "rsiMax" }];
  if (s.kind === "mean_reversion") return [{ label: "RSI(14) ≤", key: "rsiBuy" }];
  if (s.kind === "breakout") return [{ label: "Close > 20-bar high" }, { label: "Volume ×", key: "minVolumeRise" }];
  if (s.kind === "dip") return [{ label: "Price ≤ recent high −", key: "dipPct", suffix: "%" }];
  if (s.kind === "dca") return [{ label: "Buy every", key: "everyHours", suffix: "h" }];
  return [];
}
function exitRules(s: any): { label: string; key?: string; suffix?: string }[] {
  const base = s.kind === "momentum" || s.kind === "news" ? [{ label: "MACD < 0 and RSI < 45" }] : s.kind === "mean_reversion" ? [{ label: "RSI(14) ≥", key: "rsiSell" }] : s.kind === "breakout" ? [{ label: "Close < 20-bar low" }] : [];
  return [...base, { label: "Take Profit ≥", key: "takeProfitPct", suffix: "%" }, { label: "Stop Loss ≤", key: "stopLossPct", suffix: "%" }];
}

/** Strategy Builder (Merod AI workspace): describe → rules → backtest → scenarios → versions → deploy as a paper agent. */
export default function StrategyBuilder() {
  const toast = useToast();
  const router = useRouter();
  const saved = useApi<any>("/api/builder");
  const [tab, setTab] = useState<"build" | "backtest" | "optimize" | "versions" | "deploy">("build");
  const [sub, setSub] = useState<"rules" | "parameters" | "conditions">("rules");
  const [text, setText] = useState("");
  const [name, setName] = useState("SOL Momentum");
  const [cfg, setCfg] = useState<Cfg>(DEFAULT);
  const [bt, setBt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [chartTab, setChartTab] = useState<"equity" | "returns" | "log" | "trades" | "dist">("equity");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [capital, setCapital] = useState(1000);
  const [opt, setOpt] = useState<any[] | null>(null);
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
      setName(`${r.config.asset} ${KINDS.find(([k]) => k === r.config.strategy.kind)?.[1] ?? "Strategy"}`);
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
  const versions = useMemo(() => (saved.data?.strategies ?? []).find((x: any) => x.name === name)?.versions ?? [], [saved.data, name]);
  const latestVersion = versions[0]?.version ?? 0;
  const TABS = [["build", "Build", Wand2], ["backtest", "Backtest", BarChart3], ["optimize", "Optimize", SlidersHorizontal], ["versions", "Versions", Layers], ["deploy", "Deploy", Rocket]] as const;
  const field = "h-9 rounded-lg border border-line bg-panel-2/70 px-2.5 text-sm outline-none focus:border-accent/60";
  const Chip = ({ r, onRemove }: { r: { label: string; key?: string; suffix?: string }; onRemove?: () => void }) => (
    <span className="flex items-center gap-1.5 rounded-lg border border-line-2 bg-panel-2/70 px-2.5 py-1.5 text-[12.5px]">
      {r.label}{r.key && (editKey === r.key
        ? <input autoFocus type="number" step={0.1} defaultValue={s[r.key]} onBlur={(e) => { setS({ [r.key!]: Number(e.target.value) }); setEditKey(null); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="w-14 bg-transparent text-accent-2 outline-none" />
        : <button onClick={() => setEditKey(r.key!)} className="font-semibold text-accent-2">{s[r.key] ?? "—"}{r.suffix}</button>)}
      {onRemove && <button onClick={onRemove} className="text-faint hover:text-text"><X className="size-3" /></button>}
    </span>
  );
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-[10%] h-[240px] w-[55%] opacity-80" />
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Merod AI Workspace</div>
          <h1 className="text-[2.4rem] font-semibold leading-tight tracking-tight">Strategy <span className="serif-accent text-[1.12em]">Builder</span></h1>
          <p className="mt-1 text-[1.05rem] text-muted">Create, backtest, and deploy trading strategies with AI and a powerful rules builder.</p>
        </div>
        <div className="surface flex items-center gap-3 rounded-2xl px-4 py-3"><BarChart className="size-5 text-muted" /><div><div className="flex items-center gap-1.5 text-sm font-semibold"><span className={cx("size-2 rounded-full", bt && !bt.ddBreached ? "bg-up" : "bg-warn")} />{bt && !bt.ddBreached ? "Paper Ready" : bt ? "Review risk" : "Not tested"}</div><div className="text-[11px] text-muted">{bt ? "Backtested · Deployable to paper" : "Run a backtest first"}</div></div></div>
      </div>
      <div className="relative z-10 mt-4 flex w-fit flex-wrap gap-1 rounded-2xl border border-line bg-panel/60 p-1">
        {TABS.map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={cx("flex items-center gap-2 rounded-xl px-5 py-2 text-[13.5px]", tab === k ? "nav-active" : "text-muted hover:text-text")}><I className="size-4" />{l}</button>)}
      </div>

      <div className="relative z-10 mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <section className="rounded-2xl border border-line-2 bg-panel/80 p-4 shadow-[0_20px_60px_-30px_rgba(214,179,122,0.25)]">
          <div className="flex items-start gap-3"><Sparkles className="mt-1 size-5 text-accent-2" /><textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); draft(); } }} rows={2} maxLength={8000} placeholder="Describe the strategy you want to build…" className="min-w-0 flex-1 resize-none bg-transparent text-[1.05rem] outline-none placeholder:text-muted" />
            <span className="hidden items-center gap-1.5 rounded-xl border border-line-2 px-3 py-1.5 text-xs text-muted sm:flex"><Wand2 className="size-3.5" /> Rules mode</span></div>
          <div className="mt-3 flex items-center gap-2">
            <span className="flex h-10 items-center gap-2 rounded-xl border border-line-2 px-3 text-sm"><Sparkles className="size-4 text-muted" /> Merod AI <ChevronDown className="size-3.5 text-muted" /></span>
            <button disabled title="Attachments aren't available yet" className="flex size-10 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><Paperclip className="size-4" /></button>
            <button disabled title="Image input isn't available yet" className="flex size-10 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><ImageIcon className="size-4" /></button>
            <button onClick={() => setSub("parameters")} className="flex size-10 items-center justify-center rounded-full border border-line-2 text-muted hover:text-text" title="Parameters"><SlidersHorizontal className="size-4" /></button>
            <span className="ml-auto text-[11px] text-faint">{text.length} / 8,000</span>
            <button onClick={() => draft()} disabled={busy || !text.trim()} className="flex h-11 w-16 items-center justify-center rounded-2xl bg-grad disabled:opacity-50" aria-label="Build"><Send className="size-5" /></button>
          </div>
        </section>
        <section className="surface rounded-2xl p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Wand2 className="size-4 text-accent-2" /> Try a strategy prompt</h3>
          <div className="space-y-2">{PROMPTS.map((p) => <button key={p} onClick={() => { setText(p); draft(p); }} className="flex w-full items-center justify-between rounded-xl border border-line-2 px-3 py-2 text-left text-[13px] hover:border-accent/40">“{p}”<ArrowRight className="size-3.5 text-muted" /></button>)}</div>
        </section>
      </div>

      {(tab === "build" || tab === "backtest") && (
        <div className="relative z-10 mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.25fr]">
          <section className="surface rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Layers className="size-5" /> Strategy Builder</h3>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <input value={cfg.asset} onChange={(e) => setCfg({ ...cfg, asset: e.target.value.toUpperCase() })} className={cx(field, "w-24")} aria-label="Asset" />
                <select value={cfg.timeframe} onChange={(e) => setCfg({ ...cfg, timeframe: e.target.value as any })} className={field}><option value="15m">15m</option><option value="1h">1h</option><option value="1d">1d</option></select>
                <span className="flex items-center gap-1 rounded-lg border border-line bg-panel-2/70 px-2 text-xs"><Calendar className="size-3.5 text-muted" /><input type="date" value={cfg.from ?? ""} onChange={(e) => setCfg({ ...cfg, from: e.target.value || undefined })} className="bg-transparent outline-none" /> – <input type="date" value={cfg.to ?? ""} onChange={(e) => setCfg({ ...cfg, to: e.target.value || undefined })} className="bg-transparent outline-none" /></span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1">
              {([["rules", "Rules", Pencil], ["parameters", "Parameters", SlidersHorizontal], ["conditions", "Conditions", Braces]] as const).map(([k, l, I]) => <button key={k} onClick={() => setSub(k)} className={cx("flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px]", sub === k ? "nav-active" : "text-muted")}><I className="size-3.5" />{l}</button>)}
              <select value={s.kind} onChange={(e) => setS({ kind: e.target.value })} className={cx(field, "ml-auto")} aria-label="Strategy type">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </div>
            {sub === "rules" && <div className="mt-3 space-y-3">
              <Block icon={ArrowUpRight} tone="text-up" title="Entry Logic" sub="When to open a position" on={cfg.enabled.entry} toggle={() => setCfg({ ...cfg, enabled: { ...cfg.enabled, entry: !cfg.enabled.entry } })}>
                <div className="flex flex-wrap items-center gap-2">{entryRules(s).map((r, i) => <span key={r.label} className="flex items-center gap-2">{i > 0 && <span className="text-[11px] text-muted">AND</span>}<Chip r={r} /></span>)}
                  <button onClick={() => setSub("parameters")} className="ml-auto flex items-center gap-1 rounded-lg border border-line-2 px-2.5 py-1.5 text-[12px] text-muted hover:text-text"><Plus className="size-3.5" /> Add Rule</button></div>
              </Block>
              <Block icon={ArrowDownRight} tone="text-down" title="Exit Logic" sub="When to close a position" on={cfg.enabled.exit} toggle={() => setCfg({ ...cfg, enabled: { ...cfg.enabled, exit: !cfg.enabled.exit } })}>
                <div className="flex flex-wrap items-center gap-2">{exitRules(s).map((r, i) => <span key={r.label} className="flex items-center gap-2">{i > 0 && <span className="text-[11px] text-muted">OR</span>}<Chip r={r} /></span>)}</div>
              </Block>
              <Block icon={ShieldCheck} tone="text-up" title="Risk Settings" sub="Position sizing, stops, and risk limits" on={cfg.enabled.risk} toggle={() => setCfg({ ...cfg, enabled: { ...cfg.enabled, risk: !cfg.enabled.risk } })}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Mini label="Position Size" value={<select value={cfg.positionPct} onChange={(e) => setCfg({ ...cfg, positionPct: Number(e.target.value) })} className="w-full bg-transparent outline-none">{[1, 2, 5, 10, 25, 50, 100].map((v) => <option key={v} value={v}>{v}% of equity</option>)}</select>} />
                  <Mini label="Stop Loss" value={<select value={s.stopLossPct} onChange={(e) => setS({ stopLossPct: Number(e.target.value) })} className="w-full bg-transparent outline-none">{[0, 0.5, 1, 1.5, 2, 3, 5, 8].map((v) => <option key={v} value={v}>{v ? `-${v}%` : "None"}</option>)}</select>} />
                  <Mini label="Take Profit" value={<select value={s.takeProfitPct} onChange={(e) => setS({ takeProfitPct: Number(e.target.value) })} className="w-full bg-transparent outline-none">{[0, 1, 2, 3, 4, 5, 8, 12, 20].map((v) => <option key={v} value={v}>{v ? `+${v}%` : "None"}</option>)}</select>} />
                  <Mini label="Max Drawdown" value={<select value={cfg.maxDrawdownPct} onChange={(e) => setCfg({ ...cfg, maxDrawdownPct: Number(e.target.value) })} className="w-full bg-transparent outline-none">{[5, 10, 15, 20, 30, 50].map((v) => <option key={v} value={v}>{v}%</option>)}</select>} />
                  <Mini label="Leverage" value={<span title="Leverage isn't supported: spot only">1x</span>} />
                </div>
              </Block>
            </div>}
            {sub === "parameters" && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(s).filter(([k]) => k !== "kind" && k !== "timeframe").map(([k, v]) => <label key={k} className="text-xs"><span className="mb-1 block text-muted">{k}</span><input type="number" step={0.1} value={v as any} onChange={(e) => setS({ [k]: Number(e.target.value) })} className={cx(field, "w-full")} /></label>)}
            </div>}
            {sub === "conditions" && <pre className="mt-3 max-h-80 overflow-auto rounded-xl border border-line bg-bg-2/60 p-3 text-[11.5px] text-muted">{JSON.stringify({ ...cfg, schema: "merod.agent-strategy.v1" }, null, 2)}</pre>}
            <div className="mt-3 flex justify-end"><button onClick={() => backtest()} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl bg-grad px-4 text-sm font-semibold disabled:opacity-50"><FlaskConical className="size-4" /> {busy ? "Running…" : "Run backtest"}</button></div>
          </section>

          <div className="space-y-4">
            <section className="surface rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-2"><h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><BarChart3 className="size-5" /> Backtest Performance</h3>
                {bt && <span className="ml-auto flex items-center gap-1.5 rounded-full border border-up/30 bg-up-soft px-2.5 py-0.5 text-[11px] text-up"><span className="size-1.5 rounded-full bg-up" /> Completed</span>}
                {bt && <span className="rounded-full border border-line-2 px-2.5 py-0.5 text-[11px] text-muted">{bt.trades.toLocaleString()} trades · {bt.years >= 1 ? `${bt.years.toFixed(1)}y` : `${Math.round(bt.years * 365)}d`}</span>}
                <button onClick={() => backtest()} className={cx("flex size-8 items-center justify-center rounded-lg border border-line-2 text-muted", !bt && "ml-auto")} aria-label="Re-run"><RefreshCw className={cx("size-3.5", busy && "animate-spin")} /></button>
                <button onClick={() => setChartTab("equity")} className="flex size-8 items-center justify-center rounded-lg border border-line-2 text-muted" aria-label="Expand"><Maximize2 className="size-3.5" /></button></div>
              {!bt ? <p className="py-12 text-center text-sm text-muted">{busy ? "Running backtest on real history…" : "Run a backtest to see results."}</p> : <>
                <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-6">
                  <Kpi label="Total Return" value={fmtPct(bt.returnPct)} tone={toneOf(bt.returnPct)} big />
                  <Kpi label="CAGR" value={bt.cagr == null ? "—" : fmtPct(bt.cagr)} tone={toneOf(bt.cagr)} />
                  <Kpi label="Win Rate" value={bt.winRate == null ? "—" : `${bt.winRate.toFixed(1)}%`} />
                  <Kpi label="Profit Factor" value={bt.profitFactor == null ? "—" : bt.profitFactor.toFixed(2)} />
                  <Kpi label="Max Drawdown" value={`-${bt.maxDrawdownPct.toFixed(2)}%`} tone="text-down" />
                  <Kpi label="Sharpe" value={bt.sharpe == null ? "—" : bt.sharpe.toFixed(2)} />
                </div>
                {chartTab === "equity" && <Equity points={bt.equity} start={bt.startValue} />}
                {chartTab === "returns" && <Returns points={bt.equity} />}
                {(chartTab === "log" || chartTab === "trades") && <div className="mt-3 max-h-[230px] overflow-y-auto text-[12px]">{[...bt.tradeLog].reverse().filter((t: any) => chartTab === "log" || t.side === "sell").map((t: any, i: number) => <div key={i} className="flex justify-between border-b border-line/60 py-1"><span className="text-muted">{new Date(t.t).toLocaleString()}</span><span className={t.side === "buy" ? "text-up" : "text-down"}>{t.side}</span><span className="num">{fmtUsd(t.price)}</span><span className={cx("num w-20 text-right", toneOf(t.pnl))}>{t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""}</span></div>)}</div>}
                {chartTab === "dist" && <Dist trades={bt.tradeLog} />}
                <div className="mt-2 grid grid-cols-5 gap-1 rounded-xl border border-line bg-bg-2/60 p-1 text-[12px]">
                  {([["equity", "Equity Curve", LineChart], ["returns", "Returns", BarChart3], ["log", "Trade Log", List], ["trades", "Trades", ArrowLeftRight], ["dist", "Distribution", BarChart]] as const).map(([k, l, I]) => <button key={k} onClick={() => setChartTab(k)} className={cx("flex items-center justify-center gap-1.5 rounded-lg py-1.5", chartTab === k ? "nav-active" : "text-muted")}><I className="size-3.5" /><span className="hidden md:inline">{l}</span></button>)}
                </div>
                <p className="mt-1.5 text-[10.5px] text-faint">{bt.asset} · {bt.timeframe} · {bt.from} → {bt.to} · {bt.bars} real bars · fees {bt.assumptions.feeBps}bps · slippage {bt.assumptions.slippageBps}bps. {bt.label}{bt.simulatedData ? " Includes simulated bars." : ""}</p>
              </>}
            </section>
            <div className="grid gap-4 md:grid-cols-2">
              <section className="surface rounded-2xl p-4">
                <h3 className="mb-2 flex items-center gap-2 text-[1.02rem] font-semibold"><FlaskConical className="size-5" /> Scenario Analysis</h3>
                {(bt?.scenarios ?? []).map((sc: any) => <div key={sc.key} className="flex items-center gap-3 border-b border-line/60 py-2 last:border-0"><span className="h-4 w-7 rounded-full bg-[#7f7a70] p-0.5"><span className="ml-auto block size-3 rounded-full bg-white" /></span><span className="flex-1 text-[13px]">{sc.label}</span><span className={cx("num text-[13px] font-semibold", toneOf(sc.returnPct))}>{fmtPct(sc.returnPct)}</span></div>)}
                {!bt && <p className="text-xs text-muted">Stress tests appear after a backtest.</p>}
                <p className="mt-1 text-[10px] text-faint">Stress tests reshape the real price path; they aren&apos;t forecasts.</p>
              </section>
              <section className="surface rounded-2xl p-4">
                <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-[1.02rem] font-semibold"><Layers className="size-5" /> Recent Versions</h3><button onClick={() => setTab("versions")} className="flex items-center gap-1 text-[11px] text-muted hover:text-text">View All <ArrowRight className="size-3" /></button></div>
                {versions.slice(0, 3).map((v: any, i: number) => <button key={v.version} onClick={() => { setCfg({ ...DEFAULT, ...v.config }); backtest({ ...DEFAULT, ...v.config }); }} className="flex w-full items-center gap-2 border-b border-line/60 py-2 text-left text-[13px] last:border-0"><Clock className="size-4 text-muted" /><span className="font-medium">v{v.version}</span>{i === 0 && <span className="rounded-md bg-up-soft px-1.5 py-0.5 text-[10px] text-up">Latest</span>}<span className={cx("num ml-auto", toneOf(Number(v.ret)))}>{v.ret != null ? fmtPct(Number(v.ret)) : "—"}</span><span className="text-[11px] text-muted">{v.win != null ? `${Number(v.win).toFixed(1)}% WR` : ""}</span><span className="w-14 text-right text-[11px] text-faint">{ago(v.created_at)}</span><MoreHorizontal className="size-4 text-faint" /></button>)}
                {!versions.length && <p className="text-xs text-muted">Save a version to keep its backtest evidence.</p>}
              </section>
            </div>
          </div>
        </div>
      )}

      {tab === "optimize" && (
        <section className="surface relative z-10 mt-4 rounded-2xl p-4">
          <div className="flex items-center justify-between"><h3 className="text-[1.05rem] font-semibold">Optimize exits</h3><button onClick={optimize} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl bg-grad px-4 text-sm font-semibold disabled:opacity-50"><Target className="size-4" /> {busy ? "Testing…" : "Run 5 variants"}</button></div>
          <p className="mt-1 text-xs text-muted">Tests take-profit / stop-loss pairs on the same real history and ranks them by Sharpe. Beware overfitting: confirm the winner on another date range before deploying.</p>
          {opt && <table className="mt-3 w-full text-sm"><thead className="text-left text-[11px] text-muted"><tr><th className="py-1.5">TP / SL</th><th className="text-right">Return</th><th className="text-right">Max DD</th><th className="text-right">Sharpe</th><th className="text-right">Win rate</th><th /></tr></thead>
            <tbody>{opt.map((o) => <tr key={`${o.tp}${o.sl}`} className="border-t border-line/60"><td className="py-1.5">+{o.tp}% / -{o.sl}%</td><td className={cx("num text-right", toneOf(o.returnPct))}>{fmtPct(o.returnPct)}</td><td className="num text-right">-{o.maxDrawdownPct.toFixed(1)}%</td><td className="num text-right">{o.sharpe?.toFixed(2) ?? "—"}</td><td className="num text-right">{o.winRate?.toFixed(0) ?? "—"}%</td><td className="text-right"><button onClick={() => { setS({ takeProfitPct: o.tp, stopLossPct: o.sl }); setBt(o); setTab("build"); }} className="text-xs text-accent-2">Use</button></td></tr>)}</tbody></table>}
        </section>
      )}
      {tab === "versions" && (
        <section className="surface relative z-10 mt-4 rounded-2xl p-4">
          {(saved.data?.strategies ?? []).map((st: any) => <div key={st.id} className="mb-3"><div className="text-sm font-semibold">{st.name}</div>{(st.versions ?? []).map((v: any) => <button key={v.version} onClick={() => { setName(st.name); setCfg({ ...DEFAULT, ...v.config }); backtest({ ...DEFAULT, ...v.config }); setTab("build"); }} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-panel-2"><span className="font-medium">v{v.version}</span><span className="text-xs text-muted">{v.note ?? ""}</span><span className={cx("num ml-auto", toneOf(Number(v.ret)))}>{v.ret != null ? fmtPct(Number(v.ret)) : "—"}</span><span className="text-[11px] text-faint">{ago(v.created_at)}</span></button>)}</div>)}
          {!(saved.data?.strategies ?? []).length && <p className="text-sm text-muted">No saved strategies yet.</p>}
        </section>
      )}
      {tab === "deploy" && (
        <section className="surface relative z-10 mt-4 max-w-xl rounded-2xl p-4 text-sm">
          <p className="text-muted">Deploying creates a paper trading agent with this strategy, its risk limits and a daily loss cap from Max Drawdown. It starts stopped so you can review it.</p>
          <label className="mt-3 block"><span className="text-xs text-muted">Capital for the agent ($)</span><input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className={cx(field, "mt-1 w-full")} /></label>
          <button onClick={doDeploy} className="mt-3 flex h-10 items-center gap-2 rounded-xl bg-grad px-4 font-semibold"><Rocket className="size-4" /> Deploy to paper</button>
        </section>
      )}

      <div className="surface relative z-10 mt-4 flex flex-wrap items-center gap-3 rounded-2xl p-3">
        <Target className="ml-1 size-5 text-muted" />
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-56 bg-transparent text-[15px] font-semibold outline-none" aria-label="Strategy name" /><span className="-ml-2 text-[15px] font-semibold">v{latestVersion + 1}</span>
        {bt && <span className="flex items-center gap-1.5 rounded-full border border-up/30 bg-up-soft px-2.5 py-1 text-[11px] text-up"><span className="size-1.5 rounded-full bg-up" /> Backtested</span>}
        {bt && <span className={cx("rounded-full border px-2.5 py-1 text-[11px]", toneOf(bt.returnPct), "border-line-2")}>{fmtPct(bt.returnPct)} ({bt.years >= 1 ? `${bt.years.toFixed(0)}y` : `${Math.round(bt.years * 365)}d`})</span>}
        {bt && !bt.ddBreached && <span className="flex items-center gap-1 rounded-full border border-up/30 px-2.5 py-1 text-[11px] text-up">✓ Ready to Deploy</span>}
        {bt?.ddBreached && <span className="rounded-full border border-warn/30 bg-warn-soft px-2.5 py-1 text-[11px] text-warn">Drawdown above your {cfg.maxDrawdownPct}% limit</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => save()} className="flex h-11 items-center gap-2 rounded-xl border border-line-2 px-4 text-sm hover:border-accent/40"><Save className="size-4" /> Save Version</button>
          <button onClick={() => { setName(`${name} (copy)`); toast("Cloned: save it to keep a separate history", "neutral"); }} className="flex h-11 items-center gap-2 rounded-xl border border-line-2 px-4 text-sm hover:border-accent/40"><Copy className="size-4" /> Clone</button>
          <button onClick={() => setDeployOpen(true)} disabled={!bt} className="flex h-11 items-center gap-2 rounded-xl bg-grad px-5 text-sm font-semibold disabled:opacity-50"><Rocket className="size-4" /> Deploy Strategy <ArrowUpRight className="size-4" /></button>
        </div>
      </div>
      <Modal open={deployOpen} onClose={() => setDeployOpen(false)} title={`Deploy ${name}`}>
        <div className="space-y-3 text-sm"><p className="text-muted">Creates a paper agent ({cfg.asset}, {KINDS.find(([k]) => k === s.kind)?.[1]}) that starts stopped. Live deployment stays locked.</p>
          <label className="block"><span className="text-xs text-muted">Capital ($)</span><input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className={cx(field, "mt-1 w-full")} /></label>
          <div className="flex justify-end"><button onClick={doDeploy} className="flex h-10 items-center gap-2 rounded-xl bg-grad px-4 font-semibold"><Rocket className="size-4" /> Deploy to paper</button></div></div>
      </Modal>
    </div>
  );
}

function Block({ icon: I, tone, title, sub, on, toggle, children }: { icon: any; tone: string; title: string; sub: string; on: boolean; toggle: () => void; children: React.ReactNode }) {
  return (
    <div className={cx("rounded-xl border border-line bg-bg-2/50 p-3", !on && "opacity-50")}>
      <div className="mb-2.5 flex items-center gap-3"><span className={cx("flex size-9 items-center justify-center rounded-lg border border-line-2", tone)}><I className="size-4" /></span><div className="flex-1"><div className="text-[14px] font-semibold">{title}</div><div className="text-[11.5px] text-muted">{sub}</div></div>
        <button onClick={toggle} role="switch" aria-checked={on} className={cx("relative h-6 w-11 rounded-full transition-colors", on ? "bg-[#e9e1d2]" : "bg-panel-2 ring-1 ring-line")}><span className={cx("absolute top-1 size-4 rounded-full transition-all", on ? "left-6 bg-[#1a1309]" : "left-1 bg-muted")} /></button>
        <MoreVertical className="size-4 text-muted" /></div>
      {children}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: React.ReactNode }) { return <div className="rounded-lg border border-line-2 bg-panel-2/60 px-2.5 py-1.5"><div className="text-[11px] text-muted">{label}</div><div className="mt-0.5 text-[13px]">{value}</div></div>; }
function Kpi({ label, value, tone, big }: { label: string; value: string; tone?: string; big?: boolean }) { return <div className="border-r border-line/60 px-1 last:border-0"><div className="text-[11.5px] text-muted">{label}</div><div className={cx("num mt-0.5 font-semibold", big ? "text-[1.6rem]" : "text-[1.3rem]", tone)}>{value}</div></div>; }
function Equity({ points, start }: { points: { t: number; v: number }[]; start: number }) {
  if (!points?.length) return null;
  const W = 760, H = 200, pct = points.map((p) => ((p.v - start) / start) * 100), min = Math.min(0, ...pct), max = Math.max(0, ...pct), span = max - min || 1;
  const x = (i: number) => 40 + (i / Math.max(1, points.length - 1)) * (W - 50), y = (v: number) => 8 + (1 - (v - min) / span) * (H - 30);
  const d = pct.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" "), last = pct[pct.length - 1], c = last >= 0 ? "var(--up)" : "var(--down)";
  const ticks = [min, min + span / 3, min + (2 * span) / 3, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full">
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
  return <div className="mt-3 flex h-[200px] items-center gap-px">{r.map((v, i) => <span key={i} className={cx("flex-1", v >= 0 ? "self-end bg-up/70" : "self-start bg-down/70")} style={{ height: `${(Math.abs(v) / mx) * 50}%`, marginTop: v >= 0 ? 0 : "100px", marginBottom: v >= 0 ? "100px" : 0 }} />)}</div>;
}
function Dist({ trades }: { trades: any[] }) {
  const p = trades.filter((t) => t.pnl != null).map((t) => t.pnl as number);
  if (!p.length) return <p className="py-10 text-center text-xs text-muted">No closed trades.</p>;
  const lo = Math.min(...p), hi = Math.max(...p), n = 16, w = (hi - lo) / n || 1, bins = Array(n).fill(0);
  for (const v of p) bins[Math.min(n - 1, Math.floor((v - lo) / w))]++;
  const mx = Math.max(...bins);
  return <div className="mt-3 flex h-[200px] items-end gap-1">{bins.map((b, i) => <span key={i} title={`${(lo + i * w).toFixed(1)} → ${(lo + (i + 1) * w).toFixed(1)}: ${b}`} className={cx("flex-1 rounded-t", lo + (i + 0.5) * w >= 0 ? "bg-up/70" : "bg-down/70")} style={{ height: `${(b / mx) * 100}%` }} />)}</div>;
}
