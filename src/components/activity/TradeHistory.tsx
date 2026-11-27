"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";

const SOURCE: Record<string, string> = { manual: "You", prompt: "Ask Merod", shortcut: "Shortcut", bot: "Bot", agent: "Agent", auto: "Auto trading", modo: "Modo", copy: "Mimic", mimic: "Mimic", system: "Merod" };
const TITLE = { buy: "Purchase history", sell: "Sold", profit: "Profit" } as const;
const when = (t: string) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const qtyFmt = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : Number(n.toPrecision(6)).toString());
const priceFmt = (n: number) => (n >= 1 ? usd(n) : `$${Number(n.toPrecision(4))}`);

/** Every filled buy (purchase history), every sell (sold), or every sell that made money (profit), live. */
export function TradeHistory({ type, q }: { type: "buy" | "sell" | "profit"; q: string }) {
  const [book, setBook] = useState<"all" | "paper" | "live">("all");
  const { data, refresh, error } = useApi<any>(`/api/trade-history?type=${type}&limit=1000`, { refreshMs: 10_000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") refresh(); });
  const rows: any[] = useMemo(() => (data?.rows ?? []).filter((r: any) => (book === "all" || (book === "paper") === !!r.is_paper)
    && (!q || `${r.symbol} ${r.name} ${SOURCE[r.source] ?? r.source} ${r.account}`.toLowerCase().includes(q.toLowerCase()))), [data, book, q]);
  const value = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
  const pnl = rows.reduce((s, r) => s + Number(r.realized_pnl ?? 0), 0);
  const wins = rows.filter((r) => Number(r.realized_pnl) > 0).length;
  const showPnl = type !== "buy";

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          [type === "buy" ? "Purchases" : type === "sell" ? "Sells" : "Profitable sells", rows.length.toLocaleString()],
          [type === "buy" ? "Total bought" : "Total sold", usd(value)],
          ...(showPnl ? [["Realized P&L", `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`, pnl >= 0 ? "text-up" : "text-down"], type === "sell" ? ["Winning sells", rows.length ? `${wins} of ${rows.length} (${Math.round((wins / rows.length) * 100)}%)` : "—"] : ["Average profit", rows.length ? `+${usd(pnl / rows.length)}` : "—", "text-up"]]
            : [["Coins & stocks", String(new Set(rows.map((r) => r.symbol)).size)], ["Average buy", rows.length ? usd(value / rows.length) : "—"]]),
        ].map(([l, v, cls]) => (
          <div key={l} className="surface rounded-xl px-3 py-2.5"><div className="text-[10.5px] uppercase tracking-wide text-faint">{l}</div><div className={cx("num text-[17px] font-semibold", cls)}>{v}</div></div>
        ))}
      </div>

      <section className="surface overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-[13px] font-semibold">{TITLE[type]} <span className="ml-1 text-[11px] font-normal text-faint">filled trades from every source · newest first</span></span>
          <div className="flex rounded-lg border border-line bg-bg/40 p-0.5 text-[11px]">
            {(["all", "paper", "live"] as const).map((b) => (
              <button key={b} onClick={() => setBook(b)} className={cx("rounded-md px-2 py-0.5", book === b ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>{b === "all" ? "All" : b === "paper" ? "Paper" : "Real money"}</button>
            ))}
          </div>
        </div>
        {error && <p className="p-8 text-center text-sm text-muted">{String((error as any)?.message ?? error)}</p>}
        {!error && !rows.length && <p className="p-10 text-center text-sm text-muted">{data ? (type === "profit" ? "No profitable sells yet." : type === "sell" ? "Nothing sold yet." : "No purchases yet.") : "Loading…"}</p>}
        {!!rows.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[10.5px] uppercase tracking-wide text-faint">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">When</th><th className="px-2 py-2 font-medium">Asset</th><th className="px-2 py-2 text-right font-medium">Quantity</th>
                  <th className="px-2 py-2 text-right font-medium">Price</th><th className="px-2 py-2 text-right font-medium">{type === "buy" ? "Cost" : "Proceeds"}</th>
                  {showPnl && <th className="px-2 py-2 text-right font-medium">Profit</th>}
                  <th className="px-2 py-2 font-medium">By</th><th className="px-4 py-2 font-medium">Account</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = Number(r.realized_pnl ?? 0);
                  return (
                    <tr key={r.id} className="border-b border-line/50 last:border-0 hover:bg-panel-2/40">
                      <td className="num whitespace-nowrap px-4 py-2 text-faint">{when(r.at)}</td>
                      <td className="px-2 py-2"><Link href={`/terminal/${r.asset_id}`} className="font-semibold hover:text-accent-2">{r.symbol}</Link><span className="ml-1.5 text-[11px] text-faint">{r.name}</span></td>
                      <td className="num px-2 py-2 text-right">{qtyFmt(Number(r.qty))}</td>
                      <td className="num px-2 py-2 text-right">{priceFmt(Number(r.price))}</td>
                      <td className="num px-2 py-2 text-right">{usd(Number(r.value))}</td>
                      {showPnl && <td className={cx("num px-2 py-2 text-right font-semibold", p > 0 ? "text-up" : p < 0 ? "text-down" : "text-faint")}>{p === 0 ? "—" : `${p > 0 ? "+" : "−"}${usd(Math.abs(p))}`}</td>}
                      <td className="px-2 py-2 text-muted">{SOURCE[r.source] ?? r.source}</td>
                      <td className="px-4 py-2"><span className="text-muted">{r.account}</span>{r.is_paper ? <span className="ml-1.5 rounded bg-warn-soft px-1 text-[9.5px] font-semibold text-warn">PAPER</span> : <span className="ml-1.5 rounded bg-down/15 px-1 text-[9.5px] font-semibold text-down">REAL</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="px-1 text-[10.5px] text-faint">Updates every 10 seconds and the moment an order fills. Profit is the realized gain recorded by the trading engine when you sell (after fees). Showing up to the latest 1,000 trades.</p>
    </div>
  );
}
