"use client";
import Link from "next/link";
import { useState } from "react";
import { LineChart, Download } from "lucide-react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { AreaChart, PageHead, GhostButton, fmtPct, fmtSigned, fmtUsd, toneOf } from "@/components/agents/common";

/** Agent Analytics (screen 10): individual / fleet comparison, net P&L, drawdown, cost, win rate, benchmark, trade logs. */
export default function Analytics() {
  const { data } = useApi<any>("/api/agents/analytics", { refreshMs: 60000 });
  const [view, setView] = useState<"agents" | "fleets" | "trades">("agents");
  const t = data?.total;
  function exportCsv() {
    const rows = [["time", "agent", "symbol", "side", "status", "qty", "price", "realized_pnl", "fees"], ...(data?.trades ?? []).map((x: any) => [x.created_at, x.agent, x.symbol, x.side, x.status, x.filled_quantity, x.avg_fill_price ?? "", x.realized_pnl, x.fees_usd])];
    const blob = new Blob([rows.map((r) => r.map((c: any) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "merod-agent-trades.csv"; a.click();
  }
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[220px] w-[60%] opacity-70" />
      <PageHead eyebrow="Merod Analytics" title="Agent" accent="Analytics" sub="Net P&L after fees, drawdown, Sharpe, profit factor and win rate for every agent and fleet. Paper results; backtests are labelled separately." right={<GhostButton onClick={exportCsv}><Download className="size-4" /> Export trades (CSV)</GhostButton>} />
      <div className="relative z-10 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[["Net P&L", <span key="p" className={toneOf(t?.pnl)}>{fmtSigned(t?.pnl)}</span>], ["Capital", fmtUsd(t?.capital, 0)], ["Return", <span key="r" className={toneOf(t?.pnl)}>{t?.capital ? fmtPct((t.pnl / t.capital) * 100) : "—"}</span>], ["Fees (cost)", fmtUsd(t?.fees)], ["Trades", t?.trades ?? 0]].map(([k, v]) => (
          <div key={k as string} className="surface rounded-xl px-3.5 py-2.5"><div className="text-[11px] text-muted">{k}</div><div className="num mt-1 text-[1.2rem] font-semibold">{v}</div></div>
        ))}
      </div>
      {(data?.benchmarks ?? []).length > 0 && <p className="relative z-10 mt-2 text-xs text-muted">Benchmarks (24h): {data.benchmarks.map((b: any) => <span key={b.symbol} className="mr-3">{b.symbol} <b className={toneOf(b.change24h)}>{fmtPct(b.change24h)}</b></span>)}</p>}
      <div className="relative z-10 mt-4 flex gap-1 rounded-2xl border border-line bg-panel/60 p-1 sm:w-fit">
        {([["agents", "Agents"], ["fleets", "Fleets"], ["trades", "Trade log"]] as const).map(([k, l]) => <button key={k} onClick={() => setView(k)} className={cx("rounded-xl px-4 py-2 text-[13px]", view === k ? "nav-active" : "text-muted")}>{l}</button>)}
      </div>
      <section className="surface relative z-10 mt-3 overflow-x-auto rounded-2xl">
        {view === "agents" && <table className="w-full min-w-[900px] text-sm"><thead className="text-left text-[11px] text-muted"><tr className="border-b border-line"><th className="px-4 py-2.5">Agent</th><th className="text-right">Capital</th><th className="text-right">Net P&L</th><th className="text-right">Return</th><th className="text-right">Max DD</th><th className="text-right">Sharpe</th><th className="text-right">Profit factor</th><th className="text-right">Win rate</th><th className="text-right">Trades</th><th className="text-right">Fees</th><th className="w-36 pr-4" /></tr></thead>
          <tbody>{(data?.agents ?? []).map((a: any) => <tr key={a.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-2"><Link href={`/agents/${a.id}`} className="font-medium hover:underline">{a.name}</Link><div className="text-[11px] text-muted">{a.role}</div></td><td className="num text-right">{fmtUsd(a.capital, 0)}</td><td className={cx("num text-right", toneOf(a.pnl))}>{fmtSigned(a.pnl)}</td><td className={cx("num text-right", toneOf(a.pnlPct))}>{fmtPct(a.pnlPct)}</td><td className="num text-right">{a.maxDrawdownPct.toFixed(1)}%</td><td className="num text-right">{a.sharpe == null ? "—" : a.sharpe.toFixed(2)}</td><td className="num text-right">{a.profitFactor == null ? "—" : a.profitFactor.toFixed(2)}</td><td className="num text-right">{a.winRate == null ? "—" : `${a.winRate.toFixed(0)}%`}</td><td className="num text-right">{a.trades}</td><td className="num text-right">{fmtUsd(a.fees)}</td><td className="pr-4"><AreaChart data={a.spark.map((p: any) => p.v)} height={26} up={a.pnl >= 0} /></td></tr>)}</tbody></table>}
        {view === "fleets" && <table className="w-full min-w-[640px] text-sm"><thead className="text-left text-[11px] text-muted"><tr className="border-b border-line"><th className="px-4 py-2.5">Fleet</th><th className="text-right">Agents</th><th className="text-right">Capital</th><th className="text-right">Net P&L</th><th className="text-right">Return</th><th className="text-right">Trades</th><th className="pr-4 text-right">Fees</th></tr></thead>
          <tbody>{(data?.fleets ?? []).map((f: any) => <tr key={f.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-2"><Link href={`/agents/fleets/${f.id}`} className="font-medium hover:underline">{f.name}</Link></td><td className="num text-right">{f.agents}</td><td className="num text-right">{fmtUsd(f.capital, 0)}</td><td className={cx("num text-right", toneOf(f.pnl))}>{fmtSigned(f.pnl)}</td><td className={cx("num text-right", toneOf(f.pnl))}>{f.capital ? fmtPct((f.pnl / f.capital) * 100) : "—"}</td><td className="num text-right">{f.trades}</td><td className="num pr-4 text-right">{fmtUsd(f.fees)}</td></tr>)}</tbody></table>}
        {view === "trades" && <table className="w-full min-w-[760px] text-sm"><thead className="text-left text-[11px] text-muted"><tr className="border-b border-line"><th className="px-4 py-2.5">Time</th><th>Agent</th><th>Asset</th><th>Side</th><th>Status</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Realised</th><th className="pr-4 text-right">Fees</th></tr></thead>
          <tbody>{(data?.trades ?? []).map((x: any) => <tr key={x.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-2 text-xs text-muted">{new Date(x.created_at).toLocaleString()}</td><td>{x.agent}</td><td>{x.symbol}</td><td className={x.side === "buy" ? "text-up" : "text-down"}>{x.side}</td><td className="text-xs">{x.status.replace("_", " ")}</td><td className="num text-right">{Number(x.filled_quantity).toPrecision(6)}</td><td className="num text-right">{x.avg_fill_price ? fmtUsd(Number(x.avg_fill_price)) : "—"}</td><td className={cx("num text-right", toneOf(Number(x.realized_pnl)))}>{x.side === "sell" ? fmtSigned(Number(x.realized_pnl)) : ""}</td><td className="num pr-4 text-right">{fmtUsd(Number(x.fees_usd))}</td></tr>)}</tbody></table>}
        {!data && <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted"><LineChart className="size-4" /> Loading…</div>}
      </section>
    </div>
  );
}
