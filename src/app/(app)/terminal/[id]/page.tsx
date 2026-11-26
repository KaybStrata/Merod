"use client";
import { TimeRangePicker, range, barsFor, barsQuery, type Range as TimeWindow } from "@/components/TimeRange";
import Link from "next/link";
import dynamic from "next/dynamic";
import { use, useEffect, useMemo, useState } from "react";
import { Star, Sparkles, BookOpen, Info, ListOrdered, Activity, Copy, ExternalLink, Bell } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle, useRealtime, useScreenAssetSetter, useShell } from "@/components/shell/context";
import { Badge, Skeleton, Empty, ChangeText, AssetIcon, SourceBadge, StatusPill, cx, useToast } from "@/components/ui";
import { price, usd, qty, compact, ago, tone } from "@/lib/format";
import { OrderTicket } from "@/components/terminal/OrderTicket";
import { WalletFundsPanel } from "@/components/wallet/WalletFundsPanel";
import { TradabilityBadge } from "@/components/terminal/TradabilityBadge";
import { ShortcutBar } from "@/components/ShortcutBar";
import { LiveSuggestions } from "@/components/LiveSuggestions";
import type { ChartMarker } from "@/components/terminal/charts";
import type { Indicator } from "@/components/terminal/charts";

const CandleChart = dynamic(() => import("@/components/terminal/charts").then((m) => m.CandleChart), { ssr: false, loading: () => <Skeleton className="h-[420px]" /> });

