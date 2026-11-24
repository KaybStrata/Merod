"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Cpu, Power, Brain, FlaskConical, ShieldCheck, Sparkles, Clock, CheckCircle2, Settings2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { MimicTabs } from "@/components/MimicTabs";
import { Badge, Button, Card, Empty, Input, Pills, Select, Stat, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const LABEL: Record<string, string> = { merod: "Merod traders", thirdParty: "Outside traders", modo: "Modo", backtest: "Backtest", momentum: "Momentum" };
const pct = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${Number(x).toFixed(2)}%`);

/** Auto trading: Merod trades on its own from traders, outside traders, Modo, backtests and theoretical results. */
export default function AutoTradingPage() {
  const { user } = useShell();
  const toast = useToast();
  const { data, refresh } = useApi<any>(user.role === "super_admin" ? "/api/auto" : null, { refreshMs: 15_000 });
  const [busy, setBusy] = useState(false);
  if (user.role !== "super_admin") return <Empty icon={<Cpu className="size-6" />} title="Auto trading is for the platform owner">Ask the owner if you'd like access.</Empty>;

  const s = data?.settings, th = data?.theory, real = data?.real;
  async function patch(body: any, msg?: string) {
    setBusy(true);
    try { await api("/api/auto", { method: "PATCH", json: body }); await refresh(); if (msg) toast(msg, "up"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const proven = th && s && th.trades >= s.min_theory_trades && th.winRate >= Number(s.min_theory_win_rate);

  return (
    <div className="space-y-4">
      <MimicTabs />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Cpu className="size-6 text-accent-2" /> Auto Trading</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Merod trades on its own using five data points: what Merod traders are buying, what outside traders and wallets are doing, Modo's ideas, backtests on real price history, and momentum. Every decision is tested as a theoretical trade first; real orders only start once those results prove out, and every result teaches it which data points to trust.</p>
        </div>
        {/* The switch */}
        <button disabled={!s || busy} onClick={() => patch({ enabled: !s.enabled }, s.enabled ? "Auto trading is OFF" : "Auto trading is ON")}
          className={cx("flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors", s?.enabled ? "border-up/50 bg-up/10" : "border-line bg-panel")}>
          <Power className={cx("size-6", s?.enabled ? "text-up" : "text-faint")} />
          <span>
            <span className="block text-sm font-semibold">{s?.enabled ? "Auto trading ON" : "Auto trading OFF"}</span>
            <span className="block text-[11px] text-muted">{s?.enabled ? "Tap to stop immediately" : "Tap to start"}</span>
          </span>
          <span className={cx("relative ml-2 h-6 w-11 rounded-full transition-colors", s?.enabled ? "bg-up" : "bg-panel-2")}>
            <span className={cx("absolute top-0.5 size-5 rounded-full bg-white transition-all", s?.enabled ? "left-[22px]" : "left-0.5")} />
          </span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><Stat label="Theoretical trades" value={th ? `${th.wins}/${th.trades} wins` : "—"} sub={th?.trades ? `${Math.round(th.winRate * 100)}% · avg ${pct(th.avgReturnPct)}` : "No results yet"} /></Card>
        <Card><Stat label="Real trading" value={proven ? "Unlocked" : "Testing first"} sub={s ? `Needs ${s.min_theory_trades}+ theoretical trades at ${Math.round(Number(s.min_theory_win_rate) * 100)}%+` : ""} /></Card>
        <Card><Stat label="Real trades closed" value={real ? `${real.wins}/${real.trades} wins` : "—"} sub={real?.trades ? `total ${pct(real.totalReturnPct)}` : "None yet"} /></Card>
        <Card><Stat label="Last check" value={s?.last_run_at ? ago(s.last_run_at) : "never"} sub={s?.enabled ? "checks every minute" : "switched off"} /></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="What it has learned" icon={<Brain className="size-4 text-accent-2" />}>
          <p className="mb-2 text-xs text-muted">How much each data point counts. Weights move toward the ones that called theoretical and real trades right.</p>
          <div className="space-y-1.5">
            {s && Object.entries(s.weights).map(([k, v]: any) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-28 text-muted">{LABEL[k] ?? k}</span>
                <div className="h-1.5 flex-1 rounded-full bg-panel-2"><div className="h-1.5 rounded-full bg-accent-2" style={{ width: `${Math.min(100, (Number(v) / 2) * 100)}%` }} /></div>
                <span className="num w-10 text-right">×{Number(v).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="lg:col-span-2">{s && <SettingsCard s={s} busy={busy} onSave={(b) => patch(b, "Settings saved")} />}</div>
      </div>

      <Card title="Auto trades, explained by Modo" icon={<Sparkles className="size-4 text-accent-2" />}>
        {!data ? <div className="text-xs text-muted">Loading…</div> : data.trades.length === 0
          ? <Empty icon={<FlaskConical className="size-6" />} title="No auto trades yet">{s?.enabled ? "Merod is watching. It only acts when several data points agree." : "Turn auto trading on to start. The first trades are theoretical (no money moves)."}</Empty>
          : <div className="space-y-2">{data.trades.map((t: any) => <TradeCard key={t.id} t={t} />)}</div>}
      </Card>
      <p className="flex gap-1 text-[11px] text-faint"><ShieldCheck className="size-3 shrink-0" /> Every real order goes through Merod's risk checks. Real-money auto trades also need the platform's “automated real money” setting, otherwise they wait for your approval. Uses real market prices only. Past results don't guarantee future results.</p>
    </div>
  );
}

function TradeCard({ t }: { t: any }) {
  const [open, setOpen] = useState(false);
  const lines = String(t.explain_before).split("\n");
  return (
    <div className="rounded-xl border border-line bg-panel-2/40 p-3 text-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 font-semibold">
          <span className="text-up">BUY</span> {t.symbol}
          <Badge tone={t.mode === "real" ? "accent" : "info"}>{t.mode === "real" ? "real" : "theoretical"}</Badge>
          <Badge tone={t.status === "open" ? "warn" : t.status === "closed" ? (Number(t.return_pct) > 0 ? "up" : "down") : "neutral"}>{t.status === "closed" ? pct(Number(t.return_pct)) : t.status}</Badge>
        </span>
        <span className="text-[11px] text-muted">{Math.round(Number(t.confidence) * 100)}% confidence · {ago(t.created_at)}</span>
      </button>
      <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
        <Phase icon={<Brain className="size-3.5" />} title="Before" text={lines[0]} />
        <Phase icon={<Clock className="size-3.5" />} title="During" text={t.explain_during ?? "—"} />
        <Phase icon={<CheckCircle2 className="size-3.5" />} title="After" text={t.explain_after ?? (t.status === "open" ? "Still open." : "—")} />
      </div>
      {open
        ? <ul className="mt-2 space-y-0.5 text-[11px] text-muted">{lines.slice(1).map((l, i) => <li key={i}>{l}</li>)}</ul>
        : <button onClick={() => setOpen(true)} className="mt-1 text-[11px] text-accent-2">Show all data points</button>}
      {t.order_id && <div className="mt-1 text-[11px]"><Link className="text-muted underline" href={`/portfolio?order=${t.order_id}`}>Open order</Link></div>}
    </div>
  );
}
function Phase({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-2">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{icon} Modo · {title}</div>
      <p className="leading-snug text-muted">{text}</p>
    </div>
  );
}

function SettingsCard({ s, busy, onSave }: { s: any; busy: boolean; onSave: (b: any) => void }) {
  const accounts = useApi<any>("/api/wallet/accounts");
  const accts = (accounts.data?.accounts ?? []).filter((a: any) => a.status === "active" && a.kind !== "wallet");
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    setF({ accountId: s.account_id ?? "", markets: s.markets, tradeUsd: Number(s.trade_usd), maxDailyUsd: Number(s.max_daily_usd), maxOpen: Number(s.max_open),
      minConfidence: Math.round(Number(s.min_confidence) * 100), minTheoryTrades: Number(s.min_theory_trades), minTheoryWinRate: Math.round(Number(s.min_theory_win_rate) * 100),
      takeProfitPct: Number(s.take_profit_pct), stopLossPct: Number(s.stop_loss_pct) });
  }, [s.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Card title="Settings" icon={<Settings2 className="size-4 text-accent-2" />}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Select label="Trade in account" value={f.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">Paper account</option>
          {accts.filter((a: any) => a.kind !== "paper").map((a: any) => <option key={a.id} value={a.id}>{a.label} (real)</option>)}
        </Select>
        <div><div className="mb-1 text-xs text-muted">Markets</div><Pills size="sm" value={f.markets} onChange={(v) => set("markets", v)} options={[{ value: "both", label: "Both" }, { value: "crypto", label: "Crypto" }, { value: "stocks", label: "Stocks" }]} /></div>
        <Input label="$ per trade" type="number" min={1} value={f.tradeUsd} onChange={(e) => set("tradeUsd", Number(e.target.value))} />
        <Input label="Max $ per day" type="number" min={1} value={f.maxDailyUsd} onChange={(e) => set("maxDailyUsd", Number(e.target.value))} />
        <Input label="Max open trades" type="number" min={1} value={f.maxOpen} onChange={(e) => set("maxOpen", Number(e.target.value))} />
        <Input label="Min confidence (%)" type="number" min={30} max={95} value={f.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} />
        <Input label="Take profit (%)" type="number" min={0.1} value={f.takeProfitPct} onChange={(e) => set("takeProfitPct", Number(e.target.value))} />
        <Input label="Stop loss (%)" type="number" min={0.1} value={f.stopLossPct} onChange={(e) => set("stopLossPct", Number(e.target.value))} />
        <Input label="Theoretical trades before real" type="number" min={0} value={f.minTheoryTrades} onChange={(e) => set("minTheoryTrades", Number(e.target.value))} />
        <Input label="Theoretical win rate needed (%)" type="number" min={0} max={100} value={f.minTheoryWinRate} onChange={(e) => set("minTheoryWinRate", Number(e.target.value))} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-faint">Trades open as buys and close at take-profit, stop-loss, or after 24 hours.</p>
        <Button variant="primary" loading={busy} onClick={() => onSave({ accountId: f.accountId || null, markets: f.markets, tradeUsd: f.tradeUsd, maxDailyUsd: f.maxDailyUsd, maxOpen: f.maxOpen,
          minConfidence: f.minConfidence / 100, minTheoryTrades: f.minTheoryTrades, minTheoryWinRate: f.minTheoryWinRate / 100, takeProfitPct: f.takeProfitPct, stopLossPct: f.stopLossPct })}>Save</Button>
      </div>
    </Card>
  );
}
