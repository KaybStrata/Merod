"use client";
import { SectionTabs } from "@/components/SectionTabs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Globe2, Pause, Play, Plus, X, Search, Bitcoin, Building2, Waves, Radio } from "lucide-react";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, Card, Empty, Pills, Stat, cx } from "@/components/ui";
import { CRYPTO_VENUES, useCryptoTape, type FeedState, type WorldTrade } from "@/components/world/useCryptoTape";
import { compact, price, qty, usd } from "@/lib/format";

const DEFAULT_CRYPTO = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "PEPE", "SHIB", "BONK"];
const MIN_SIZES = [{ value: "0", label: "Any size" }, { value: "1000", label: "$1K+" }, { value: "10000", label: "$10K+" }, { value: "100000", label: "$100K+" }] as const;
const WHALE_USD = 100_000;
const WINDOW_MS = 60_000;
const MAX_ROWS = 400;

type StockStatus = { state: "off" | "connecting" | "live" | "error"; provider: string | null; feed: string | null; message?: string; tradesPerMin: number };
type Flow = { t: number; sym: string; cls: WorldTrade["cls"]; side: WorldTrade["side"]; usd: number };

const hhmmss = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const loadSyms = () => { try { const v = JSON.parse(localStorage.getItem("merod-world-crypto") ?? "null"); if (Array.isArray(v) && v.length) return v.map(String).slice(0, 40); } catch {} return DEFAULT_CRYPTO; };

function Dot({ state }: { state: FeedState | StockStatus["state"] }) {
  return <span className={cx("size-1.5 rounded-full", state === "live" ? "bg-up pulse-dot" : state === "connecting" ? "bg-warn pulse-dot" : state === "error" ? "bg-down" : "bg-faint")} />;
}

