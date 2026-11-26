"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, AreaSeries, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";

/** A trade drawn on the chart: your fills, your bots, hypothetical "ghost" strategy trades, or others' (anonymized). */
export interface ChartMarker { time: number; side: "buy" | "sell" | "think"; kind: "mine" | "bot" | "ghost" | "others" | "thought"; label?: string; info?: TradeInfo; text?: string }
/** Summary shown when you hover a candle with trades: who traded, side, size, price, total, P&L and a note. */
export interface TradeInfo { who: string; side: "buy" | "sell"; qty: number; price: number; usd: number; fee?: number | null; paper?: boolean; pnl?: number | null; pnlPct?: number | null; note?: string | null }
const tPx = (n: number) => !Number.isFinite(n) ? "?" : n >= 100 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 })}` : `$${n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
const tQty = (n: number) => n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n >= 1 ? String(+n.toFixed(4)) : n.toPrecision(4);
const tUsd = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
/** Show chart times on the viewer's own clock (the library defaults to UTC). */
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts);
const crosshairFmt = fmt({ weekday: "short", day: "numeric", month: "short", year: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" });
const clockFmt = fmt({ hour: "numeric", minute: "2-digit" });
const dayFmt = fmt({ day: "numeric", month: "short" });
const monthFmt = fmt({ month: "short", year: "2-digit" });
const yearFmt = fmt({ year: "numeric" });
const toDate = (t: any) => new Date((typeof t === "number" ? t : Date.UTC(t.year, t.month - 1, t.day) / 1000) * 1000);
export const localTimeOptions = {
  localization: { timeFormatter: (t: any) => crosshairFmt.format(toDate(t)) },
  // tickMarkType: 0 year, 1 month, 2 day of month, 3 time, 4 time with seconds
  tickMarkFormatter: (t: any, type: number) => {
    const d = toDate(t);
    return type === 0 ? yearFmt.format(d) : type === 1 ? monthFmt.format(d) : type === 2 ? dayFmt.format(d) : clockFmt.format(d);
  },
};

function baseOptions(height: number) {
  return {
    height,
    localization: localTimeOptions.localization,
    layout: { background: { color: "transparent" }, textColor: cssVar("--muted", "#8b93ad"), fontSize: 11, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--line", "#1e2640") + "55" } },
    rightPriceScale: { borderColor: cssVar("--line", "#1e2640"), scaleMargins: { top: 0.12, bottom: 0.2 } },
    // Neat candles: never wider than 12px, even when there are only a few of them.
    timeScale: { borderColor: cssVar("--line", "#1e2640"), timeVisible: true, secondsVisible: false, barSpacing: 8, minBarSpacing: 2, maxBarSpacing: 12, rightOffset: 4, tickMarkFormatter: localTimeOptions.tickMarkFormatter },
    crosshair: { mode: 1 },
  } as const;
}

/** Decimal places that suit the price: 2 for normal prices, more for sub-dollar and tiny meme-coin prices. */
export function pricePrecision(p: number) {
  if (!(p > 0)) return 2;
  if (p >= 1) return 2;
  return Math.min(12, Math.max(4, Math.ceil(-Math.log10(p)) + 3));
}

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
export type Indicator = "sma20" | "ema50" | "bb";

const sma = (v: number[], n: number) => v.map((_, i) => (i < n - 1 ? null : v.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
const ema = (v: number[], n: number) => { const k = 2 / (n + 1); let e: number | null = null; return v.map((x, i) => { e = e == null ? x : x * k + e * (1 - k); return i < n - 1 ? null : e; }); };
function boll(v: number[], n = 20, m = 2) {
  const mid = sma(v, n);
  return v.map((_, i) => {
    if (mid[i] == null) return null;
    const s = v.slice(i - n + 1, i + 1), mu = mid[i]!, sd = Math.sqrt(s.reduce((a, b) => a + (b - mu) ** 2, 0) / n);
    return { up: mu + m * sd, lo: mu - m * sd };
  });
}

/** Candles + volume + optional indicators. `live` updates the last candle in place. */
/** A horizontal level drawn across the chart, e.g. your fill price or a take-profit target. */
export interface PriceLine { price: number; color: string; title: string; dashed?: boolean }

export function CandleChart({ bars, indicators, live, height = 420, markers = [], priceLines = [], compact = false }: { bars: Bar[]; indicators: Indicator[]; live?: { price: number; time: number } | null; height?: number; markers?: ChartMarker[]; priceLines?: PriceLine[]; compact?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastBar = useRef<Bar | null>(null);
  const tfSec = useRef(3600);
  // Hover summary: the trades (and bot thoughts) on the candle under the cursor.
  const markersRef = useRef<ChartMarker[]>(markers); markersRef.current = markers;
  const [tip, setTip] = useState<{ x: number; y: number; time: number; items: ChartMarker[] } | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, { ...baseOptions(height), width: el.current.clientWidth, ...(compact ? { handleScroll: false, handleScale: false } : {}) });
    chart.current = c;
    const up = cssVar("--up", "#22c993"), down = cssVar("--down", "#f0506e");
    const levels = priceLines.map((l) => l.price).filter((x) => x > 0);
    const lastClose = bars.length ? +bars[bars.length - 1].close : 0;
    const prec = pricePrecision(lastClose);
    const priceFormat = { type: "price" as const, precision: prec, minMove: Math.pow(10, -prec) };
    const cs = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat,
      // Keep marked levels (entry, take-profit, stop-loss) inside the visible price range.
      ...(levels.length ? { autoscaleInfoProvider: (original: () => any) => {
        const r = original(); if (!r?.priceRange) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...levels), maxValue: Math.max(r.priceRange.maxValue, ...levels) } };
      } } : {}) });
    candles.current = cs;
    const vol = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    const data = bars.map((b) => ({ time: b.time as UTCTimestamp, open: +b.open, high: +b.high, low: +b.low, close: +b.close }));
    cs.setData(data);
    markerApi.current = createSeriesMarkers(cs, []);
    for (const pl of priceLines) if (pl.price > 0) cs.createPriceLine({ price: pl.price, color: pl.color, lineWidth: 1, lineStyle: pl.dashed ? 2 : 0, axisLabelVisible: true, title: pl.title });
    vol.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: +b.volume, color: (+b.close >= +b.open ? up : down) + "55" })));
    const closes = bars.map((b) => +b.close);
    const line = (vals: (number | null)[], color: string, width = 1.5) => {
      const s = c.addSeries(LineSeries, { color, lineWidth: width as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat });
      s.setData(vals.flatMap((v, i) => (v == null ? [] : [{ time: bars[i].time as UTCTimestamp, value: v }])));
    };
    if (indicators.includes("sma20")) line(sma(closes, 20), "#f5b84a");
    if (indicators.includes("ema50")) line(ema(closes, 50), "#4aa8ff");
    if (indicators.includes("bb")) { const b = boll(closes); line(b.map((x) => x?.up ?? null), "#7dd3fc88", 1); line(b.map((x) => x?.lo ?? null), "#7dd3fc88", 1); }
    // Fit when there are plenty of candles; with only a few, keep them at a normal width on the right.
    if (bars.length > 60) c.timeScale().fitContent(); else c.timeScale().scrollToRealTime();
    lastBar.current = bars.length ? { ...bars[bars.length - 1] } : null;
    tfSec.current = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 3600;
    c.subscribeCrosshairMove((param) => {
      if (!param.point || param.time === undefined) { setTip(null); return; }
      const step = tfSec.current, t = Number(param.time);
      const items = markersRef.current.filter((m) => Math.floor(m.time / step) * step === t && (m.info || m.text));
      setTip(items.length ? { x: param.point.x, y: param.point.y, time: t, items } : null);
    });
    const ro = new ResizeObserver(() => el.current && c.applyOptions({ width: el.current.clientWidth }));
    ro.observe(el.current);
    return () => { ro.disconnect(); c.remove(); chart.current = null; candles.current = null; markerApi.current = null; };
  }, [bars, indicators, height, JSON.stringify(priceLines)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trade markers snapped to candle buckets. Ghost = hypothetical strategy trades (never real orders).
  useEffect(() => {
    if (!markerApi.current || !bars.length) return;
    const step = tfSec.current, first = bars[0].time;
    const style: Record<ChartMarker["kind"], { buy: string; sell: string; shape: "arrowUp" | "arrowDown" | "circle" | "square" }> = {
      mine: { buy: "#22c55e", sell: "#f0506e", shape: "arrowUp" },
      bot: { buy: "#4aa8ff", sell: "#7cc4ff", shape: "square" },
      ghost: { buy: "#22c99399", sell: "#f0506e99", shape: "circle" },
      others: { buy: "#a78bfa", sell: "#c4b5fd", shape: "circle" },
      thought: { buy: "#f5b84a", sell: "#f5b84a", shape: "square" },
    };
    const out: SeriesMarker<Time>[] = markers
      .filter((m) => m.time >= first)
      .map((m) => {
        const s = style[m.kind];
        return {
          time: (Math.floor(m.time / step) * step) as UTCTimestamp,
          position: m.kind === "thought" ? "aboveBar" : m.side === "buy" ? "belowBar" : "aboveBar",
          color: m.side === "sell" ? s.sell : s.buy,
          shape: m.kind === "mine" ? (m.side === "buy" ? "arrowUp" : "arrowDown") : s.shape,
          text: m.label,
          size: m.kind === "others" ? 0.7 : m.kind === "thought" ? 0.5 : m.kind === "mine" ? 2 : 1,
        } as SeriesMarker<Time>;
      })
      .sort((a, b) => Number(a.time) - Number(b.time));
    markerApi.current.setMarkers(out);
  }, [markers, bars]);

  useEffect(() => {
    if (!live || !candles.current || !lastBar.current) return;
    const lb = lastBar.current;
    const bucket = Math.floor(live.time / tfSec.current) * tfSec.current;
    if (bucket > lb.time) lastBar.current = { time: bucket, open: lb.close, high: live.price, low: live.price, close: live.price, volume: 0 };
    else lastBar.current = { ...lb, high: Math.max(+lb.high, live.price), low: Math.min(+lb.low, live.price), close: live.price };
    const b = lastBar.current;
    candles.current.update({ time: b.time as UTCTimestamp, open: +b.open, high: +b.high, low: +b.low, close: +b.close });
  }, [live]);

  const w = el.current?.clientWidth ?? 800;
  const trades = tip?.items.filter((m) => m.info) ?? [];
  const thoughts = tip?.items.filter((m) => !m.info && m.text) ?? [];
  const buys = trades.filter((m) => m.info!.side === "buy"), sells = trades.filter((m) => m.info!.side === "sell");
  const net = sells.reduce((s, m) => s + (m.info!.pnl ?? 0), 0);
  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={el} className="w-full" style={{ height }} />
      {tip && (
        <div className="pointer-events-none absolute z-20 w-[280px] rounded-xl border border-line bg-bg-2/95 p-2.5 text-[11px] shadow-2xl backdrop-blur"
          style={{ left: tip.x > w - 300 ? Math.max(4, tip.x - 292) : tip.x + 14, top: Math.max(4, Math.min(height - 40, tip.y - 20)) }}>
          <div className="mb-1 flex items-center justify-between text-[10px] text-faint">
            <span>{new Date(tip.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            {trades.length > 0 && <span>{buys.length} buy{buys.length === 1 ? "" : "s"} · {sells.length} sell{sells.length === 1 ? "" : "s"}{sells.some((m) => m.info!.pnl != null) ? ` · P&L ${net >= 0 ? "+" : "−"}${tUsd(net)}` : ""}</span>}
          </div>
          <div className="max-h-[260px] space-y-1.5 overflow-hidden">
            {trades.slice(0, 6).map((m, i) => {
              const f = m.info!;
              return (
                <div key={i} className="border-t border-line/60 pt-1.5 first:border-0 first:pt-0">
                  <div className="flex items-center gap-1.5">
                    <span className={f.side === "buy" ? "rounded bg-up/15 px-1 text-[9.5px] font-bold uppercase text-up" : "rounded bg-down/15 px-1 text-[9.5px] font-bold uppercase text-down"}>{f.side === "buy" ? "Bought" : "Sold"}</span>
                    <span className="truncate font-semibold text-text">{f.who}</span>
                    {f.paper !== undefined && <span className="ml-auto shrink-0 text-[9.5px] text-faint">{f.paper ? "paper" : "real"}</span>}
                  </div>
                  <div className="num text-muted">{tQty(f.qty)} @ {tPx(f.price)} = {tUsd(f.usd)}{f.fee ? ` · fee ${tUsd(f.fee)}` : ""}</div>
                  {f.pnl != null && <div className={f.pnl >= 0 ? "num text-up" : "num text-down"}>P&L {f.pnl >= 0 ? "+" : "−"}{tUsd(f.pnl)}{f.pnlPct != null ? ` (${f.pnlPct >= 0 ? "+" : ""}${f.pnlPct.toFixed(2)}%)` : ""}</div>}
                  {f.note && <div className="line-clamp-2 text-faint">{f.note}</div>}
                </div>
              );
            })}
            {trades.length > 6 && <div className="text-faint">…and {trades.length - 6} more trades on this candle</div>}
            {thoughts.slice(-3).map((m, i) => <div key={`t${i}`} className="border-t border-line/60 pt-1.5 text-[#f5b84a]">💭 <span className="text-muted">{m.text}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Simple area chart for portfolio value. */
export function ValueChart({ points, height = 180 }: { points: { time: number; value: number }[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, { ...baseOptions(height), width: el.current.clientWidth, rightPriceScale: { visible: false }, leftPriceScale: { visible: false }, grid: { vertLines: { visible: false }, horzLines: { visible: false } }, handleScroll: false, handleScale: false });
    const upTrend = points.length < 2 || points[points.length - 1].value >= points[0].value;
    const color = upTrend ? cssVar("--up", "#22c993") : cssVar("--down", "#f0506e");
    const s = c.addSeries(AreaSeries, { lineColor: color, topColor: color + "55", bottomColor: color + "00", lineWidth: 2, priceLineVisible: false });
    const seen = new Set<number>();
    s.setData(points.filter((p) => !seen.has(p.time) && seen.add(p.time)).map((p) => ({ time: p.time as UTCTimestamp, value: +p.value })));
    c.timeScale().fitContent();
    const ro = new ResizeObserver(() => el.current && c.applyOptions({ width: el.current.clientWidth }));
    ro.observe(el.current);
    return () => { ro.disconnect(); c.remove(); };
  }, [points, height]);
  return <div ref={el} className="w-full" style={{ height }} />;
}
