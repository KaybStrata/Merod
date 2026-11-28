"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Plus, ArrowRight } from "lucide-react";
import { useApi } from "@/lib/api";
import { usePageTitle, useRealtime } from "@/components/shell/context";
import { AssetIcon, cx } from "@/components/ui";
import { usd, price, pct, qty, tone } from "@/lib/format";
import { Donut, EquityChart, PnlCalendar, RangePills, rangeSeconds, toPoints } from "@/components/analytics/charts";
import { AgentAnalytics, exportAgentCsv } from "@/components/analytics/AgentAnalytics";

type View = "portfolio" | "agents" | "fleets" | "trades";
const SLEEVE_COLORS = { Stocks: "#3ccf7e", Crypto: "#d6b37a", Meme: "#b9a3f0", Cash: "#6f6a60" } as const;
const isMeme = (p: any) => p.asset_class === "crypto" && p.venue === "solana" && !["SOL", "USDC", "USDT", "JUP", "WSOL"].includes(p.symbol);

/** Portfolio performance (screen 08): value, chart, allocation sleeves, P&L calendar, holdings, attribution; plus agent analytics tabs. */
export default function Analytics() {
  usePageTitle({ section: "Insight · Analytics", title: "Portfolio performance", accent: "performance" });
  const [view, setView] = useState<View>("portfolio");
  const [book, setBook] = useState<"paper" | "live">("paper");
  const [rng, setRng] = useState("1M");
  const port = useApi<any>("/api/portfolio", { refreshMs: 20_000 });
  const hist = useApi<any>(`/api/portfolio/history?seconds=${rangeSeconds(rng)}`, { refreshMs: rng === "1D" ? 30_000 : 120_000 });
  const cal = useApi<any>(`/api/portfolio/history?seconds=${60 * 86_400}`, { refreshMs: 300_000 });
  const agents = useApi<any>("/api/agents/analytics", { refreshMs: 60_000 });
  useRealtime((e) => { if (e.type === "fill") port.refresh(); });

  const s = port.data?.[book];
  const pts = toPoints(hist.data?.points);
  const chg = pts.length > 1 ? pts[pts.length - 1].value - pts[0].value : null;
  const chgPct = chg != null && pts[0].value ? (chg / pts[0].value) * 100 : null;
  const positions = useMemo(() => (port.data?.positions ?? []).filter((p: any) => Number(p.quantity) > 0 && p.is_paper === (book === "paper")), [port.data, book]);
  const sleeves = useMemo(() => {
    const v = { Stocks: 0, Crypto: 0, Meme: 0, Cash: Number(s?.cash ?? 0) };
    for (const p of positions) { const mv = Number(p.market_value ?? 0); if (p.asset_class !== "crypto") v.Stocks += mv; else if (isMeme(p)) v.Meme += mv; else v.Crypto += mv; }
    return (Object.keys(v) as (keyof typeof v)[]).map((k) => ({ label: k, value: v[k], color: SLEEVE_COLORS[k] }));
  }, [positions, s]);
  const total = sleeves.reduce((a, b) => a + Math.max(b.value, 0), 0);
  const active = sleeves.filter((x) => x.value > 0).length;
  const days = useMemo(() => {
    const p = toPoints(cal.data?.points);
    const byDay = new Map<string, number>();
    for (const x of p) { const d = new Date(x.time * (x.time < 1e12 ? 1000 : 1)); byDay.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, x.value); }
    const keys = [...byDay.keys()].sort();
    return keys.slice(1).map((k, i) => ({ date: k, pnl: byDay.get(k)! - byDay.get(keys[i])! })).slice(-35);
  }, [cal.data]);
  const attribution = (port.data?.performance?.bySource ?? []).filter((r: any) => r.is_paper === (book === "paper"));
  const attrMax = Math.max(1, ...attribution.map((r: any) => Math.abs(Number(r.realized_pnl))));
  const bench = agents.data?.benchmarks ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-lg border border-line bg-panel/60 p-0.5">
          {([["portfolio", "Portfolio"], ["agents", "AI bots"], ["fleets", "Fleets"], ["trades", "AI bot trade log"]] as const).map(([k, l]) => <button key={k} onClick={() => setView(k)} className={cx("rounded-md px-3 py-1 text-[12px]", view === k ? "nav-active" : "text-muted hover:text-text")}>{l}</button>)}
        </div>
        {view === "portfolio" && <div className="flex gap-0.5 rounded-lg border border-line bg-panel/60 p-0.5">{(["paper", "live"] as const).map((b) => <button key={b} onClick={() => setBook(b)} className={cx("rounded-md px-3 py-1 text-[12px]", book === b ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>{b === "paper" ? "Paper" : "Live"}</button>)}</div>}
        <div className="ml-auto flex items-center gap-2">
          {view === "portfolio" ? <RangePills value={rng} onChange={setRng} /> : <button onClick={() => exportAgentCsv(agents.data)} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] text-muted hover:text-text"><Download className="size-3.5" /> Export CSV</button>}
          <Link href="/wallet" className="flex h-8 items-center gap-1.5 rounded-lg bg-grad px-3 text-[12px] font-semibold text-bg"><Plus className="size-3.5" /> Deposit</Link>
        </div>
      </div>

      {view !== "portfolio" ? <AgentAnalytics data={agents.data} view={view} /> : (
        <>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="surface rounded-xl p-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Total value · {book}</div>
                  {s ? <div className="num mt-0.5 text-[32px] font-semibold leading-none tracking-tight">{usd(s.total)}</div> : <div className="mt-1 h-9 w-56 animate-pulse rounded bg-panel-2" />}
                  {s && <div className="mt-1.5 flex flex-wrap gap-2 text-[12px]">
                    {chg != null && <span className={cx("num rounded-md px-1.5 py-0.5", chg >= 0 ? "bg-up-soft text-up" : "bg-down-soft text-down")}>{usd(chg, { sign: true })} ({pct(chgPct)}) · {rng}</span>}
                    <span className={cx("num", tone(s.lifetimePnl))}>{usd(s.lifetimePnl, { sign: true })} all time</span>
                  </div>}
                </div>
                <div className="grid grid-cols-3 gap-5 text-right sm:grid-cols-5">
                  {[["Today", usd(s?.dailyPnl, { sign: true }), tone(s?.dailyPnl)], ["Unrealized", usd(s?.unrealized, { sign: true }), tone(s?.unrealized)], ["Realized", usd(s?.realized, { sign: true }), tone(s?.realized)], ["Invested", usd(s?.invested), ""], ["Cash", usd(s?.cash), ""]].map(([k, v, c]) => (
                    <div key={k}><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{k}</div><div className={cx("num mt-0.5 text-[13.5px] font-semibold", c)}>{s ? v : "—"}</div></div>
                  ))}
                </div>
              </div>
              <EquityChart points={pts} height={230} className="mt-3" />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
                {hist.data?.estimated && <span>Estimated from current holdings × past prices.</span>}
                {bench.length > 0 && <span>Benchmarks 24h: {bench.map((b: any) => <span key={b.symbol} className="mr-2">{b.symbol} <b className={tone(b.change24h)}>{pct(b.change24h)}</b></span>)}</span>}
              </div>
            </section>

            <section className="surface rounded-xl p-4">
              <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">Allocation</h2><span className="text-[11px] text-faint">{positions.length} positions</span></div>
              <div className="mt-2 flex items-center gap-4">
                <Donut parts={sleeves} size={128} center={`${active} sleeve${active === 1 ? "" : "s"}`} sub={usd(total, { compact: true })} />
                <ul className="flex-1 space-y-2 text-[12px]">
                  {sleeves.map((x) => <li key={x.label} className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: x.color }} /><span className="text-muted">{x.label}</span><span className="num ml-auto">{total ? ((Math.max(x.value, 0) / total) * 100).toFixed(1) : "0.0"}%</span></li>)}
                </ul>
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-semibold">P&L calendar</h3><span className="text-[10.5px] text-faint">last {days.length} days</span></div>
                <PnlCalendar days={days} />
              </div>
            </section>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="surface overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5"><h2 className="text-[13px] font-semibold">Holdings</h2><Link href="/portfolio" className="flex items-center gap-1 text-[11px] text-muted hover:text-text">Orders & transactions <ArrowRight className="size-3" /></Link></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[12.5px]">
                  <thead className="text-left text-[10px] uppercase tracking-[0.1em] text-faint"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Asset</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Avg cost</th><th className="text-right font-medium">Price</th><th className="text-right font-medium">Value</th><th className="text-right font-medium">P&L</th><th className="text-right font-medium">P&L %</th><th className="px-4 font-medium">Weight</th><th className="pr-4 font-medium">Account</th></tr></thead>
                  <tbody>
                    {positions.map((p: any) => {
                      const up = Number(p.avg_cost) ? ((Number(p.last_price) - Number(p.avg_cost)) / Number(p.avg_cost)) * 100 : null;
                      const w = total ? (Number(p.market_value ?? 0) / total) * 100 : 0;
                      return (
                        <tr key={p.account_id + p.asset_id} className="border-b border-line/50 last:border-0 hover:bg-panel-2/50">
                          <td className="px-4 py-2"><Link href={`/terminal/${p.asset_id}`} className="flex items-center gap-2"><AssetIcon symbol={p.symbol} logo={p.logo_url} size={22} /><span className="font-semibold">{p.symbol}</span><span className="max-w-[140px] truncate text-[11px] text-faint">{p.name}</span></Link></td>
                          <td className="num text-right">{qty(p.quantity)}</td><td className="num text-right">{price(p.avg_cost)}</td><td className="num text-right">{price(p.last_price)}</td>
                          <td className="num text-right">{usd(p.market_value)}</td>
                          <td className={cx("num text-right", tone(p.unrealized_pnl))}>{usd(p.unrealized_pnl, { sign: true })}</td>
                          <td className={cx("num text-right", tone(up))}>{pct(up)}</td>
                          <td className="px-4"><span className="flex items-center gap-2"><span className="h-1 w-16 overflow-hidden rounded-full bg-panel-2"><span className="block h-full bg-accent-2" style={{ width: `${Math.min(w, 100)}%` }} /></span><span className="num text-[11px] text-muted">{w.toFixed(1)}%</span></span></td>
                          <td className="pr-4 text-[11px] text-faint">{p.account_label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {port.data && !positions.length && <p className="p-6 text-center text-[12px] text-muted">No {book} holdings yet.</p>}
              </div>
            </section>

            <section className="surface rounded-xl p-4">
              <h2 className="text-[13px] font-semibold">Attribution by source</h2>
              <p className="text-[11px] text-faint">Realized P&L by how each trade was placed.</p>
              <ul className="mt-3 space-y-2.5">
                {attribution.map((r: any) => {
                  const v = Number(r.realized_pnl);
                  return (
                    <li key={r.source} className="text-[12px]">
                      <div className="flex items-center justify-between"><span className="capitalize">{String(r.source).replace(/_/g, " ")}</span><span className={cx("num font-semibold", tone(v))}>{usd(v, { sign: true })}</span></div>
                      <div className="mt-1 flex items-center gap-2"><span className="h-1 flex-1 overflow-hidden rounded-full bg-panel-2"><span className={cx("block h-full rounded-full", v >= 0 ? "bg-up" : "bg-down")} style={{ width: `${(Math.abs(v) / attrMax) * 100}%` }} /></span><span className="num w-24 text-right text-[10.5px] text-faint">{r.trades} trades · {usd(r.volume, { compact: true })}</span></div>
                    </li>
                  );
                })}
                {port.data && !attribution.length && <li className="py-4 text-center text-[12px] text-muted">No filled trades yet.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
