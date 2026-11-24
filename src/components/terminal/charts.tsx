"use client";
import { useEffect, useRef } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, AreaSeries, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";

/** A trade drawn on the chart: your fills, your bots, hypothetical "ghost" strategy trades, or others' (anonymized). */
export interface ChartMarker { time: number; side: "buy" | "sell"; kind: "mine" | "bot" | "ghost" | "others"; label?: string }

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function baseOptions(height: number) {
  return {
    height,
    layout: { background: { color: "transparent" }, textColor: cssVar("--muted", "#8b93ad"), fontSize: 11, attributionLogo: false },
    grid: { vertLines: { color: cssVar("--line", "#1e2640") + "80" }, horzLines: { color: cssVar("--line", "#1e2640") + "80" } },
    rightPriceScale: { borderColor: cssVar("--line", "#1e2640") },
    timeScale: { borderColor: cssVar("--line", "#1e2640"), timeVisible: true, secondsVisible: false },
    crosshair: { mode: 1 },
  } as const;
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
export function CandleChart({ bars, indicators, live, height = 420, markers = [] }: { bars: Bar[]; indicators: Indicator[]; live?: { price: number; time: number } | null; height?: number; markers?: ChartMarker[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastBar = useRef<Bar | null>(null);
  const tfSec = useRef(3600);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, { ...baseOptions(height), width: el.current.clientWidth });
    chart.current = c;
    const up = cssVar("--up", "#22c993"), down = cssVar("--down", "#f0506e");
    const cs = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
    candles.current = cs;
    const vol = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const data = bars.map((b) => ({ time: b.time as UTCTimestamp, open: +b.open, high: +b.high, low: +b.low, close: +b.close }));
    cs.setData(data);
    markerApi.current = createSeriesMarkers(cs, []);
    vol.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: +b.volume, color: (+b.close >= +b.open ? up : down) + "55" })));
    const closes = bars.map((b) => +b.close);
    const line = (vals: (number | null)[], color: string, width = 1.5) => {
      const s = c.addSeries(LineSeries, { color, lineWidth: width as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(vals.flatMap((v, i) => (v == null ? [] : [{ time: bars[i].time as UTCTimestamp, value: v }])));
    };
    if (indicators.includes("sma20")) line(sma(closes, 20), "#f5b84a");
    if (indicators.includes("ema50")) line(ema(closes, 50), "#4aa8ff");
    if (indicators.includes("bb")) { const b = boll(closes); line(b.map((x) => x?.up ?? null), "#3ddbd388", 1); line(b.map((x) => x?.lo ?? null), "#3ddbd388", 1); }
    c.timeScale().fitContent();
    lastBar.current = bars.length ? { ...bars[bars.length - 1] } : null;
    tfSec.current = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 3600;
    const ro = new ResizeObserver(() => el.current && c.applyOptions({ width: el.current.clientWidth }));
    ro.observe(el.current);
    return () => { ro.disconnect(); c.remove(); chart.current = null; candles.current = null; markerApi.current = null; };
  }, [bars, indicators, height]);

  // Trade markers snapped to candle buckets. Ghost = hypothetical strategy trades (never real orders).
  useEffect(() => {
    if (!markerApi.current || !bars.length) return;
    const step = tfSec.current, first = bars[0].time;
    const style: Record<ChartMarker["kind"], { buy: string; sell: string; shape: "arrowUp" | "arrowDown" | "circle" | "square" }> = {
      mine: { buy: "#22c993", sell: "#f0506e", shape: "arrowUp" },
      bot: { buy: "#4aa8ff", sell: "#7cc4ff", shape: "square" },
      ghost: { buy: "#22c99399", sell: "#f0506e99", shape: "circle" },
      others: { buy: "#8b93ad88", sell: "#8b93ad88", shape: "circle" },
    };
    const out: SeriesMarker<Time>[] = markers
      .filter((m) => m.time >= first)
      .map((m) => {
        const s = style[m.kind];
        return {
          time: (Math.floor(m.time / step) * step) as UTCTimestamp,
          position: m.side === "buy" ? "belowBar" : "aboveBar",
          color: m.side === "buy" ? s.buy : s.sell,
          shape: m.kind === "mine" ? (m.side === "buy" ? "arrowUp" : "arrowDown") : s.shape,
          text: m.label,
          size: m.kind === "others" ? 0.5 : 1,
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

  return <div ref={el} className="w-full" style={{ height }} />;
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
