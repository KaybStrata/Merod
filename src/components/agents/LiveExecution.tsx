"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Maximize2, MoreHorizontal, Brain, ArrowRight, Sparkles } from "lucide-react";
import { useApi } from "@/lib/api";
import { Skeleton, cx, useToast } from "@/components/ui";
import type { ChartMarker } from "@/components/terminal/charts";
import { agentAct } from "./AgentCard";
import { STATUS, fmtPct, fmtSigned, fmtUsd, toneOf } from "./common";

const CandleChart = dynamic(() => import("@/components/terminal/charts").then((m) => m.CandleChart), { ssr: false, loading: () => <Skeleton className="h-[230px]" /> });
const TFS = [["1m", "1m", 1, 240], ["5m", "5m", 1, 240], ["15m", "5m", 3, 600], ["1H", "1h", 1, 240], ["4H", "1h", 4, 800], ["1D", "1d", 1, 365]] as const;
function group(bars: any[], n: number) {
  if (n === 1) return bars;
  const out: any[] = [];
  for (let i = 0; i < bars.length; i += n) {
    const s = bars.slice(i, i + n);
    out.push({ time: s[0].time, open: s[0].open, close: s[s.length - 1].close, high: Math.max(...s.map((b) => b.high)), low: Math.min(...s.map((b) => b.low)), volume: s.reduce((t, b) => t + b.volume, 0) });
  }
  return out;
}