export default function WorldTradesPage() {
  const { connected } = useShell();
  const [cryptoSyms, setCryptoSyms] = useState<string[]>(DEFAULT_CRYPTO);
  const [adding, setAdding] = useState("");
  const [market, setMarket] = useState<"all" | "crypto" | "stock">("all");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [minUsd, setMinUsd] = useState<(typeof MIN_SIZES)[number]["value"]>("0");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [rows, setRows] = useState<WorldTrade[]>([]);
  const [stock, setStock] = useState<StockStatus | null>(null);
  const [tick, setTick] = useState(0);
  const flow = useRef<Flow[]>([]);
  const filters = useRef({ market, side, minUsd: +minUsd, search: "", paused });
  filters.current = { market, side, minUsd: +minUsd, search: search.trim().toUpperCase(), paused };

  useEffect(() => { setCryptoSyms(loadSyms()); }, []);
  const saveSyms = (next: string[]) => { setCryptoSyms(next); try { localStorage.setItem("merod-world-crypto", JSON.stringify(next)); } catch {} };

  /** Every trade feeds the 60-second flow stats; only trades matching the filters enter the tape. */
  const ingest = (batch: WorldTrade[]) => {
    const now = Date.now();
    for (const b of batch) flow.current.push({ t: now, sym: b.sym, cls: b.cls, side: b.side, usd: b.usd });
    if (flow.current.length > 60_000) flow.current = flow.current.slice(-30_000);
    const f = filters.current;
    if (f.paused) return;
    let keep = batch.filter((b) => (f.market === "all" || b.cls === f.market) && (f.side === "all" || b.side === f.side) && b.usd >= f.minUsd && (!f.search || b.sym.includes(f.search)));
    if (keep.length > 60) keep = keep.sort((a, b) => b.usd - a.usd).slice(0, 60).sort((a, b) => a.t - b.t);
    if (keep.length) setRows((r) => [...keep.reverse(), ...r].slice(0, MAX_ROWS));
  };

  const venues = useCryptoTape(cryptoSyms, ingest, market !== "stock");

  useRealtime((e) => {
    if (e.channel !== "world") return;
    if (e.type === "stock_status") setStock(e.payload);
    if (e.type === "stock_trades" && Array.isArray(e.payload)) {
      if (filters.current.market === "crypto") return;
      ingest(e.payload.map((p: any, i: number) => ({ id: `s${p.t}${i}${p.sym}`, sym: p.sym, cls: "stock", venue: p.venue, side: p.side, est: true, px: p.px, sz: p.sz, usd: p.usd, t: p.t })));
    }
  });

  // Refresh the rolling stats once a second.
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  const stats = useMemo(() => {
    const cutoff = Date.now() - WINDOW_MS;
    flow.current = flow.current.filter((x) => x.t >= cutoff);
    const win = flow.current.filter((x) => market === "all" || x.cls === market);
    let buy = 0, sell = 0;
    const per = new Map<string, { sym: string; cls: Flow["cls"]; buy: number; sell: number; n: number }>();
    for (const x of win) {
      if (x.side === "buy") buy += x.usd; else sell += x.usd;
      const k = `${x.cls}:${x.sym}`;
      const p = per.get(k) ?? { sym: x.sym, cls: x.cls, buy: 0, sell: 0, n: 0 };
      if (x.side === "buy") p.buy += x.usd; else p.sell += x.usd;
      p.n++;
      per.set(k, p);
    }
    const list = [...per.values()].sort((a, b) => b.buy + b.sell - (a.buy + a.sell));
    return { tps: win.length / (WINDOW_MS / 1000), buy, sell, symbols: list.slice(0, 12), count: win.length };
  }, [tick, market]); // eslint-disable-line react-hooks/exhaustive-deps

  const biggest = useMemo(() => rows.reduce<WorldTrade | null>((m, r) => (Date.now() - r.t < WINDOW_MS * 5 && (!m || r.usd > m.usd) ? r : m), null), [rows, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const buyPct = stats.buy + stats.sell > 0 ? (stats.buy / (stats.buy + stats.sell)) * 100 : 50;

  const addSymbol = () => {
    const s = adding.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (s && !cryptoSyms.includes(s)) saveSyms([...cryptoSyms, s]);
    setAdding("");
  };

  const stockState: StockStatus["state"] = !connected ? "off" : stock?.state ?? "connecting";
  const stockNote = !connected ? "Realtime connection offline — stock prints arrive through Merod's realtime server."
    : !stock ? "Waiting for the stock feed status…"
    : stock.state === "live" ? `Alpaca ${stock.feed?.toUpperCase()} feed · every US-listed symbol · ~${compact(stock.tradesPerMin)} prints/min`
    : stock.message ?? "Stock feed is not running.";

  return (
    <div className="space-y-4">
      <SectionTabs tabs={[{ href: "/activity", label: "My live activity", icon: Radio }, { href: "/world", label: "World trades", icon: Globe2 }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Globe2 className="size-6 text-accent-2" /> World Trades</h1>
          <p className="mt-1 text-sm text-muted">Real buys and sells happening right now across global crypto exchanges and US stock markets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pills value={market} onChange={setMarket} options={[{ value: "all", label: "All markets" }, { value: "crypto", label: "Crypto" }, { value: "stock", label: "Stocks" }]} />
          <button onClick={() => setPaused(!paused)} className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 text-sm">{paused ? <><Play className="size-4" /> Resume</> : <><Pause className="size-4" /> Pause</>}</button>
        </div>
      </div>

      {/* Feed health — always visible so nobody mistakes a quiet feed for a quiet market */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {market !== "stock" && CRYPTO_VENUES.map((v) => (
          <span key={v} className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-muted" title={venues[v] === "error" ? `${v} unreachable from your network (it may be blocked in your region) — retrying` : undefined}>
            <Dot state={venues[v]} /> {v}
          </span>
        ))}
        {market !== "crypto" && (
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-muted" title={stockNote}>
            <Dot state={stockState} /> US stocks
          </span>
        )}
        <Badge tone="up">Real market data</Badge>
        {market !== "crypto" && <Badge tone="info" title="Stock exchanges don't publish who initiated a trade. Merod estimates buy/sell with the tick rule: a print above the previous price counts as a buy, below as a sell.">Stock side = estimated</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Trades / second" value={<span className="num">{stats.tps.toFixed(1)}</span>} sub="last 60s, all watched symbols" /></Card>
        <Card><Stat label="Bought (60s)" value={<span className="num text-up">{usd(stats.buy, { compact: true })}</span>} sub="taker buys" /></Card>
        <Card><Stat label="Sold (60s)" value={<span className="num text-down">{usd(stats.sell, { compact: true })}</span>} sub="taker sells" /></Card>
        <Card><Stat label="Biggest recent trade" value={<span className="num">{biggest ? usd(biggest.usd, { compact: true }) : "—"}</span>} sub={biggest ? `${biggest.side === "buy" ? "Buy" : "Sell"} ${biggest.sym} · ${biggest.venue}` : "waiting…"} /></Card>
      </div>

      <Card pad>
        <div className="mb-1.5 flex justify-between text-xs text-muted"><span className="text-up">Buy pressure {buyPct.toFixed(0)}%</span><span className="text-down">Sell pressure {(100 - buyPct).toFixed(0)}%</span></div>
        <div className="flex h-2 overflow-hidden rounded-full bg-panel-2">
          <div className="bg-up transition-[width] duration-700" style={{ width: `${buyPct}%` }} />
          <div className="flex-1 bg-down" />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <Card title={<span className="flex items-center gap-2">Live tape {paused && <Badge tone="warn">paused</Badge>}</span>}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter symbol" className="h-8 w-32 rounded-lg border border-line bg-bg-2 pl-7 pr-2 text-xs outline-none focus:border-accent" />
              </div>
              <Pills size="sm" value={side} onChange={setSide} options={[{ value: "all", label: "All" }, { value: "buy", label: "Buys" }, { value: "sell", label: "Sells" }]} />
              <Pills size="sm" value={minUsd} onChange={setMinUsd} options={MIN_SIZES as any} />
            </div>
          }>
          {rows.length === 0 ? (
            <Empty icon={<Globe2 className="size-6" />} title="Connecting to world markets…">Trades appear here the moment they execute. If nothing shows, your filters may be too narrow, or an exchange may be blocked on your network.</Empty>
          ) : (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-panel text-left text-[11px] text-faint">
                  <tr><th className="py-1.5 pr-2 font-medium">Time</th><th className="pr-2 font-medium">Symbol</th><th className="pr-2 font-medium">Side</th><th className="pr-2 text-right font-medium">Price</th><th className="pr-2 text-right font-medium">Size</th><th className="pr-2 text-right font-medium">Value</th><th className="font-medium">Venue</th></tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {rows.map((r) => (
                    <tr key={r.id} className={cx("fade-up", r.usd >= WHALE_USD && (r.side === "buy" ? "bg-up-soft" : "bg-down-soft"))}>
                      <td className="num py-1 pr-2 text-faint">{hhmmss(r.t)}</td>
                      <td className="pr-2">
                        <button onClick={() => setSearch(r.sym)} className="flex items-center gap-1.5 font-medium hover:text-accent-2">
                          {r.cls === "crypto" ? <Bitcoin className="size-3.5 text-faint" /> : <Building2 className="size-3.5 text-faint" />}{r.sym}
                          {r.usd >= WHALE_USD && <Waves className="size-3.5 text-accent-2" aria-label="whale trade" />}
                        </button>
                      </td>
                      <td className={cx("pr-2 font-semibold", r.side === "buy" ? "text-up" : "text-down")}>{r.side === "buy" ? "BUY" : "SELL"}{r.est && <span className="ml-1 font-normal text-faint" title="Estimated with the tick rule">est.</span>}</td>
                      <td className="num pr-2 text-right">{price(r.px)}</td>
                      <td className="num pr-2 text-right text-muted">{qty(r.sz)}</td>
                      <td className={cx("num pr-2 text-right", r.usd >= WHALE_USD && "font-semibold")}>{usd(r.usd, { compact: r.usd >= 10_000 })}</td>
                      <td className="text-faint">{r.venue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Most traded · 60s">
            {stats.symbols.length === 0 ? <div className="text-xs text-muted">Waiting for trades…</div> : (
              <ul className="space-y-2">
                {stats.symbols.map((s) => {
                  const total = s.buy + s.sell, b = total ? (s.buy / total) * 100 : 50;
                  return (
                    <li key={`${s.cls}${s.sym}`}>
                      <button onClick={() => setSearch(s.sym)} className="w-full text-left">
                        <div className="flex items-center justify-between text-xs"><span className="font-medium">{s.sym} <span className="text-faint">{s.cls}</span></span><span className="num text-muted">{usd(total, { compact: true })} · {s.n}</span></div>
                        <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-panel-2"><div className="bg-up" style={{ width: `${b}%` }} /><div className="flex-1 bg-down" /></div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Crypto you're watching">
            <div className="flex flex-wrap gap-1.5">
              {cryptoSyms.map((s) => (
                <span key={s} className="flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs">
                  {s}<button onClick={() => saveSyms(cryptoSyms.filter((x) => x !== s))} aria-label={`Stop watching ${s}`} className="text-faint hover:text-down"><X className="size-3" /></button>
                </span>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addSymbol(); }} className="mt-3 flex gap-2">
              <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add any coin, e.g. WIF" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg-2 px-2 text-xs outline-none focus:border-accent" />
              <button className="flex h-8 items-center gap-1 rounded-lg bg-grad px-2.5 text-xs font-medium text-white"><Plus className="size-3.5" /> Add</button>
            </form>
            <p className="mt-2 text-[11px] text-faint">Streams every trade on Coinbase, Kraken and Binance (USD / USDT pairs). Coins a venue doesn&apos;t list are skipped there.</p>
            <button onClick={() => saveSyms(DEFAULT_CRYPTO)} className="mt-1 text-[11px] text-accent-2">Reset to defaults</button>
          </Card>

          <Card title="US stocks">
            <div className="flex items-start gap-2 text-xs text-muted"><Dot state={stockState} /><span>{stockNote}</span></div>
            <p className="mt-2 text-[11px] text-faint">All US-listed stocks and ETFs. The free Alpaca IEX feed shows trades printed on IEX; switch the Alpaca integration&apos;s data feed to SIP for every US exchange. Largest prints are shown first when the market is busy.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
