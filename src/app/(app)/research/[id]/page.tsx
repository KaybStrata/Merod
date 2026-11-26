"use client";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { Star, ArrowUpRight, MoreHorizontal, Sparkles, Zap, TrendingUp, Smile, Layers, Calendar, Flag, Scale, Filter, ArrowRight, Search, ArrowLeftRight, FileText, AlertTriangle, Paperclip, Image as ImageIcon, SlidersHorizontal, Send, Info, ChevronDown } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { AssetIcon, Skeleton, Sparkline, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { fmtPct, fmtUsd, toneOf } from "@/components/agents/common";

const RANGES = [["1D", 2], ["5D", 6], ["1M", 31], ["3M", 92], ["6M", 183], ["YTD", -1], ["1Y", 366], ["5Y", 1830]] as const;
const big = (n: number | null | undefined) => n == null ? "—" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : fmtUsd(n, 0);
const ask = (t: string) => window.dispatchEvent(new CustomEvent("merod-prompt", { detail: t }));

/** Asset Research: thesis, AI market take, price/technical chart, sentiment, key metrics, news, catalysts, peers, screener, research copilot. */
export default function Research({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, refresh } = useApi<any>(`/api/research/${id}`, { refreshMs: 60000 });
  const toast = useToast();
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[6]);
  const [chartTab, setChartTab] = useState("Price");
  const [newsTab, setNewsTab] = useState("All");
  const [q, setQ] = useState("");
  const series = useMemo(() => {
    const h: any[] = data?.history ?? [];
    if (!h.length) return [];
    if (range[1] === -1) { const y = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000; return h.filter((p) => p.t >= y); }
    return h.slice(-range[1]);
  }, [data, range]);
  if (!data) return <Skeleton className="h-[600px] rounded-2xl" />;
  const a = data.asset, s = data.symbol ?? a.symbol;
  const isStock = a.asset_class !== "crypto";
  const open = isStock ? (() => { const d = new Date(); const ny = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })); const m = ny.getHours() * 60 + ny.getMinutes(); return ny.getDay() > 0 && ny.getDay() < 6 && m >= 570 && m < 960; })() : true;
  async function toggleWatch() { try { await api("/api/watchlists/items", { method: "POST", json: { assetId: id, action: "toggle" } }); refresh(); } catch (e: any) { toast(e.message, "down"); } }
  const news: any[] = (data.news ?? []).filter((n: any) => newsTab === "All" || n.kind === newsTab.replace(/s$/, "") || (newsTab === "News" && n.kind === "News"));
  const first = series[0]?.v, lastV = series.at(-1)?.v;
  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-4">
        <div className="eyebrow">Research <span className="mx-2">›</span> Asset Research</div>
        <div className="flex flex-wrap items-center gap-4">
          <AssetIcon symbol={a.symbol} size={64} logo={a.logo_url} />
          <div>
            <h1 className="text-[2.4rem] font-semibold leading-none tracking-tight">{a.symbol}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[15px] text-muted">{a.name}<span className="rounded-md border border-line-2 px-2 py-0.5 text-[11px]">{isStock ? (a.asset_class === "etf" ? "ETF" : "Stock") : "Crypto"}</span><span className="rounded-md border border-line-2 px-2 py-0.5 text-[11px]">{a.venue}</span></div>
          </div>
          <div className="ml-2">
            <div className="flex items-baseline gap-2"><span className="num text-[2rem] font-semibold">{fmtUsd(data.price)}</span><span className={cx("num text-[15px] font-medium", toneOf(data.change24h))}>{data.change24hUsd != null ? `${data.change24hUsd >= 0 ? "+" : "-"}${Math.abs(data.change24hUsd).toFixed(2)}` : ""} ({fmtPct(data.change24h)})</span></div>
            <div className="text-xs text-muted">As of {data.asOf ? new Date(data.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"} • {isStock ? (open ? "Market Open" : "Market Closed") : "24/7 market"} • {data.source ?? "no source"}</div>
          </div>
          {series.length > 1 && <Sparkline data={series.slice(-60).map((p: any) => p.v)} width={120} height={46} up={(lastV ?? 0) >= (first ?? 0)} />}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={toggleWatch} className="flex h-10 items-center gap-2 rounded-xl border border-line-2 px-3 text-sm hover:border-accent/40"><Star className={cx("size-4", data.watched && "fill-current text-accent-2")} /> {data.watched ? "In Watchlist" : "Watch"}<ChevronDown className="size-3.5 text-muted" /></button>
            <Link href={`/terminal/${id}`} className="flex h-10 items-center gap-1.5 rounded-xl bg-grad px-4 text-sm font-semibold">Trade <ArrowUpRight className="size-4" /></Link>
            <Link href={`/terminal/${id}`} className="flex size-10 items-center justify-center rounded-xl border border-line-2 text-muted hover:text-text" aria-label="More"><MoreHorizontal className="size-4" /></Link>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="surface rounded-2xl p-5">
            <h3 className="flex items-center gap-2 text-[1.1rem] font-semibold"><Sparkles className="size-5 text-accent-2" /> Investment Thesis</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-text/90">{data.thesis}</p>
            <div className="mt-3 flex flex-wrap gap-2">{data.tags.map((t: string) => <span key={t} className="rounded-full border border-line-2 px-3 py-1 text-[12px] capitalize text-muted">{t}</span>)}</div>
          </section>
          <section className="surface rounded-2xl p-5">
            <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[1.1rem] font-semibold"><Zap className="size-5 text-accent-2" /> AI Market Take</h3>{data.take && <span className={cx("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs", data.take === "Bullish" ? "bg-up-soft text-up" : data.take === "Bearish" ? "bg-down-soft text-down" : "bg-panel-2 text-muted")}><TrendingUp className="size-3.5" /> {data.take}</span>}</div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text/90">{data.takeText}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-line bg-bg-2/60 p-3" title={data.disclaimer}><div className="flex items-center gap-1 text-[11px] text-muted">Merod Score <Info className="size-3" /></div><div className="num mt-1 text-[1.4rem] font-semibold">{data.score ?? "—"} <span className="text-sm text-muted">/ 100</span></div></div>
              <div className="rounded-xl border border-line bg-bg-2/60 p-3"><div className="text-[11px] text-muted">Last 1 month</div><div className={cx("num mt-1 text-[1.4rem] font-semibold", toneOf(data.returns["1M"]))}>{fmtPct(data.returns["1M"], 1)}</div></div>
              <div className="rounded-xl border border-line bg-bg-2/60 p-3"><div className="text-[11px] text-muted">Last 3 months</div><div className={cx("num mt-1 text-[1.4rem] font-semibold", toneOf(data.returns["3M"]))}>{fmtPct(data.returns["3M"], 1)}</div></div>
            </div>
            <p className="mt-2 text-[10px] text-faint">Historical returns and a transparent data score, not price targets or advice.</p>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <section className="surface rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1 rounded-xl border border-line bg-bg-2/60 p-1 text-[12.5px]">{["Price", "Technical", "Flow"].map((t) => <button key={t} onClick={() => setChartTab(t)} className={cx("rounded-lg px-3 py-1", chartTab === t ? "nav-active" : "text-muted")}>{t}</button>)}</div>
              <div className="flex gap-0.5 text-[11.5px]">{RANGES.map((r) => <button key={r[0]} onClick={() => setRange(r)} className={cx("rounded-md px-2 py-1", range[0] === r[0] ? "nav-active" : "text-muted hover:text-text")}>{r[0]}</button>)}</div>
            </div>
            <PriceArea points={series} mode={chartTab} />
            {!series.length && <p className="text-center text-xs text-muted">No daily history recorded for this asset yet.</p>}
          </section>
          <div className="space-y-4">
            <section className="surface rounded-2xl p-4">
              <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Smile className="size-5" /> Sentiment</h3>
              <div className="mt-2 flex items-center gap-4">
                <Gauge value={data.sentiment} label={data.sentimentLabel} />
                <ul className="flex-1 space-y-1.5 text-[12.5px]">{data.scoreParts.map(([k, v]: [string, number], i: number) => <li key={k} className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted"><span className={cx("size-2 rounded-full", ["bg-up", "bg-[#6aa8ff]", "bg-[#3ccf7e]", "bg-warn"][i % 4])} />{k}</span><span className="num font-medium">{v}</span></li>)}{!data.scoreParts.length && <li className="text-muted">No sentiment data yet.</li>}</ul>
              </div>
            </section>
            <section className="surface rounded-2xl p-4">
              <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Layers className="size-5" /> Key Metrics</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
                {[["Market Cap", big(data.metrics.marketCap)], ["24h Volume", big(data.metrics.volume24h)], ["52W High", fmtUsd(data.metrics.high52)], ["52W Low", fmtUsd(data.metrics.low52)], ["Volatility (ann.)", data.metrics.volatility == null ? "—" : `${data.metrics.volatility.toFixed(1)}%`], ["RSI (14h)", data.metrics.rsi == null ? "—" : data.metrics.rsi.toFixed(0)], ["1Y Return", <span key="y" className={toneOf(data.metrics.return1y)}>{fmtPct(data.metrics.return1y, 1)}</span>], [isStock ? "P/E · EPS" : "Liquidity", isStock ? <span key="pe" title="Needs a fundamentals data provider (not connected)">n/a</span> : big(data.metrics.liquidity)]].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="num">{v}</dd></div>
                ))}
              </dl>
            </section>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="surface rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Calendar className="size-5" /> Earnings & News</h3>
              <div className="flex gap-1 text-[11.5px]">{["All", "Earnings", "News", "Filings"].map((t) => <button key={t} onClick={() => setNewsTab(t)} className={cx("rounded-full px-2.5 py-1", newsTab === t ? "nav-active" : "text-muted")}>{t}</button>)}</div></div>
            <ol className="mt-2 space-y-1">
              {news.slice(0, 6).map((n: any) => (
                <li key={n.url}><a href={n.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-panel-2"><FileText className="mt-0.5 size-4 shrink-0 text-muted" /><span className="min-w-0 flex-1"><span className="line-clamp-1 block text-[12.5px] font-medium">{n.title}</span><span className="text-[11px] text-muted">{n.publishedAt ? new Date(n.publishedAt).toLocaleDateString() : ""} • {n.source}</span></span>
                  <span className={cx("shrink-0 rounded-md px-2 py-0.5 text-[10.5px]", n.tone === "Positive" ? "bg-up-soft text-up" : n.tone === "Negative" ? "bg-down-soft text-down" : "bg-panel-2 text-muted")}>{n.tone}</span></a></li>
              ))}
              {!news.length && <li className="py-4 text-center text-xs text-muted">No recent headlines found in Merod&apos;s public feeds.</li>}
            </ol>
          </section>
          <section className="surface rounded-2xl p-4">
            <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Flag className="size-5" /> Catalysts</h3><Link href={`/news?q=${a.symbol}`} className="flex items-center gap-1 text-[11px] text-muted hover:text-text">View All <ArrowRight className="size-3" /></Link></div>
            <ol className="mt-2 space-y-1">
              {data.catalysts.map((c: any) => <li key={c.url} className="flex items-start gap-3 py-1.5"><span className="mt-1 size-2.5 shrink-0 rounded-full border border-muted" /><span className="min-w-0 flex-1"><span className="line-clamp-1 block text-[12.5px] font-medium">{c.title}</span><span className="text-[11px] text-muted">{c.kind} · {c.tone} · {c.source}</span></span><span className={cx("shrink-0 rounded-md px-2 py-0.5 text-[10.5px]", c.impact === "High" ? "bg-up-soft text-up" : "bg-panel-2 text-muted")}>{c.impact}</span></li>)}
              {!data.catalysts.length && <li className="py-4 text-center text-xs text-muted">No catalysts flagged from recent headlines.</li>}
            </ol>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
          <section className="surface rounded-2xl p-4">
            <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Scale className="size-5" /> Comparison</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.peers.slice(0, 4).map((p: any) => (
                <Link key={p.id} href={`/research/${p.id}`} className={cx("rounded-xl border p-3", p.id === id ? "gold-ring border-transparent" : "border-line hover:border-line-2")}>
                  <AssetIcon symbol={p.symbol} size={24} logo={p.logo_url} /><div className="mt-1.5 text-[13px] font-semibold">{p.symbol}</div><div className="num text-[13px]">{fmtUsd(p.last_price)}</div>
                  <div className="flex items-end justify-between"><span className={cx("num text-[11px]", toneOf(p.change_24h))}>{fmtPct(p.change_24h)}</span>{p.spark.length > 1 && <Sparkline data={p.spark} width={50} height={20} up={p.change_24h >= 0} fill={false} />}</div>
                </Link>
              ))}
            </div>
          </section>
          <section className="surface rounded-2xl p-4">
            <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Filter className="size-5" /> Screener: {data.category ? <span className="capitalize">{data.category}</span> : isStock ? "Stocks" : "Crypto"}</h3><Link href="/discover" className="flex items-center gap-1 text-[11px] text-muted hover:text-text">View Full Screener <ArrowRight className="size-3" /></Link></div>
            <table className="mt-2 w-full text-[12px]"><thead className="text-left text-[11px] text-muted"><tr><th className="py-1">Symbol</th><th>Name</th><th className="text-right">Price</th><th className="text-right">24h</th><th className="text-right">Market Cap</th><th className="text-right">1Y</th></tr></thead>
              <tbody>{data.peers.slice(0, 6).map((p: any) => <tr key={p.id} className="border-t border-line/60"><td className="py-1.5"><Link href={`/research/${p.id}`} className="flex items-center gap-1.5 font-semibold"><AssetIcon symbol={p.symbol} size={16} logo={p.logo_url} />{p.symbol}</Link></td><td className="max-w-[140px] truncate text-muted">{p.name}</td><td className="num text-right">{fmtUsd(p.last_price)}</td><td className={cx("num text-right", toneOf(p.change_24h))}>{fmtPct(p.change_24h)}</td><td className="num text-right">{big(p.market_cap)}</td><td className={cx("num text-right", toneOf(p.y1))}>{fmtPct(p.y1, 1)}</td></tr>)}</tbody></table>
          </section>
        </div>
      </div>

      <aside className="surface flex min-h-[600px] flex-col rounded-2xl p-4 2xl:sticky 2xl:top-[88px] 2xl:h-[calc(100vh-110px)]">
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[1.15rem] font-semibold"><Sparkles className="size-5 text-accent-2" /> Research Copilot</h3><span className="rounded-lg border border-line-2 px-2.5 py-1 text-[11px] text-muted">Merod AI</span></div>
        <p className="mt-1 text-[12.5px] text-muted">Your AI research partner for deep, multi-source analysis.</p>
        <div className="mt-3 space-y-2">
          {[[Search, `Deep dive on ${s}`, "Full research report, thesis, risks, and valuation", `Give me a deep dive on ${s}: thesis, risks and valuation using real data`],
            [ArrowLeftRight, `Compare ${s} vs ${data.peers.find((p: any) => p.id !== id)?.symbol ?? "peers"}`, "Fundamentals, growth, and positioning", `Compare ${s} vs ${data.peers.find((p: any) => p.id !== id)?.symbol ?? "its peers"}`],
            [FileText, "Analyze earnings", "Review last earnings and model next quarter", `Analyze ${s}'s latest earnings and what to watch next quarter`],
            [AlertTriangle, "Assess risks", "Regulatory, supply, competition, and valuation", `What are the main risks for ${s} right now?`],
            [Zap, "Build a trade idea", "Entry, target, stop, and reward/risk", `Build a trade idea for ${s} with entry, target, stop and reward/risk`]].map(([I, t, sub, prompt]: any) => (
            <button key={t} onClick={() => ask(prompt)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg-2/50 p-3 text-left hover:border-accent/40">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line-2"><I className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{t}</span><span className="block text-[11.5px] text-muted">{sub}</span></span><ArrowRight className="size-4 text-muted" />
            </button>
          ))}
        </div>
        <div className="my-4 flex items-center gap-3 text-[11px] text-muted"><span className="h-px flex-1 bg-line" />Suggested prompts<span className="h-px flex-1 bg-line" /></div>
        <div className="flex flex-wrap gap-2">{[`Is ${s} still a buy?`, "What are the key catalysts?", `${s} vs peers: which is better?`, `Explain ${s}'s trend`].map((p) => <button key={p} onClick={() => ask(p)} className="rounded-full border border-line-2 px-3 py-1.5 text-[11.5px] text-muted hover:text-text">{p}</button>)}</div>
        <div className="mt-auto pt-4">
          <div className="rounded-2xl border border-line-2 bg-bg-2/60 p-3">
            <div className="flex items-center gap-2"><Sparkles className="size-4 text-accent-2" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { ask(`${q} (${s})`); setQ(""); } }} maxLength={8000} placeholder={`Ask Merod about ${s}…`} className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted" /></div>
            <div className="mt-3 flex items-center gap-2">
              <button disabled title="Attachments aren't available yet" className="flex size-8 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><Paperclip className="size-3.5" /></button>
              <button disabled title="Image input isn't available yet" className="flex size-8 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><ImageIcon className="size-3.5" /></button>
              <Link href={`/terminal/${id}`} title="Open the full terminal" className="flex size-8 items-center justify-center rounded-full border border-line-2 text-muted"><SlidersHorizontal className="size-3.5" /></Link>
              <span className="ml-auto text-[10.5px] text-faint">{q.length} / 8,000</span>
              <button onClick={() => { if (q.trim()) { ask(`${q} (${s})`); setQ(""); } }} className="flex size-9 items-center justify-center rounded-xl bg-grad" aria-label="Ask"><Send className="size-4" /></button>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-faint">Answers appear in the Merod AI panel at the bottom of the screen, from real live and historical data with sources.</p>
        </div>
      </aside>
    </div>
  );
}