export default function TerminalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { openPrompt, connected } = useShell();
  const detail = useApi<any>(`/api/assets/${id}`, { refreshMs: connected ? 15000 : 5000 });
  const [rng, setRng] = useState<TimeWindow>(range("1W"));
  const tf = barsFor(rng.seconds).tf;
  const bars = useApi<any>(`/api/assets/${id}/bars?${barsQuery(rng.seconds)}`, { refreshMs: rng.seconds <= 3 * 3600 ? 30_000 : 0 });
  const [indicators, setIndicators] = useState<Indicator[]>(["sma20"]);
  const [live, setLive] = useState<{ price: number; time: number } | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [tab, setTab] = useState<"positions" | "orders" | "history" | "fills" | "info">("positions");
  const port = useApi<any>("/api/portfolio", { refreshMs: 30_000 });
  // Ghost trading layers on the chart
  const [layers, setLayers] = useState({ mine: true, bot: true, others: true, thinking: true, ghost: false });
  const thoughts = useApi<any>(`/api/assets/${id}/thoughts?hours=${Math.max(1, Math.ceil(rng.seconds / 3600))}`, { refreshMs: 20_000 });
  const [liveThoughts, setLiveThoughts] = useState<{ time: number; who: string; text: string; level: string }[]>([]);
  const [ghostCfg, setGhostCfg] = useState<{ strategy: string; dip: string; tp: string }>({ strategy: "dip_rebound_loop", dip: "", tp: "" });
  const ghosts = useApi<any>(`/api/assets/${id}/ghosts?tf=${tf}&strategy=${ghostCfg.strategy}${ghostCfg.dip ? `&dip=${ghostCfg.dip}` : ""}${ghostCfg.tp ? `&tp=${ghostCfg.tp}` : ""}`, { refreshMs: 15000 });
  const [liveMarks, setLiveMarks] = useState<ChartMarker[]>([]);
  useEffect(() => setLiveMarks([]), [id, tf]);
  const a = detail.data?.asset;
  useScreenAssetSetter(a ? { id: a.id, symbol: a.symbol, name: a.name } : null);
  usePageTitle(a ? { section: `Trade · ${a.venue}`, title: `${a.symbol} · ${a.name}`, accent: a.symbol } : { section: "Trade", title: "Terminal" }, [a?.id]);
  useEffect(() => { setLive(null); setLastPrice(null); }, [id, tf]);
  useEffect(() => { if (a?.last_price != null && !connected) { setLastPrice(Number(a.last_price)); setLive({ price: Number(a.last_price), time: Math.floor(Date.now() / 1000) }); } }, [a?.last_price, connected]);

  useRealtime((e) => {
    if (e.channel === "market" && e.type === "ticks" && Array.isArray(e.payload)) {
      const t = e.payload.find((x: any) => x.id === id);
      if (t) { setLastPrice(t.price); setLive({ price: t.price, time: Math.floor(Date.now() / 1000) }); }
    }
    if (e.type === "fill" || e.type === "order") { detail.refresh(); ghosts.refresh(); }
    // Your own fills on this asset appear instantly.
    if (e.type === "fill" && a && e.payload?.symbol === a.symbol)
      setLiveMarks((m) => [...m.slice(-100), { time: Math.floor(Date.now() / 1000), side: e.payload.side, kind: ["bot", "auto", "copy"].includes(e.payload.source) ? "bot" : "mine", label: ["bot", "auto", "copy"].includes(e.payload.source) ? (e.payload.source === "copy" ? "Copy" : e.payload.source === "auto" ? "Auto" : "Bot") : "You" }]);
    // Bot / auto-trading / Modo thinking about this asset, live.
    if (e.type === "bot_log" && (thoughts.data?.botIds ?? []).includes(e.payload?.botId))
      setLiveThoughts((t) => (t.at(-1)?.text === e.payload.message ? t : [...t.slice(-40), { time: Math.floor((e.payload.ts ?? Date.now()) / 1000), who: e.payload.botName, text: e.payload.message, level: e.payload.level }]));
    if (e.type === "auto" && a && e.payload?.symbol === a.symbol) thoughts.refresh();
    // Live markers: anonymized trades on this asset appear on the chart as they happen.
    if (e.channel === "activity" && e.type === "trade" && e.payload.assetId === id)
      setLiveMarks((m) => [...m.slice(-100), { time: Math.floor(Date.now() / 1000), side: e.payload.side, kind: e.payload.source === "bot" ? "bot" : "others", label: e.payload.source === "bot" ? "Bot" : undefined }]);
  });
  const allThoughts = useMemo(() => {
    const merged = [...(thoughts.data?.thoughts ?? []), ...liveThoughts].sort((x: any, y: any) => x.time - y.time);
    return merged.filter((t: any, i: number) => !(i && merged[i - 1].text === t.text && merged[i - 1].who === t.who));
  }, [thoughts.data, liveThoughts]);
  const markers = useMemo<ChartMarker[]>(() => {
    const g = ghosts.data;
    if (!g) return [];
    return [
      ...(layers.ghost ? g.ghost : []), ...(layers.others ? g.others : []), ...(layers.bot ? g.bots : []), ...(layers.mine ? g.mine : []),
      ...liveMarks.filter((m) => (m.kind === "bot" ? layers.bot : m.kind === "mine" ? layers.mine : layers.others)),
      // Thinking markers: only meaningful steps (not every repeated "waiting…" observation).
      ...(layers.thinking ? allThoughts.filter((t) => t.level !== "observation").slice(-40)
        .map((t) => ({ time: t.time, side: "think" as const, kind: "thought" as const, label: "💭" })) : []),
    ];
  }, [ghosts.data, layers, liveMarks, allThoughts]);

  const chartBars = useMemo(() => (bars.data?.bars ?? []).map((b: any) => ({ time: Number(b.time), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume })), [bars.data]);
  const ohlc = useMemo(() => chartBars.length ? { open: chartBars[0].open, high: Math.max(...chartBars.map((b: any) => b.high)), low: Math.min(...chartBars.map((b: any) => b.low)) } : null, [chartBars]);
  const px = lastPrice ?? (a?.last_price != null ? Number(a.last_price) : null);
  const position = detail.data?.positions?.[0] ?? null;
  const openOrders = (detail.data?.orders ?? []).filter((o: any) => ["pending_approval", "validated", "submitted", "partially_filled", "unknown"].includes(o.status));

  async function toggleWatch() {
    try { const r = await api("/api/watchlists/items", { method: "POST", json: { assetId: id, action: "toggle" } }); toast(r.watched ? "Added to watchlist" : "Removed from watchlist"); detail.refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  async function orderAction(orderId: string, action: "cancel" | "approve") {
    try { await api(`/api/orders/${orderId}`, { method: "POST", json: { action } }); toast(action === "cancel" ? "Order cancelled" : "Order approved", "up"); detail.refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  const toggleInd = (i: Indicator) => setIndicators((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]));

  if (detail.error && !a) return <Empty title="Asset not found">{detail.error} <Link href="/discover" className="text-accent-2 underline">Back to Discover</Link></Empty>;

  const allPositions: any[] = (port.data?.positions ?? []).filter((p: any) => Number(p.quantity) > 0);
  const tabs: [typeof tab, string][] = [["positions", `Positions${allPositions.length ? ` ${allPositions.length}` : ""}`], ["orders", `Open orders${openOrders.length ? ` ${openOrders.length}` : ""}`], ["history", "Order history"], ["fills", "Fills"], ["info", "Asset info"]];

  return (
    <div className="space-y-3">
      {/* Ticker header: price + session stats */}
      <section className="surface flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl px-4 py-3">
        {a ? (
          <div className="flex items-center gap-3">
            <AssetIcon symbol={a.symbol} logo={a.logo_url} size={34} />
            <div>
              <div className="flex flex-wrap items-center gap-1.5"><span className="text-[15px] font-semibold">{a.symbol}</span><span className="text-[12px] text-muted">{a.name}</span><span className="rounded border border-line px-1 text-[10px] uppercase text-faint">{a.venue}</span><TradabilityBadge a={a} /></div>
              <div className="flex items-baseline gap-2"><span className="num text-[24px] font-semibold leading-tight tracking-tight">{price(px)}</span><ChangeText value={a.change_24h} className="text-[13px]" /><SourceBadge source={a.price_source} /></div>
            </div>
          </div>
        ) : <Skeleton className="h-12 w-64" />}
        {a && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px]">
            <Stat k="Open" v={ohlc ? price(ohlc.open) : "—"} />
            <Stat k="High" v={ohlc ? price(ohlc.high) : "—"} cls="text-up" />
            <Stat k="Low" v={ohlc ? price(ohlc.low) : "—"} cls="text-down" />
            <Stat k="Vol 24h" v={a.volume_24h ? usd(a.volume_24h, { compact: true }) : "—"} />
            <Stat k="Mkt cap" v={a.market_cap ? usd(a.market_cap, { compact: true }) : "—"} />
            <Stat k="Liquidity" v={a.liquidity_usd ? usd(a.liquidity_usd, { compact: true }) : "—"} />
            <Stat k="Updated" v={ago(a.price_updated_at)} />
          </dl>
        )}
        <div className="ml-auto flex gap-1.5">
          <button onClick={toggleWatch} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-muted hover:text-text"><Star className={cx("size-3.5", detail.data?.watched && "fill-warn text-warn")} />{detail.data?.watched ? "Watching" : "Watch"}</button>
          <Link href="/alerts" className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-muted hover:text-text"><Bell className="size-3.5" />Alert</Link>
          <button onClick={() => openPrompt(a ? `Analyze ${a.symbol}` : "")} className="flex h-8 items-center gap-1.5 rounded-lg bg-grad px-3 text-[12.5px] font-semibold text-bg"><Sparkles className="size-3.5" />Ask Merod</button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_240px_340px]">
        {/* Chart + blotter */}
        <div className="min-w-0 space-y-3">
          <section className="surface rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <TimeRangePicker value={rng} onChange={setRng} size="sm" />
              <div className="flex flex-wrap gap-1">
                {([["sma20", "SMA 20"], ["ema50", "EMA 50"], ["bb", "Bollinger"]] as [Indicator, string][]).map(([k, l]) => (
                  <button key={k} onClick={() => toggleInd(k)} className={cx("rounded-md border px-2 py-0.5 text-[11.5px]", indicators.includes(k) ? "border-accent/50 bg-accent-soft text-accent-2" : "border-line text-muted hover:text-text")}>{l}</button>
                ))}
              </div>
            </div>
            <div className="relative px-1 pb-1 pt-1">
              {layers.thinking && allThoughts.length > 0 && (
                <div className="pointer-events-auto absolute left-3 top-3 z-10 max-w-[min(420px,70%)] rounded-xl border border-[#f5b84a]/30 bg-bg/85 p-2 backdrop-blur">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#f5b84a]"><span className="size-1.5 rounded-full bg-[#f5b84a] pulse-dot" /> Bot thinking · live</div>
                  <ul className="max-h-28 space-y-0.5 overflow-y-auto">
                    {allThoughts.slice(-5).reverse().map((t: any, i: number) => (
                      <li key={i} className="text-[11px] leading-snug"><b className="text-text">{t.who}</b> <span className="text-muted">{t.text}</span> <span className="text-faint">{ago(t.time * 1000)}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {bars.data && chartBars.length > 1 ? <CandleChart bars={chartBars} indicators={indicators} live={live} markers={markers} /> : bars.data ? <div className="p-4"><Empty title="No chart history">No bars are available for this timeframe yet.</Empty></div> : <Skeleton className="mx-3 h-[420px]" />}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line px-3 py-2 text-[11.5px]">
              <span className="text-faint">On chart:</span>
              {([["mine", "You", "bg-up"], ["bot", "Your bots & auto", "bg-[#4aa8ff]"], ["others", "Other users", "bg-[#a78bfa]"], ["thinking", "Bot thinking", "bg-[#f5b84a]"], ["ghost", "Ghost strategy", "bg-up/50"]] as const).map(([k, l, dot]) => (
                <button key={k} onClick={() => setLayers((x) => ({ ...x, [k]: !x[k] }))} className={cx("flex items-center gap-1.5 rounded-md border px-1.5 py-0.5", layers[k] ? "border-accent/50 bg-accent-soft text-text" : "border-line text-faint")}>
                  <span className={cx("size-1.5 rounded-full", dot)} />{l}
                </button>
              ))}
              {layers.ghost && ghosts.data && (
                <span className="flex flex-wrap items-center gap-1.5 text-muted">
                  <select value={ghostCfg.strategy} onChange={(e) => setGhostCfg({ ...ghostCfg, strategy: e.target.value })} className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 text-text">
                    <option value="dip_rebound_loop">Dip loop</option><option value="technical_indicator">SMA cross</option>
                  </select>
                  {ghostCfg.strategy === "dip_rebound_loop" && <>
                    dip <input value={ghostCfg.dip} placeholder={String(ghosts.data.ghostParams.dip ?? "")} onChange={(e) => setGhostCfg({ ...ghostCfg, dip: e.target.value.replace(/[^\d.]/g, "") })} className="w-10 rounded-md border border-line bg-bg-2 px-1 py-0.5 text-text" />%
                    target <input value={ghostCfg.tp} placeholder={String(ghosts.data.ghostParams.tp ?? "")} onChange={(e) => setGhostCfg({ ...ghostCfg, tp: e.target.value.replace(/[^\d.]/g, "") })} className="w-10 rounded-md border border-line bg-bg-2 px-1 py-0.5 text-text" />%
                  </>}
                  <span className={tone(ghosts.data.ghostStats.returnPct)}>ghost {ghosts.data.ghostStats.returnPct >= 0 ? "+" : ""}{ghosts.data.ghostStats.returnPct.toFixed(1)}%</span>
                  <span>· {ghosts.data.ghostStats.wins}W/{ghosts.data.ghostStats.losses}L</span>
                  {a && ghostCfg.strategy === "dip_rebound_loop" && (
                    <button className="rounded-md border border-accent/50 px-2 py-0.5 text-accent-2 hover:bg-accent-soft"
                      onClick={() => openPrompt(`Buy $100 of ${a.symbol} at a ${ghostCfg.dip || ghosts.data.ghostParams.dip}% dip and sell at ${ghostCfg.tp || ghosts.data.ghostParams.tp}% increase, then rinse and repeat`)}>Run as bot</button>
                  )}
                </span>
              )}
            </div>
            {layers.ghost && ghosts.data && <p className="px-3 pb-2 text-[10px] text-faint">{ghosts.data.note}</p>}
            {bars.data?.source === "simulated" && <p className="px-3 pb-2 text-[10.5px] text-faint">Chart uses Merod&apos;s simulated price feed (paper trading). Connect a licensed market-data provider for real history.</p>}
          </section>

          <section className="surface rounded-2xl">
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-3 text-[12.5px]">
              {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx("-mb-px shrink-0 border-b-2 px-2.5 py-2", tab === k ? "border-accent-2 text-text" : "border-transparent text-muted hover:text-text")}>{l}</button>)}
            </div>
            <div className="overflow-x-auto p-3">
              {tab === "positions" && (!allPositions.length ? <p className="py-6 text-center text-[12.5px] text-muted">No open positions.</p> : (
                <table className="w-full min-w-[760px] text-[12.5px]">
                  <thead className="text-[10.5px] uppercase tracking-wide text-faint"><tr className="border-b border-line"><th className="py-1.5 text-left font-medium">Symbol</th><th className="text-left font-medium">Side</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Avg cost</th><th className="text-right font-medium">Last</th><th className="text-right font-medium">Mkt value</th><th className="text-right font-medium">Unrealized</th><th className="pl-3 text-left font-medium">Account</th></tr></thead>
                  <tbody>{allPositions.map((p: any) => {
                    const pnlPct = Number(p.avg_cost) > 0 && p.last_price != null ? (Number(p.last_price) / Number(p.avg_cost) - 1) * 100 : null;
                    return (
                      <tr key={`${p.account_id}-${p.asset_id}`} className={cx("border-b border-line/50", p.asset_id === id && "bg-accent-soft/30")}>
                        <td className="py-1.5"><Link href={`/terminal/${p.asset_id}`} className="font-semibold hover:text-accent-2">{p.symbol}</Link></td>
                        <td><span className="rounded bg-up-soft px-1.5 py-px text-[10.5px] font-semibold text-up">Long</span></td>
                        <td className="num text-right">{qty(p.quantity)}</td>
                        <td className="num text-right">{price(p.avg_cost)}</td>
                        <td className="num text-right">{price(p.last_price)}</td>
                        <td className="num text-right">{usd(p.market_value)}</td>
                        <td className={cx("num text-right", tone(p.unrealized_pnl))}>{usd(p.unrealized_pnl, { sign: true })}{pnlPct != null && <span className="ml-1 text-[11px]">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>}</td>
                        <td className="pl-3 text-[11.5px] text-muted">{p.account_label ?? p.label ?? ""}{p.is_paper && <span className="ml-1 text-warn">paper</span>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              ))}
              {(tab === "orders" || tab === "history") && (() => {
                const rows = (detail.data?.orders ?? []).filter((o: any) => tab === "history" || openOrders.includes(o));
                return !rows.length ? <p className="py-6 text-center text-[12.5px] text-muted">{tab === "orders" ? "No open orders." : `No orders for ${a?.symbol ?? "this asset"} yet.`}</p> : (
                  <table className="w-full min-w-[680px] text-[12.5px]">
                    <thead className="text-[10.5px] uppercase tracking-wide text-faint"><tr className="border-b border-line"><th className="py-1.5 text-left font-medium">Time</th><th className="text-left font-medium">Side</th><th className="text-left font-medium">Type</th><th className="text-right font-medium">Size</th><th className="text-right font-medium">Fill</th><th className="pl-3 text-left font-medium">Source</th><th className="text-left font-medium">Status</th><th /></tr></thead>
                    <tbody>{rows.map((o: any) => (
                      <tr key={o.id} className="border-b border-line/50">
                        <td className="py-1.5 text-muted">{ago(o.created_at)}</td>
                        <td className={o.side === "buy" ? "text-up" : "text-down"}>{o.side.toUpperCase()}</td>
                        <td>{o.order_type.replace("_", " ")}{o.limit_price ? ` @ ${price(o.limit_price)}` : ""}{o.stop_price ? ` stop ${price(o.stop_price)}` : ""}</td>
                        <td className="num text-right">{o.quantity ? qty(o.quantity) : usd(o.notional_usd)}</td>
                        <td className="num text-right">{o.filled_quantity > 0 ? `${qty(o.filled_quantity)} @ ${price(o.avg_fill_price)}` : "—"}</td>
                        <td className="pl-3 text-muted">{o.source}{o.is_paper && <span className="ml-1 text-warn">paper</span>}</td>
                        <td title={o.status_reason ?? ""}><StatusPill status={o.status} /></td>
                        <td className="text-right">
                          {o.status === "pending_approval" && <button onClick={() => orderAction(o.id, "approve")} className="mr-2 text-[11.5px] text-up hover:underline">Approve</button>}
                          {["pending_approval", "validated", "submitted", "partially_filled"].includes(o.status) && <button onClick={() => orderAction(o.id, "cancel")} className="text-[11.5px] text-down hover:underline">Cancel</button>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                );
              })()}
              {tab === "fills" && (!detail.data?.trades?.length ? <p className="py-6 text-center text-[12.5px] text-muted">No fills yet. Merod shows fills that went through its own engine.</p> : (
                <table className="w-full text-[12.5px]"><tbody>{detail.data.trades.map((t: any, i: number) => (
                  <tr key={i} className="border-b border-line/50"><td className={cx("py-1.5 font-semibold", t.side === "buy" ? "text-up" : "text-down")}>{t.side.toUpperCase()}</td><td className="num text-right">{qty(t.quantity)}</td><td className="num text-right">{price(t.price)}</td><td className="text-right text-[11.5px] text-faint">{ago(t.executed_at)} {t.is_paper && <span className="text-warn">paper</span>}</td></tr>
                ))}</tbody></table>
              ))}
              {tab === "info" && a && <AssetInfo d={detail.data} />}
            </div>
          </section>
        </div>

        {/* Order book + trades tape */}
        <div className="space-y-3">
          <section className="surface rounded-2xl p-3">
            <h3 className="flex items-center justify-between text-[12.5px] font-semibold"><span className="flex items-center gap-1.5"><BookOpen className="size-3.5 text-accent-2" />Order book</span><span className="text-[10.5px] font-normal text-faint">L2</span></h3>
            <div className="mt-2 grid grid-cols-3 text-[10.5px] uppercase tracking-wide text-faint"><span>Price</span><span className="text-right">Size</span><span className="text-right">Total</span></div>
            <p className="mt-3 rounded-lg border border-dashed border-line px-2 py-4 text-center text-[11px] leading-relaxed text-muted">No level-2 depth from the connected providers for {a?.symbol ?? "this asset"}. Merod never simulates an order book.</p>
            {px != null && <div className="mt-2 flex items-center justify-between rounded-md bg-bg-2/60 px-2 py-1 text-[12px]"><span className="text-faint">Last</span><span className="num font-semibold">{price(px)}</span></div>}
          </section>
          <section className="surface rounded-2xl p-3">
            <h3 className="flex items-center justify-between text-[12.5px] font-semibold"><span className="flex items-center gap-1.5"><Activity className="size-3.5 text-accent-2" />Trades</span><span className="text-[10.5px] font-normal text-faint">Merod engine</span></h3>
            <div className="mt-2 grid grid-cols-3 text-[10.5px] uppercase tracking-wide text-faint"><span>Price</span><span className="text-right">Size</span><span className="text-right">Time</span></div>
            {!detail.data?.trades?.length ? <p className="mt-3 text-center text-[11px] text-muted">No trades yet.</p> : (
              <ul className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">
                {detail.data.trades.slice(0, 40).map((t: any, i: number) => (
                  <li key={i} className="grid grid-cols-3 text-[11.5px]"><span className={cx("num", t.side === "buy" ? "text-up" : "text-down")}>{price(t.price)}</span><span className="num text-right">{qty(t.quantity)}</span><span className="text-right text-faint">{new Date(t.executed_at).toLocaleTimeString([], { hour12: false })}</span></li>
                ))}
              </ul>
            )}
          </section>
          <section className="surface rounded-2xl p-3">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Info className="size-3.5 text-accent-2" />Your position</h3>
            {!position ? <p className="mt-2 text-[12px] text-muted">No open position.</p> : (
              <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <KV k="Quantity" v={qty(position.quantity)} />
                <KV k="Avg cost" v={price(position.avg_cost)} />
                <KV k="Value" v={usd(px ? position.quantity * px : null)} />
                <KV k="Unrealized" v={usd(px ? (px - position.avg_cost) * position.quantity : null, { sign: true })} cls={tone(px ? px - position.avg_cost : 0)} />
              </dl>
            )}
          </section>
        </div>

        {/* Order ticket */}
        <div>
          <div className="space-y-3 xl:sticky xl:top-[68px]">
            <section className="surface rounded-2xl p-3.5">
              <h3 className="mb-2.5 flex items-center justify-between text-[13px] font-semibold"><span className="flex items-center gap-1.5"><ListOrdered className="size-4 text-accent-2" />Order ticket</span>{a && <span className="text-[11px] font-normal text-faint">{a.symbol}</span>}</h3>
              {a ? <OrderTicket asset={a} position={position} onPlaced={() => { detail.refresh(); port.refresh(); }} /> : <Skeleton className="h-96" />}
            </section>
            {detail.data?.tradability && (
              <div className="rounded-xl border border-line bg-panel/60 px-3 py-2 text-[11.5px] text-muted">
                <span className="mr-1.5">Execution:</span><span className={detail.data.tradability.paper ? "text-up" : "text-faint"}>Paper {detail.data.tradability.paper ? "✓" : "✕"}</span> · <span className={detail.data.tradability.live ? "text-up" : "text-faint"}>Live {detail.data.tradability.live ? "✓" : "✕"}</span>
                <div className="mt-0.5 text-faint">{detail.data.tradability.reason}</div>
              </div>
            )}
            <WalletFundsPanel compact />
          </div>
        </div>
      </div>

      <ShortcutBar placement="terminal" assetId={id} />
      <LiveSuggestions assetId={id} title={a ? `Live suggestions for ${a.symbol}` : "Live suggestions"} compact />
    </div>
  );
}

function Stat({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div><dt className="text-[10px] uppercase tracking-wide text-faint">{k}</dt><dd className={cx("num text-[12.5px] text-text", cls)}>{v}</dd></div>;
}

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="min-w-0"><div className="text-xs text-faint">{k}</div><div className={cx("num truncate", cls)}>{v}</div></div>;
}

function AssetInfo({ d }: { d: any }) {
  const toast = useToast();
  const a = d.asset;
  const explorer = a.venue === "solana" ? `https://solscan.io/token/${a.identifier}` : a.venue === "ethereum" && a.identifier.startsWith("0x") ? `https://etherscan.io/token/${a.identifier}` : null;
  return (
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <div className="space-y-2">
        <KV k="Name" v={a.name} />
        <KV k="Venue (exchange / blockchain)" v={a.venue} />
        <div><div className="text-xs text-faint">Identifier</div>
          <div className="flex items-center gap-2 font-mono text-xs break-all">{a.identifier}
            <button onClick={() => { (navigator.clipboard?.writeText(a.identifier) ?? Promise.reject()).then(() => toast("Copied"), () => toast("Copy failed — select and copy manually", "down")); }} className="text-faint hover:text-text" aria-label="Copy"><Copy className="size-3.5" /></button>
            {explorer && <a href={explorer} target="_blank" rel="noreferrer" className="text-faint hover:text-text"><ExternalLink className="size-3.5" /></a>}</div></div>
        <div><div className="text-xs text-faint">Other identifiers</div>{d.identifiers.map((i: any) => <div key={i.scheme + i.value} className="font-mono text-xs text-muted">{i.scheme}: {i.value}</div>)}</div>
      </div>
      <div className="space-y-2">
        <div><div className="text-xs text-faint">Supported execution providers</div><div className="mt-1 flex flex-wrap gap-1">{d.providers.length ? d.providers.map((p: any) => <Badge key={p.provider_id}>{p.provider_id}</Badge>) : <span className="text-muted">None</span>}</div></div>
        <div><div className="text-xs text-faint">Categories</div><div className="mt-1 flex flex-wrap gap-1">{a.categories.map((c: string) => <Badge key={c}>{c}</Badge>)}</div></div>
        <div><div className="text-xs text-faint">Risk information</div><div className="mt-1 flex flex-wrap gap-1">{a.risk_flags.length ? a.risk_flags.map((f: string) => <Badge key={f} tone="warn">{f.replace(/_/g, " ")}</Badge>) : <span className="text-muted">No risk flags recorded</span>}</div></div>
        <KV k="Price source" v={`${a.price_source ?? "none"} · ${ago(a.price_updated_at)}`} />
        <KV k="24h volume (units)" v={compact(a.volume_24h)} />
      </div>
    </div>
  );
}