/** Selected agent: live chart with its trades, current position, latest thought and controls (Agent Workspace). */
export function LiveExecution({ agentId, onChanged }: { agentId: string; onChanged?: () => void }) {
  const d = useApi<any>(`/api/agents/${agentId}`, { refreshMs: 15000 });
  const toast = useToast();
  const [tf, setTf] = useState<(typeof TFS)[number]>(TFS[2]);
  const a = d.data?.agent;
  const asset = d.data?.assets?.[0];
  const pos = d.data?.positions?.find((p: any) => p.assetId === asset?.id) ?? d.data?.positions?.[0];
  const bars = useApi<any>(asset ? `/api/assets/${asset.id}/bars?tf=${tf[1]}&limit=${tf[3]}` : null, { refreshMs: 30000 });
  const chart = useMemo(() => group((bars.data?.bars ?? []).map((b: any) => ({ time: Number(b.time), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume })), tf[2]), [bars.data, tf]);
  const markers: ChartMarker[] = useMemo(() => (d.data?.orders ?? []).filter((o: any) => Number(o.filled_quantity) > 0 && o.symbol === asset?.symbol)
    .map((o: any) => ({ time: Math.floor(new Date(o.created_at).getTime() / 1000), side: o.side, kind: "bot" as const, label: `${a?.name}: ${o.side} @ ${Number(o.avg_fill_price).toPrecision(6)}` })), [d.data, asset, a]);
  const thought = (d.data?.events ?? []).find((e: any) => e.kind === "thought" || e.kind === "analysis" || e.kind === "decision");
  if (!a) return <Skeleton className="h-[320px] rounded-2xl" />;
  const last = chart.at(-1)?.close ?? (asset?.last_price ? Number(asset.last_price) : null);
  const first = chart[0]?.open;
  const st = STATUS[a.status] ?? STATUS.draft;
  async function act(action: string) { try { await agentAct(a.id, action); toast(`${a.name}: ${action.replace("_", " ")}`, "up"); d.refresh(); onChanged?.(); } catch (e: any) { toast(e.message, "down"); } }
  return (
    <section className="surface rounded-2xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Sparkles className="size-5 text-accent-2" />
        <h3 className="text-[1.15rem] font-semibold">{a.name} <span className="font-normal text-muted">— Live Execution</span></h3>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <span className={cx("flex items-center gap-1.5", st.text)}><span className={cx("size-1.5 rounded-full", st.dot)} />{st.label}</span>
          <span className="hidden text-muted sm:inline">|</span>
          <span className="hidden sm:inline">{["Observe", "Suggest", "Prepare", "Supervised (approval)", "Autonomous (Approved Rules)", "Autonomous"][a.autonomy_level - 1]}</span>
          <Link href={`/agents/${a.id}`} className="text-muted hover:text-text" aria-label="Open full agent"><Maximize2 className="size-4" /></Link>
          <Link href={`/agents/${a.id}?tab=settings`} className="text-muted hover:text-text" aria-label="Settings"><MoreHorizontal className="size-4" /></Link>
        </div>
      </header>
      <div className="grid gap-3 lg:grid-cols-[1.25fr_0.9fr_1fr]">
        <div className="rounded-xl border border-line bg-bg-2/60 p-3">
          {asset ? (
            <>
              <div className="flex items-baseline gap-3"><span className="font-semibold">{asset.symbol}{asset.asset_class === "crypto" ? "/USDT" : ""}</span><span className="num text-[1.05rem] font-semibold">{last != null ? fmtUsd(last) : "—"}</span>{first && last && <span className={cx("num text-xs", toneOf(last - first))}>{fmtPct(((last - first) / first) * 100)}</span>}</div>
              {chart.length > 1 ? <div className="mt-1"><CandleChart bars={chart} indicators={[]} height={230} compact markers={markers} priceLines={[...(pos?.takeProfit ? [{ price: pos.takeProfit, color: "#3ccf7e", title: "TP", dashed: true }] : []), ...(pos?.stopLoss ? [{ price: pos.stopLoss, color: "#f0506e", title: "SL", dashed: true }] : [])]} /></div>
                : <div className="flex h-[230px] items-center justify-center text-xs text-muted">{bars.data ? "No price history for this timeframe yet" : "Loading chart…"}</div>}
              <div className="mt-2 flex justify-between gap-1">
                {TFS.map((t) => <button key={t[0]} onClick={() => setTf(t)} className={cx("flex-1 rounded-lg py-1 text-xs", tf[0] === t[0] ? "nav-active" : "text-muted hover:text-text")}>{t[0]}</button>)}
              </div>
            </>
          ) : <div className="flex h-[270px] items-center justify-center text-center text-xs text-muted">This agent has no single asset to chart. {a.roleName} agents report in the activity feed.</div>}
        </div>
        <div className="rounded-xl border border-line bg-bg-2/60 p-3 text-[13px]">
          <div className="mb-2 flex items-center justify-between"><span className="font-semibold">Current Position</span>{pos && <span className="rounded-md bg-up-soft px-2 py-0.5 text-[11px] font-medium text-up">Long</span>}</div>
          {pos ? (
            <dl className="divide-y divide-line/70">
              {[["Entry", fmtUsd(pos.entry)], ["Current", fmtUsd(pos.price)], ["P&L", <span key="p" className={toneOf(pos.pnl)}>{fmtSigned(pos.pnl)} ({fmtPct(pos.pnlPct)})</span>], ["Size", `${Number(pos.qty).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${pos.symbol}`], ["Take Profit", pos.takeProfit ? fmtUsd(pos.takeProfit) : "—"], ["Stop Loss", pos.stopLoss ? fmtUsd(pos.stopLoss) : "—"]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between py-1.5"><dt className="text-muted">{k}</dt><dd className="num">{v}</dd></div>
              ))}
            </dl>
          ) : <p className="py-8 text-center text-xs text-muted">No open position. {a.metrics?.capital ? `${fmtUsd(a.metrics.capital, 0)} allocated, waiting for an entry signal.` : "This agent has no trading capital."}</p>}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex-1 rounded-xl border border-line bg-bg-2/60 p-3">
            <div className="mb-2 flex items-center gap-2"><Brain className="size-4 text-[#c9b6ff]" /><span className="font-semibold">Agent Thought (Live)</span></div>
            <p className="text-[13px] leading-relaxed text-text/90">{thought ? <>{thought.title}. <span className="text-muted">{thought.body}</span></> : "No thoughts yet: start the agent to see its reasoning summaries."}</p>
            <p className="mt-2 text-[10px] text-faint">Decision summaries and rule checks only, never private model chain-of-thought.</p>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <button onClick={() => act(a.status === "running" || a.status === "queued" ? "pause" : a.status === "paused" ? "resume" : "start")} className="h-9 rounded-lg border border-line-2 text-xs hover:border-accent/40">{a.status === "running" || a.status === "queued" ? "Pause" : a.status === "paused" ? "Resume" : "Start"}</button>
            <Link href={`/agents/${a.id}?tab=settings`} className="flex h-9 items-center justify-center rounded-lg border border-line-2 text-xs hover:border-accent/40">Adjust</Link>
            <button onClick={() => { if (confirm(`Close ${a.name}'s positions at market?`)) act("close_positions"); }} className="h-9 rounded-lg border border-line-2 text-xs hover:border-accent/40">Close</button>
            <Link href={`/agents/${a.id}`} className="flex h-9 items-center justify-center gap-1 rounded-lg bg-grad text-xs font-semibold">View <ArrowRight className="size-3.5" /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