function PriceArea({ points, mode }: { points: { t: number; v: number; vol: number }[]; mode: string }) {
  if (points.length < 2) return <div className="h-[230px]" />;
  const W = 760, H = 230, vals = points.map((p) => p.v), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * (W - 50), y = (v: number) => 10 + (1 - (v - min) / span) * (H - 60);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const vmax = Math.max(1, ...points.map((p) => p.vol));
  const up = vals[vals.length - 1] >= vals[0], c = up ? "var(--up)" : "var(--down)";
  const sma = mode === "Technical" ? points.map((_, i) => { const s = vals.slice(Math.max(0, i - 19), i + 1); return s.reduce((a, b) => a + b, 0) / s.length; }) : null;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);
  const labels = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => points[Math.round(f * (points.length - 1))]);
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-2 w-full">
      <defs><linearGradient id="pa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity="0.35" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      {ticks.map((t) => <g key={t}><line x1={0} x2={W - 50} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 4" /><text x={W - 44} y={y(t) + 3} fontSize="10" fill="var(--muted)">{t >= 1000 ? t.toFixed(0) : t.toPrecision(4)}</text></g>)}
      {mode !== "Flow" && <><path d={`${d} L${x(points.length - 1)} ${H - 50} L0 ${H - 50} Z`} fill="url(#pa)" /><path d={d} fill="none" stroke={c} strokeWidth="1.8" /></>}
      {sma && <path d={sma.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="#d6b37a" strokeWidth="1.2" strokeDasharray="4 3" />}
      {points.map((p, i) => <rect key={i} x={x(i)} y={H - 10 - (p.vol / vmax) * (mode === "Flow" ? 150 : 34)} width={Math.max(1, (W - 50) / points.length - 0.6)} height={(p.vol / vmax) * (mode === "Flow" ? 150 : 34)} fill="var(--line-2)" />)}
      <rect x={W - 50} y={y(vals[vals.length - 1]) - 8} width={46} height={16} rx={4} fill={c} /><text x={W - 27} y={y(vals[vals.length - 1]) + 4} fontSize="10" textAnchor="middle" fill="#0a0908" fontWeight="600">{vals[vals.length - 1].toPrecision(5)}</text>
      {labels.map((p, i) => <text key={i} x={x(Math.round([0, 0.2, 0.4, 0.6, 0.8, 1][i] * (points.length - 1)))} y={H + 14} fontSize="10" fill="var(--muted)" textAnchor={i === 0 ? "start" : i === 5 ? "end" : "middle"}>{new Date(p.t * 1000).toLocaleDateString([], { month: "short", day: points.length < 40 ? "numeric" : undefined, year: points.length > 400 ? "2-digit" : undefined })}</text>)}
    </svg>
  );
}
function Gauge({ value, label }: { value: number | null; label: string }) {
  const v = value ?? 0, r = 46, c = Math.PI * r, off = c - (v / 100) * c;
  return (
    <div className="relative w-[120px] shrink-0">
      <svg viewBox="0 0 120 70" className="w-full"><path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke="var(--line-2)" strokeWidth="9" strokeLinecap="round" /><path d="M14 62 A46 46 0 0 1 106 62" fill="none" stroke={v >= 60 ? "var(--up)" : v <= 40 ? "var(--down)" : "var(--warn)"} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} /></svg>
      <div className="absolute inset-x-0 top-6 text-center"><div className="num text-[1.6rem] font-semibold leading-none">{value ?? "—"}</div><div className="text-[11px] text-muted">{label}</div></div>
    </div>
  );
}
