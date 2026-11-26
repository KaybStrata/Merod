"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";
import { price, pct, tone, usd } from "@/lib/format";
import { Gauge, Treemap } from "@/components/analytics/charts";

export type Market = "stocks" | "crypto" | "meme";
const STABLE = new Set(["USDC", "USDT", "DAI", "PYUSD", "USDE", "USDS", "FDUSD", "TUSD", "USDP", "EURC"]);

/** Markets overview (screen 15): market-cap heatmap coloured by 24h change, breadth sentiment, advancers/decliners, top movers. */
export function MarketsOverview({ market, onMarket }: { market: Market; onMarket: (m: Market) => void }) {
  const url = market === "stocks" ? "/api/assets?class=stocks&sort=cap&limit=200" : market === "crypto" ? "/api/assets?class=crypto&sort=cap&limit=150" : "/api/assets?category=meme&sort=volume&limit=150";
  const res = useApi<any>(url, { refreshMs: 30_000 });
  const assets: any[] = useMemo(() => (res.data?.assets ?? []).filter((a: any) => !STABLE.has(String(a.symbol).toUpperCase()) && !(a.risk_flags ?? []).includes("demo_data")), [res.data]);
  const weight = (a: any) => Number(market === "meme" ? (a.market_cap || a.volume_24h || a.liquidity_usd) : a.market_cap) || 0;
  const tiles = assets.slice(0, market === "stocks" ? 120 : 60).map((a) => ({ id: a.id, label: a.symbol, sub: a.name, value: weight(a), change: a.change_24h == null ? null : Number(a.change_24h), href: `/terminal/${a.id}` }));
  const withChange = assets.filter((a) => a.change_24h != null);
  const adv = withChange.filter((a) => Number(a.change_24h) > 0).length, dec = withChange.filter((a) => Number(a.change_24h) < 0).length, flat = withChange.length - adv - dec;
  // Breadth sentiment: cap-weighted share of advancing value (0 = all falling, 100 = all rising). Computed from real 24h moves.
  const sentiment = useMemo(() => {
    let up = 0, all = 0;
    for (const a of withChange) { const w = weight(a) || 1; all += w; if (Number(a.change_24h) > 0) up += w; }
    return all ? Math.round((up / all) * 100) : null;
  }, [withChange]); // eslint-disable-line react-hooks/exhaustive-deps
  const mood = sentiment == null ? "—" : sentiment < 20 ? "Extreme fear" : sentiment < 40 ? "Fear" : sentiment < 60 ? "Neutral" : sentiment < 80 ? "Greed" : "Extreme greed";
  const sorted = [...withChange].sort((a, b) => Number(b.change_24h) - Number(a.change_24h));
  const gainers = sorted.slice(0, 5), losers = sorted.slice(-5).reverse();
  const avg = withChange.length ? withChange.reduce((s, a) => s + Number(a.change_24h), 0) / withChange.length : null;
  const capSum = assets.reduce((s, a) => s + (Number(a.market_cap) || 0), 0);
  const volSum = assets.reduce((s, a) => s + (Number(a.volume_24h) || 0), 0);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="surface rounded-xl p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3 px-1">
          <div className="flex gap-0.5 rounded-lg border border-line bg-bg-2/60 p-0.5">
            {([["stocks", "Stocks"], ["crypto", "Crypto"], ["meme", "Meme"]] as const).map(([k, l]) => <button key={k} onClick={() => onMarket(k)} className={cx("rounded-md px-3 py-1 text-[12px]", market === k ? "bg-panel-2 text-text" : "text-faint hover:text-text")}>{l}</button>)}
          </div>
          <span className="text-[11.5px] text-muted">{market === "stocks" ? "US equities" : market === "crypto" ? "Crypto" : "Meme coins"} · sized by {market === "meme" ? "market cap / volume" : "market cap"} · 24h change</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-faint"><span className="h-2 w-6 rounded-sm" style={{ background: "linear-gradient(90deg,#c82323,#2a2723,#14a050)" }} /> −5% … +5%</span>
        </div>
        {!res.data ? <div className="h-[440px] animate-pulse rounded-lg bg-panel-2" /> : <Treemap items={tiles} height={440} />}
        <div className="mt-2 grid grid-cols-2 gap-3 px-1 text-[11.5px] sm:grid-cols-4">
          <div><span className="text-faint">Assets </span><span className="num">{assets.length}</span></div>
          <div><span className="text-faint">Avg 24h </span><span className={cx("num", tone(avg))}>{pct(avg)}</span></div>
          <div><span className="text-faint">Total cap </span><span className="num">{capSum ? usd(capSum, { compact: true }) : "—"}</span></div>
          <div><span className="text-faint">24h volume </span><span className="num">{volSum ? usd(volSum, { compact: true }) : "—"}</span></div>
        </div>
      </section>

      <aside className="space-y-3">
        <section className="surface rounded-xl p-3.5">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold">Fear & Greed</h2><span className="text-[10.5px] text-faint" title="Cap-weighted share of advancing assets in this market over 24h">breadth-based</span></div>
          <div className="mt-1 flex items-center gap-3">
            <Gauge value={sentiment} label="Sentiment" />
            <div><div className="num text-[30px] font-semibold leading-none">{sentiment ?? "—"}</div><div className={cx("mt-1 text-[12px] font-medium", sentiment == null ? "text-muted" : sentiment >= 60 ? "text-up" : sentiment < 40 ? "text-down" : "text-muted")}>{mood}</div></div>
          </div>
        </section>

        <section className="surface rounded-xl p-3.5">
          <h2 className="text-[13px] font-semibold">Market breadth</h2>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-panel-2">
            {withChange.length > 0 && <><span className="bg-up" style={{ width: `${(adv / withChange.length) * 100}%` }} /><span className="bg-faint" style={{ width: `${(flat / withChange.length) * 100}%` }} /><span className="bg-down" style={{ width: `${(dec / withChange.length) * 100}%` }} /></>}
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px]"><span className="text-up"><b className="num">{adv}</b> advancing</span><span className="text-faint">{flat} flat</span><span className="text-down"><b className="num">{dec}</b> declining</span></div>
        </section>

        <section className="surface rounded-xl">
          <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-semibold">Top movers</div>
          {[["Gainers", gainers], ["Losers", losers]].map(([label, list]: any) => (
            <div key={label}>
              <div className="px-3.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</div>
              {list.map((a: any) => (
                <Link key={a.id} href={`/terminal/${a.id}`} className="flex items-center gap-2 px-3.5 py-1.5 text-[12px] hover:bg-panel-2/50">
                  <span className="w-16 truncate font-semibold">{a.symbol}</span><span className="min-w-0 flex-1 truncate text-[11px] text-faint">{a.name}</span>
                  <span className="num text-muted">{price(a.last_price)}</span><span className={cx("num w-16 text-right", tone(a.change_24h))}>{pct(a.change_24h)}</span>
                </Link>
              ))}
              {!list.length && <p className="px-3.5 pb-2 text-[11.5px] text-muted">—</p>}
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
