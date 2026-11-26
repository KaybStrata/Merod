"use client";
import Link from "next/link";
import { LineChart } from "lucide-react";
import { cx } from "@/components/ui";
import { AreaChart, fmtPct, fmtSigned, fmtUsd, toneOf } from "@/components/agents/common";

/** Agent / fleet comparison and the agent trade log (data from /api/agents/analytics). */
export function AgentAnalytics({ data, view }: { data: any; view: "agents" | "fleets" | "trades" }) {
  const t = data?.total;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[["Net P&L", <span key="p" className={toneOf(t?.pnl)}>{fmtSigned(t?.pnl)}</span>], ["Capital", fmtUsd(t?.capital, 0)], ["Return", <span key="r" className={toneOf(t?.pnl)}>{t?.capital ? fmtPct((t.pnl / t.capital) * 100) : "—"}</span>], ["Fees (cost)", fmtUsd(t?.fees)], ["Trades", t?.trades ?? 0]].map(([k, v]) => (
          <div key={k as string} className="surface rounded-xl px-3.5 py-2.5"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{k}</div><div className="num mt-1 text-[16px] font-semibold">{v}</div></div>
        ))}
      </div>
      <section className="surface overflow-x-auto rounded-xl">
        {view === "agents" && <table className="w-full min-w-[900px] text-[12.5px]"><thead className="text-left text-[10px] uppercase tracking-[0.1em] text-faint"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Agent</th><th className="text-right font-medium">Capital</th><th className="text-right font-medium">Net P&L</th><th className="text-right font-medium">Return</th><th className="text-right font-medium">Max DD</th><th className="text-right font-medium">Sharpe</th><th className="text-right font-medium">Profit factor</th><th className="text-right font-medium">Win rate</th><th className="text-right font-medium">Trades</th><th className="text-right font-medium">Fees</th><th className="w-36 pr-4" /></tr></thead>
          <tbody>{(data?.agents ?? []).map((a: any) => <tr key={a.id} className="border-b border-line/50 last:border-0"><td className="px-4 py-2"><Link href={`/agents/${a.id}`} className="font-medium hover:underline">{a.name}</Link><div className="text-[11px] text-faint">{a.role}</div></td><td className="num text-right">{fmtUsd(a.capital, 0)}</td><td className={cx("num text-right", toneOf(a.pnl))}>{fmtSigned(a.pnl)}</td><td className={cx("num text-right", toneOf(a.pnlPct))}>{fmtPct(a.pnlPct)}</td><td className="num text-right">{a.maxDrawdownPct.toFixed(1)}%</td><td className="num text-right">{a.sharpe == null ? "—" : a.sharpe.toFixed(2)}</td><td className="num text-right">{a.profitFactor == null ? "—" : a.profitFactor.toFixed(2)}</td><td className="num text-right">{a.winRate == null ? "—" : `${a.winRate.toFixed(0)}%`}</td><td className="num text-right">{a.trades}</td><td className="num text-right">{fmtUsd(a.fees)}</td><td className="pr-4"><AreaChart data={a.spark.map((p: any) => p.v)} height={26} up={a.pnl >= 0} /></td></tr>)}</tbody></table>}
        {view === "fleets" && <table className="w-full min-w-[640px] text-[12.5px]"><thead className="text-left text-[10px] uppercase tracking-[0.1em] text-faint"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Fleet</th><th className="text-right font-medium">Agents</th><th className="text-right font-medium">Capital</th><th className="text-right font-medium">Net P&L</th><th className="text-right font-medium">Return</th><th className="text-right font-medium">Trades</th><th className="pr-4 text-right font-medium">Fees</th></tr></thead>
          <tbody>{(data?.fleets ?? []).map((f: any) => <tr key={f.id} className="border-b border-line/50 last:border-0"><td className="px-4 py-2"><Link href={`/agents/fleets/${f.id}`} className="font-medium hover:underline">{f.name}</Link></td><td className="num text-right">{f.agents}</td><td className="num text-right">{fmtUsd(f.capital, 0)}</td><td className={cx("num text-right", toneOf(f.pnl))}>{fmtSigned(f.pnl)}</td><td className={cx("num text-right", toneOf(f.pnl))}>{f.capital ? fmtPct((f.pnl / f.capital) * 100) : "—"}</td><td className="num text-right">{f.trades}</td><td className="num pr-4 text-right">{fmtUsd(f.fees)}</td></tr>)}</tbody></table>}
        {view === "trades" && <table className="w-full min-w-[760px] text-[12.5px]"><thead className="text-left text-[10px] uppercase tracking-[0.1em] text-faint"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Time</th><th className="font-medium">Agent</th><th className="font-medium">Asset</th><th className="font-medium">Side</th><th className="font-medium">Status</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Price</th><th className="text-right font-medium">Realised</th><th className="pr-4 text-right font-medium">Fees</th></tr></thead>
          <tbody>{(data?.trades ?? []).map((x: any) => <tr key={x.id} className="border-b border-line/50 last:border-0"><td className="px-4 py-2 text-[11px] text-faint">{new Date(x.created_at).toLocaleString()}</td><td>{x.agent}</td><td>{x.symbol}</td><td className={x.side === "buy" ? "text-up" : "text-down"}>{x.side}</td><td className="text-[11px]">{x.status.replace("_", " ")}</td><td className="num text-right">{Number(x.filled_quantity).toPrecision(6)}</td><td className="num text-right">{x.avg_fill_price ? fmtUsd(Number(x.avg_fill_price)) : "—"}</td><td className={cx("num text-right", toneOf(Number(x.realized_pnl)))}>{x.side === "sell" ? fmtSigned(Number(x.realized_pnl)) : ""}</td><td className="num pr-4 text-right">{fmtUsd(Number(x.fees_usd))}</td></tr>)}</tbody></table>}
        {!data && <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted"><LineChart className="size-4" /> Loading…</div>}
        {data && view === "agents" && !(data.agents ?? []).length && <p className="p-8 text-center text-[12px] text-muted">No agents yet.</p>}
        {data && view === "fleets" && !(data.fleets ?? []).length && <p className="p-8 text-center text-[12px] text-muted">No fleets yet.</p>}
        {data && view === "trades" && !(data.trades ?? []).length && <p className="p-8 text-center text-[12px] text-muted">No agent trades yet.</p>}
      </section>
    </div>
  );
}

export function exportAgentCsv(data: any) {
  const rows = [["time", "agent", "symbol", "side", "status", "qty", "price", "realized_pnl", "fees"], ...(data?.trades ?? []).map((x: any) => [x.created_at, x.agent, x.symbol, x.side, x.status, x.filled_quantity, x.avg_fill_price ?? "", x.realized_pnl, x.fees_usd])];
  const blob = new Blob([rows.map((r) => r.map((c: any) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "merod-agent-trades.csv"; a.click();
}
