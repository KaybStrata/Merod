"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { use, useEffect, useMemo, useState } from "react";
import { Star, Sparkles, BookOpen, Info, ListOrdered, Activity, Copy, ExternalLink } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, useScreenAssetSetter, useShell } from "@/components/shell/context";
import { Card, Badge, Pills, Skeleton, Empty, ChangeText, AssetIcon, SourceBadge, StatusPill, Button, cx, useToast } from "@/components/ui";
import { price, usd, qty, compact, ago, tone } from "@/lib/format";
import { OrderTicket } from "@/components/terminal/OrderTicket";
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
  const [tf, setTf] = useState<"5m" | "1h" | "1d">("1h");
  const bars = useApi<any>(`/api/assets/${id}/bars?tf=${tf}&limit=500`);
  const [indicators, setIndicators] = useState<Indicator[]>(["sma20"]);
  const [live, setLive] = useState<{ price: number; time: number } | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [tab, setTab] = useState<"orders" | "fills" | "info">("orders");
  // Ghost trading layers on the chart
  const [layers, setLayers] = useState({ mine: true, bot: true, ghost: true, others: false });
  const [ghostCfg, setGhostCfg] = useState<{ strategy: string; dip: string; tp: string }>({ strategy: "dip_rebound_loop", dip: "", tp: "" });
  const ghosts = useApi<any>(`/api/assets/${id}/ghosts?tf=${tf}&strategy=${ghostCfg.strategy}${ghostCfg.dip ? `&dip=${ghostCfg.dip}` : ""}${ghostCfg.tp ? `&tp=${ghostCfg.tp}` : ""}`, { refreshMs: 15000 });
  const [liveMarks, setLiveMarks] = useState<ChartMarker[]>([]);
  useEffect(() => setLiveMarks([]), [id, tf]);
  const a = detail.data?.asset;
  useScreenAssetSetter(a ? { id: a.id, symbol: a.symbol, name: a.name } : null);
  useEffect(() => { setLive(null); setLastPrice(null); }, [id, tf]);
  useEffect(() => { if (a?.last_price != null && !connected) { setLastPrice(Number(a.last_price)); setLive({ price: Number(a.last_price), time: Math.floor(Date.now() / 1000) }); } }, [a?.last_price, connected]);

  useRealtime((e) => {
    if (e.channel === "market" && e.type === "ticks" && Array.isArray(e.payload)) {
      const t = e.payload.find((x: any) => x.id === id);
      if (t) { setLastPrice(t.price); setLive({ price: t.price, time: Math.floor(Date.now() / 1000) }); }
    }
    if (e.type === "fill" || e.type === "order") { detail.refresh(); ghosts.refresh(); }
    // Live markers: anonymized trades on this asset appear on the chart as they happen.
    if (e.channel === "activity" && e.type === "trade" && e.payload.assetId === id)
      setLiveMarks((m) => [...m.slice(-100), { time: Math.floor(Date.now() / 1000), side: e.payload.side, kind: e.payload.source === "bot" ? "bot" : "others", label: e.payload.source === "bot" ? "Bot" : undefined }]);
  });
  const markers = useMemo<ChartMarker[]>(() => {
    const g = ghosts.data;
    if (!g) return [];
    return [
      ...(layers.ghost ? g.ghost : []), ...(layers.others ? g.others : []), ...(layers.bot ? g.bots : []), ...(layers.mine ? g.mine : []),
      ...liveMarks.filter((m) => (m.kind === "bot" ? layers.bot : layers.others)),
    ];
  }, [ghosts.data, layers, liveMarks]);

  const chartBars = useMemo(() => (bars.data?.bars ?? []).map((b: any) => ({ time: Number(b.time), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume })), [bars.data]);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {a ? (
          <div className="flex items-center gap-3">
            <AssetIcon symbol={a.symbol} logo={a.logo_url} size={40} />
            <div>
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{a.symbol}</h1><span className="text-sm text-muted">{a.name}</span>
                <Badge>{a.venue}</Badge><TradabilityBadge a={a} /><SourceBadge source={a.price_source} /></div>
              <div className="flex items-baseline gap-3">
                <span className="num text-3xl font-semibold tracking-tight">{price(px)}</span>
                <ChangeText value={a.change_24h} className="text-sm" />
                <span className="text-xs text-faint">updated {ago(a.price_updated_at)}</span>
              </div>
            </div>
          </div>
        ) : <Skeleton className="h-14 w-72" />}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={toggleWatch}><Star className={cx("size-4", detail.data?.watched && "fill-warn text-warn")} />{detail.data?.watched ? "Watching" : "Watch"}</Button>
          <Button variant="outline" onClick={() => openPrompt(a ? `Analyze ${a.symbol}` : "")}><Sparkles className="size-4" /> AI assistant</Button>
        </div>
      </div>

      <ShortcutBar placement="terminal" assetId={id} />
      <LiveSuggestions assetId={id} title={a ? `Live suggestions for ${a.symbol}` : "Live suggestions"} compact />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-9">
          <Card pad={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
              <Pills size="sm" value={tf} onChange={setTf} options={[{ value: "5m", label: "5m" }, { value: "1h", label: "1H" }, { value: "1d", label: "1D" }]} />
              <div className="flex flex-wrap gap-1">
                {([["sma20", "SMA 20"], ["ema50", "EMA 50"], ["bb", "Bollinger"]] as [Indicator, string][]).map(([k, l]) => (
                  <button key={k} onClick={() => toggleInd(k)} className={cx("rounded-lg border px-2.5 py-1 text-xs", indicators.includes(k) ? "border-accent/50 bg-accent-soft text-accent-2" : "border-line text-muted hover:text-text")}>{l}</button>
                ))}
              </div>
            </div>
            <div className="px-1 pb-2 pt-1">
              {bars.data && chartBars.length > 1 ? <CandleChart bars={chartBars} indicators={indicators} live={live} markers={markers} /> : bars.data ? <div className="p-4"><Empty title="No chart history">No bars are available for this timeframe yet.</Empty></div> : <Skeleton className="mx-3 h-[420px]" />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5 text-xs">
              <span className="font-medium text-muted">Trades on chart:</span>
              {([["mine", "You", "bg-up"], ["bot", "Your bots", "bg-[#9b82ff]"], ["ghost", "Ghost strategy", "bg-up/50"], ["others", "Others (anon.)", "bg-faint"]] as const).map(([k, l, dot]) => (
                <button key={k} onClick={() => setLayers((x) => ({ ...x, [k]: !x[k] }))} className={cx("flex items-center gap-1.5 rounded-lg border px-2 py-1", layers[k] ? "border-accent/50 bg-accent-soft text-text" : "border-line text-faint")}>
                  <span className={cx("size-2 rounded-full", dot)} />{l}
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
            {layers.ghost && ghosts.data && <p className="px-4 pb-2 text-[10px] text-faint">{ghosts.data.note}</p>}
            {bars.data?.source === "simulated" && <p className="px-4 pb-3 text-[11px] text-faint">Chart uses Merod's simulated price feed (paper trading). Connect a licensed market-data provider for real history.</p>}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Position" icon={<Activity className="size-4 text-accent-2" />}>
              {!position ? <p className="text-sm text-muted">No open position.</p> : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <KV k="Quantity" v={qty(position.quantity)} />
                  <KV k="Avg cost" v={price(position.avg_cost)} />
                  <KV k="Market value" v={usd(px ? position.quantity * px : null)} />
                  <KV k="Unrealized" v={usd(px ? (px - position.avg_cost) * position.quantity : null, { sign: true })} cls={tone(px ? px - position.avg_cost : 0)} />
                  <KV k="Realized" v={usd(position.realized_pnl, { sign: true })} cls={tone(position.realized_pnl)} />
                  <KV k="Account" v={position.label} />
                </div>
              )}
            </Card>
            <Card title="Order book" icon={<BookOpen className="size-4 text-accent-2" />}>
              <Empty title="Order book not available">Connected providers don’t supply level-2 depth for this asset. Merod shows depth only from providers that publish it — it is never simulated.</Empty>
            </Card>
            <Card title="Market data" icon={<Info className="size-4 text-accent-2" />}>
              {a && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <KV k="Market cap" v={a.market_cap ? usd(a.market_cap, { compact: true }) : "—"} />
                  <KV k="24h volume" v={a.volume_24h ? usd(a.volume_24h, { compact: true }) : "—"} />
                  <KV k="Liquidity" v={a.liquidity_usd ? usd(a.liquidity_usd, { compact: true }) : "n/a"} />
                  <KV k="Lifecycle" v={a.lifecycle?.replace("_", " ") ?? "—"} />
                  <KV k="Class" v={a.asset_class} />
                  <KV k="Launched" v={a.launched_at ? ago(a.launched_at) : "—"} />
                </div>
              )}
            </Card>
          </div>

          <Card pad={false}>
            <div className="flex items-center justify-between gap-2 px-4 pt-3">
              <Pills size="sm" value={tab} onChange={setTab} options={[{ value: "orders", label: `Orders${openOrders.length ? ` (${openOrders.length} open)` : ""}` }, { value: "fills", label: "Recent fills" }, { value: "info", label: "Asset info" }]} />
            </div>
            <div className="p-4">
              {tab === "orders" && (
                !detail.data?.orders?.length ? <Empty title="No orders for this asset" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="py-2">Time</th><th>Side</th><th>Type</th><th className="text-right">Size</th><th className="text-right">Fill</th><th>Source</th><th>Status</th><th></th></tr></thead>
                      <tbody>
                        {detail.data.orders.map((o: any) => (
                          <tr key={o.id} className="border-b border-line/50">
                            <td className="py-2 text-xs text-muted">{ago(o.created_at)}</td>
                            <td><Badge tone={o.side === "buy" ? "up" : "down"}>{o.side}</Badge></td>
                            <td className="text-xs">{o.order_type.replace("_", " ")}{o.limit_price ? ` @ ${price(o.limit_price)}` : ""}{o.stop_price ? ` stop ${price(o.stop_price)}` : ""}</td>
                            <td className="num text-right text-xs">{o.quantity ? qty(o.quantity) : usd(o.notional_usd)}</td>
                            <td className="num text-right text-xs">{o.filled_quantity > 0 ? `${qty(o.filled_quantity)} @ ${price(o.avg_fill_price)}` : "—"}</td>
                            <td className="text-xs text-muted">{o.source}{o.is_paper && <span className="ml-1 text-warn">paper</span>}</td>
                            <td title={o.status_reason ?? ""}><StatusPill status={o.status} /></td>
                            <td className="text-right">
                              {o.status === "pending_approval" && <button onClick={() => orderAction(o.id, "approve")} className="mr-2 text-xs text-up hover:underline">Approve</button>}
                              {["pending_approval", "validated", "submitted", "partially_filled"].includes(o.status) && <button onClick={() => orderAction(o.id, "cancel")} className="text-xs text-down hover:underline">Cancel</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
              {tab === "fills" && (
                !detail.data?.trades?.length ? <Empty title="No fills yet">Merod shows fills that went through its own engine. Exchange-wide trade tape requires a provider stream.</Empty> : (
                  <div className="divide-y divide-line/50">
                    {detail.data.trades.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                        <span className={t.side === "buy" ? "text-up" : "text-down"}>{t.side.toUpperCase()}</span>
                        <span className="num">{qty(t.quantity)}</span>
                        <span className="num">{price(t.price)}</span>
                        <span className="text-xs text-faint">{ago(t.executed_at)} {t.is_paper && <Badge tone="warn">paper</Badge>}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
              {tab === "info" && a && <AssetInfo d={detail.data} />}
            </div>
          </Card>
        </div>

        <div className="xl:col-span-3">
          <div className="space-y-4 xl:sticky xl:top-20">
            <Card title="Trade" icon={<ListOrdered className="size-4 text-accent-2" />}>
              {a ? <OrderTicket asset={a} position={position} onPlaced={() => detail.refresh()} /> : <Skeleton className="h-96" />}
            </Card>
            {detail.data?.tradability && (
              <Card>
                <div className="text-xs text-muted">Execution status</div>
                <div className="mt-1 text-sm">{detail.data.tradability.reason}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge tone={detail.data.tradability.paper ? "accent" : "neutral"}>Paper {detail.data.tradability.paper ? "✓" : "✕"}</Badge>
                  <Badge tone={detail.data.tradability.live ? "up" : "neutral"}>Live {detail.data.tradability.live ? "✓" : "✕"}</Badge>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
