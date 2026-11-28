"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";
import { dialToSec, secLabel } from "@/lib/timeDial";
import { TimeDial } from "@/components/TimeDial";
import { ProfitToggle, useProfitOnly } from "@/components/ScopePnl";

type Pt = { time: number; value: number };
type Trade = { id: string; time: number; side: "buy" | "sell"; source: string; symbol: string; quantity: number; price: number; usd: number; feeUsd: number; realizedPnl: number | null };
const qty = (n: number) => n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n >= 1 ? +n.toFixed(4) + "" : n.toPrecision(4);
const px = (n: number) => n >= 1 ? usd(n) : `$${n.toPrecision(4)}`;
const SOURCE: Record<string, string> = { manual: "you", prompt: "prompt", shortcut: "shortcut", bot: "bot", conditional: "conditional", system: "Merod", copy: "Mimic", auto: "Auto", agent: "agent" };
const RANGES = ["1m", "15m", "30m", "1H", "6H", "12H", "1D", "1W", "1M", "ALL", "Custom"] as const;
/** Short windows are sent as ?seconds= so the API's preset names (1m = minute, 1M = month) never get confused. */
const SHORT: Record<string, number> = { "1m": 60, "15m": 900, "30m": 1800, "1H": 3600, "6H": 21_600, "12H": 43_200 };
/** Change in percent, with enough digits that a small move on a big balance doesn't read as 0.00%. */
const pctLabel = (change: number, base: number) => {
  if (!base) return "0.00";
  const p = (change / base) * 100, a = Math.abs(p);
  return a === 0 ? "0.00" : a >= 0.01 ? p.toFixed(2) : a >= 0.0001 ? p.toFixed(4) : "<0.0001";
};
/** Custom dial: shared with the Review (src/lib/timeDial.ts), 1 minute → 5 years on a log scale. */

/**
 * Portfolio value / P&L chart (paper book) from /api/portfolio/history. The last point is always the live value.
 * Shows the change for the chosen range and draws an area chart, green when up and red when down.
 */
/** `seconds`: lock the chart to a window that ends now (the Review uses this); the range buttons are hidden. */
export function PortfolioSpark({ height = 56, compact = false, className, seconds, onChange }: { height?: number; compact?: boolean; className?: string; seconds?: number; /** the change for the chosen range, so a parent can show the same number */ onChange?: (c: { change: number; pct: string; label: string; ready: boolean }) => void }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1D");
  // "Profit": show only profit/loss from closed trades in this window (shared switch with every other P&L graph).
  const [profitOnly, setProfitOnly] = useProfitOnly();
  // Break even: measure against what you put in (starting balance + deposits − withdrawals) instead of the range's start.
  const [beOn, setBeOn] = useState(() => { try { return localStorage.getItem("merod-pnl-breakeven") === "1"; } catch { return false; } });
  const toggleBe = () => setBeOn((v) => { try { localStorage.setItem("merod-pnl-breakeven", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const [dialSec, setDialSec] = useState(() => dialToSec(45));
  const { data, refresh } = useApi<any>(seconds ? `/api/portfolio/history?seconds=${Math.max(60, Math.round(seconds))}` : range === "Custom" ? `/api/portfolio/history?seconds=${Math.max(60, dialSec)}` : SHORT[range] ? `/api/portfolio/history?seconds=${SHORT[range]}` : `/api/portfolio/history?range=${range}`, { refreshMs: 30_000 });
  useRealtime((e) => { if (e.type === "fill") refresh(); });
  const allPts: Pt[] = useMemo(() => (data?.points ?? []).map((p: any) => ({ time: Number(p.time), value: Number(p.value) })).filter((p: Pt) => Number.isFinite(p.value)), [data]);
  // Zoom: scroll over the chart to zoom around the cursor, drag to pan, double-click to reset. A zoomed window fetches its
  // own finer data (down to 1-minute bars) and switches to candlesticks; trade dots get labels when zoomed in close.
  const [zoom, setZoom] = useState<{ a: number; b: number } | null>(null);
  const [zoomQ, setZoomQ] = useState<{ a: number; b: number } | null>(null);
  useEffect(() => { const t = setTimeout(() => setZoomQ(zoom), 250); return () => clearTimeout(t); }, [zoom]);
  useEffect(() => { setZoom(null); }, [range, dialSec, seconds]);
  const zData = useApi<any>(zoomQ ? `/api/portfolio/history?from=${Math.floor(zoomQ.a)}&to=${Math.ceil(zoomQ.b)}` : null).data;
  const [mode, setMode] = useState<"auto" | "line" | "candles">("auto");
  const candles = mode === "candles" || (mode === "auto" && !!zoom);
  const pts: Pt[] = useMemo(() => {
    if (!zoom) return allPts;
    const fine: Pt[] = (zData?.points ?? []).map((p: any) => ({ time: Number(p.time), value: Number(p.value) })).filter((p: Pt) => Number.isFinite(p.value));
    const src = fine.length >= 2 ? fine : allPts;
    const inside = src.filter((p) => p.time >= zoom.a && p.time <= zoom.b);
    // Carry the value in from just before the window so the line starts at the left edge.
    const prev = [...src].reverse().find((p) => p.time < zoom.a) ?? src[0];
    const lastIn = inside[inside.length - 1] ?? prev;
    const atEnd = [...src].reverse().find((p) => p.time <= zoom.b) ?? lastIn;
    // Always span the whole window (left edge carried in, right edge = last known value), so a quiet stretch still draws.
    const out = [{ time: zoom.a, value: prev?.value ?? atEnd?.value ?? 0 }, ...inside.filter((p) => p.time > zoom.a && p.time < zoom.b)];
    out.push({ time: zoom.b, value: atEnd?.value ?? out[out.length - 1].value });
    return out;
  }, [zoom, zData, allPts]);
  const breakEven: number | null = data?.breakEven ? Number(data.breakEven) : null;
  const useBe = beOn && !!breakEven;
  const first = useBe ? breakEven! : pts[0]?.value ?? 0, last = pts[pts.length - 1]?.value ?? 0, change = last - first;
  const up = change >= 0;
  const windowSec: number | null = seconds ?? (range === "Custom" ? dialSec : SHORT[range] ?? ({ "1D": 86_400, "1W": 604_800, "1M": 2_592_000 } as Record<string, number>)[range] ?? null);
  const rangeLabel = seconds ? secLabel(seconds) : range === "Custom" ? secLabel(dialSec) : range;
  const ready = pts.length > 1;
  useEffect(() => { onChange?.({ change, pct: `${up ? "" : "−"}${pctLabel(Math.abs(change), first)}%`, label: rangeLabel, ready }); }, [change, first, rangeLabel, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const trades: Trade[] = useMemo(() => {
    const src: Trade[] = (zoom && zData?.trades ? zData.trades : data?.trades) ?? [];
    return src.filter((t: Trade) => Number.isFinite(t.time) && (!zoom || (t.time >= zoom.a && t.time <= zoom.b)));
  }, [data, zData, zoom]);
  const path = useMemo(() => {
    if (pts.length < 2) return null;
    const vals = [...pts.map((p) => p.value), ...(useBe ? [breakEven!] : [])];
    const w = 300, h = 100, min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || Math.max(1, Math.abs(max) * 0.001);
    const t0 = zoom?.a ?? pts[0].time, t1 = zoom?.b ?? (pts[pts.length - 1].time || t0 + 1);
    const fx = (t: number) => Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));   // 0..1 across
    const fy = (v: number) => (h - ((v - min) / span) * (h - 8) - 4) / h;            // 0..1 down
    const xy = pts.map((p) => [fx(p.time) * w, fy(p.value) * h]);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    // Candlesticks: open/high/low/close of the portfolio value in ~36 equal time buckets.
    const n = Math.max(8, Math.min(48, Math.round(pts.length / 2)));
    const bw = (t1 - t0) / n, bars: { x: number; w: number; o: number; h: number; l: number; c: number; t: number }[] = [];
    let carry = pts[0].value, j = 0;
    for (let i = 0; i < n; i++) {
      const s0 = t0 + i * bw, s1 = s0 + bw, vals: number[] = [carry];
      while (j < pts.length && pts[j].time < s1) { if (pts[j].time >= s0) vals.push(pts[j].value); j++; }
      const c = vals[vals.length - 1];
      bars.push({ x: (i / n) * w, w: w / n, o: vals[0], h: Math.max(...vals), l: Math.min(...vals), c, t: s0 });
      carry = c;
    }
    return { line, area: `${line} L${w},${h} L0,${h} Z`, fx, fy, t0, t1, bars };
  }, [pts, useBe, breakEven, zoom]);
  /** Portfolio value at time t (the last recorded point at or before t). */
  const valueAt = (t: number) => {
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].time <= t) lo = m; else hi = m - 1; }
    return pts[lo]?.value ?? first;
  };
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ f: number; w: number } | null>(null);
  const full = useMemo(() => (allPts.length >= 2 ? { a: allPts[0].time, b: allPts[allPts.length - 1].time } : null), [allPts]);
  const zoomBy = (factor: number, f = 0.5) => {
    if (!full) return;
    const cur = zoom ?? full, spanNow = cur.b - cur.a, at = cur.a + f * spanNow;
    const next = Math.max(60, spanNow * factor);
    if (next >= full.b - full.a) { setZoom(null); return; }
    let a = at - f * next, b = a + next;
    if (a < full.a) { a = full.a; b = a + next; }
    if (b > full.b) { b = full.b; a = b - next; }
    setZoom({ a, b });
  };
  const zoomRef = useRef(zoomBy); zoomRef.current = zoomBy;
  useEffect(() => {
    const el = boxRef.current;
    if (!el || compact) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(e.deltaY < 0 ? 0.7 : 1 / 0.7, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  const drag = useRef<{ x: number; a: number; b: number } | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !path) return;
    if (drag.current && zoom && full && e.buttons === 1) {
      const dt = ((e.clientX - drag.current.x) / r.width) * (drag.current.b - drag.current.a);
      let a = drag.current.a - dt, b = drag.current.b - dt;
      if (a < full.a) { b += full.a - a; a = full.a; }
      if (b > full.b) { a -= b - full.b; b = full.b; }
      setZoom({ a, b });
    }
    setHover({ f: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), w: r.width });
  };
  const onDown = (e: React.PointerEvent) => { if (zoom) drag.current = { x: e.clientX, a: zoom.a, b: zoom.b }; onMove(e); };
  const hv = useMemo(() => {
    if (!hover || !path) return null;
    const t = path.t0 + hover.f * (path.t1 - path.t0);
    // Trades within ~7px of the cursor snap the readout to them.
    const tol = (7 / Math.max(1, hover.w)) * (path.t1 - path.t0);
    const near = trades.filter((x) => Math.abs(x.time - t) <= tol).sort((a, b) => Math.abs(a.time - t) - Math.abs(b.time - t)).slice(0, 4);
    const at = near[0]?.time ?? t;
    return { t: at, v: valueAt(at), near };
  }, [hover, path, trades, pts]); // eslint-disable-line react-hooks/exhaustive-deps
  const span = (path?.t1 ?? 0) - (path?.t0 ?? 0);
  const stamp = (t: number) => {
    const d = new Date(t * 1000);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(span <= 6 * 3600 ? { second: "2-digit" as const } : {}) });
    return span <= 86_400 ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric", ...(span > 300 * 86_400 ? { year: "numeric" as const } : {}) })} · ${time}`;
  };
  const color = up ? "var(--color-up, #22c55e)" : "var(--color-down, #f0506e)";
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {!compact && <span className={cx("num whitespace-nowrap text-[12px] font-semibold", up ? "text-up" : "text-down")}>{pts.length > 1 ? `${up ? "+" : "−"}${usd(Math.abs(change))} (${up ? "" : "−"}${pctLabel(Math.abs(change), first)}%)` : "—"}{useBe && <span className="ml-1 font-normal text-faint">vs {usd(breakEven!)} put in</span>}</span>}
        {/* P&L out of the initial investment, e.g. "+$300 / $100,000": total made since you started vs what you put in. */}
        {!compact && breakEven != null && pts.length > 0 && (() => {
          const made = last - breakEven;
          return (
            <span className="num order-last w-full whitespace-nowrap text-[11.5px] text-muted" title={`Total P&L since you started out of your initial investment (${usd(breakEven)} = starting balance + deposits − withdrawals)`}>
              <span className={cx("font-semibold", made >= 0 ? "text-up" : "text-down")}>{made >= 0 ? "+" : "−"}{usd(Math.abs(made))}</span>
              <span className="text-faint"> / </span>{usd(breakEven)}<span className="text-faint"> invested · {made >= 0 ? "+" : "−"}{pctLabel(Math.abs(made), breakEven)}% all-time</span>
            </span>
          );
        })()}
        {!compact && (
          <button onClick={(e) => { e.stopPropagation(); toggleBe(); }} aria-pressed={beOn}
            title={breakEven ? `Break-even P&L: how much you've made after your initial investment (${usd(breakEven)} = starting balance + deposits − withdrawals)` : "Break-even P&L: how much you've made after your initial investment"}
            className={cx("flex items-center gap-1 rounded-md border px-1.5 py-px text-[10px]", beOn ? "border-accent/50 bg-accent-soft text-accent-2" : "border-line text-faint hover:text-text")}>
            <span className={cx("inline-block h-2 w-3.5 rounded-full p-px transition", beOn ? "bg-accent-2" : "bg-line-2")}><span className={cx("block size-1.5 rounded-full bg-bg transition", beOn && "translate-x-1.5")} /></span>
            Break-even P&L
          </button>
        )}
        <span onClick={(e) => e.stopPropagation()}><ProfitToggle on={profitOnly} onChange={setProfitOnly} /></span>
        {seconds ? <span className="ml-auto text-[10px] text-faint">last {secLabel(seconds)}</span> : compact ? (
          <select value={range} aria-label="Time range" onClick={(e) => e.stopPropagation()} onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])}
            className="ml-auto rounded border border-line bg-bg-2 px-1 py-px text-[10px] text-muted outline-none">
            {RANGES.map((r) => <option key={r} value={r}>{r === "Custom" && range === "Custom" ? secLabel(dialSec) : r}</option>)}
          </select>
        ) : (
          <div className="ml-auto flex flex-wrap justify-end gap-0.5 text-[10px]">
            {RANGES.map((r) => <button key={r} onClick={(e) => { e.stopPropagation(); setRange(r); }} className={cx("rounded px-1.5 py-px", range === r ? "bg-accent-soft text-accent-2" : "text-faint hover:text-text")}>{r === "Custom" && range === "Custom" ? secLabel(dialSec) : r}</button>)}
          </div>
        )}
      </div>
      {/* Break-even P&L meter: what you've made after your initial investment, on a gauge centred at break-even. */}
      {beOn && !compact && breakEven != null && pts.length > 0 && (() => {
        const after = last - breakEven, p = (after / breakEven) * 100, w = 50 * Math.min(1, Math.sqrt(Math.abs(p) / 10));
        return (
          <div className="mt-1.5 rounded-lg border border-line bg-bg-2/60 px-2.5 py-1.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-muted">After your initial {usd(breakEven)}</span>
              <span className={cx("num font-semibold", after >= 0 ? "text-up" : "text-down")}>{after >= 0 ? "+" : "−"}{usd(Math.abs(after))} ({after >= 0 ? "+" : "−"}{pctLabel(Math.abs(after), breakEven)}%)</span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-panel-2" role="meter" aria-valuenow={after} aria-label="Break-even P&L">
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-text/40" />
              <span className={cx("absolute inset-y-0 rounded-full", after >= 0 ? "left-1/2 bg-up/80" : "right-1/2 bg-down/80")} style={{ width: `${Math.max(0.6, w)}%` }} />
            </div>
            <div className="mt-0.5 flex justify-between text-[9px] text-faint"><span>−10%</span><span>break even</span><span>+10%</span></div>
          </div>
        );
      })()}
      {range === "Custom" && !seconds && <TimeDial value={dialSec} onChange={setDialSec} className="mt-1.5" />}
      {path ? (
        <div ref={boxRef} className="relative mt-1 cursor-crosshair touch-none select-none" style={{ height }}
          onPointerMove={onMove} onPointerDown={onDown} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { setHover(null); drag.current = null; }}
          onDoubleClick={(e) => { e.stopPropagation(); setZoom(null); }} onClick={(e) => e.stopPropagation()}
          title={compact ? undefined : "Scroll to zoom · drag to move · double-click to reset"}>
          <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label={`Portfolio ${range}: ${up ? "up" : "down"} ${usd(Math.abs(change))}`}>
            <defs><linearGradient id={`pf-${range}-${up}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
            {!candles && <path d={path.area} fill={`url(#pf-${range}-${up})`} />}
            {!candles && <path d={path.line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
            {candles && path.bars.map((c, i) => {
              const upc = c.c >= c.o, col = upc ? "var(--color-up, #22c55e)" : "var(--color-down, #f0506e)";
              const yo = path.fy(c.o) * 100, yc = path.fy(c.c) * 100;
              return (
                <g key={i}>
                  <line x1={c.x + c.w / 2} x2={c.x + c.w / 2} y1={path.fy(c.h) * 100} y2={path.fy(c.l) * 100} stroke={col} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <rect x={c.x + c.w * 0.18} width={c.w * 0.64} y={Math.min(yo, yc)} height={Math.max(0.8, Math.abs(yc - yo))} fill={col} fillOpacity={upc ? 0.85 : 0.9} />
                </g>
              );
            })}
            {useBe && <line x1="0" x2="300" y1={path.fy(breakEven!) * 100} y2={path.fy(breakEven!) * 100} stroke="currentColor" className="text-muted" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
          </svg>
          {profitOnly && <NeonProfit seconds={windowSec} t0={path.t0} t1={path.t1} compact={compact} />}
          {/* Trade dots: green = buy, red = sell. */}
          {!compact && trades.map((x) => (
            <span key={x.id} className={cx("pointer-events-none absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg-2", x.side === "buy" ? "bg-up" : "bg-down")}
              style={{ left: `${path.fx(x.time) * 100}%`, top: `${path.fy(valueAt(x.time)) * 100}%` }}>
              {/* Zoomed in close: label each trade right on the chart. */}
              {zoom && trades.length <= 14 && <span className={cx("absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[9px] font-semibold", x.side === "buy" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{x.side === "buy" ? "B" : "S"} {x.symbol}{x.realizedPnl ? ` ${x.realizedPnl > 0 ? "+" : "−"}${usd(Math.abs(x.realizedPnl))}` : ""}</span>}
            </span>
          ))}
          {!compact && (
            <div className="absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-md border border-line bg-bg-2/80 p-0.5 text-[10px] backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <button onClick={(e) => { e.stopPropagation(); zoomBy(0.5); }} className="rounded px-1 text-muted hover:text-text" aria-label="Zoom in" title="Zoom in (or scroll)">＋</button>
              <button onClick={(e) => { e.stopPropagation(); zoomBy(2); }} disabled={!zoom} className="rounded px-1 text-muted hover:text-text disabled:opacity-40" aria-label="Zoom out" title="Zoom out">−</button>
              <button onClick={(e) => { e.stopPropagation(); setMode(candles ? "line" : "candles"); }} className={cx("rounded px-1", candles ? "text-accent-2" : "text-muted hover:text-text")} title="Line / candlesticks">{candles ? "Candles" : "Line"}</button>
              {zoom && <button onClick={(e) => { e.stopPropagation(); setZoom(null); }} className="rounded px-1 text-accent-2 hover:underline" title="Back to the full range">Reset</button>}
            </div>
          )}
          {zoom && !compact && <span className="pointer-events-none absolute bottom-0.5 left-1 z-10 rounded bg-bg-2/80 px-1 text-[9.5px] text-faint">{stamp(zoom.a)} → {stamp(zoom.b)} · {secLabel(Math.round(zoom.b - zoom.a))}{zoomQ && !zData ? " · loading detail…" : zData?.resolutionSec ? ` · ${zData.resolutionSec >= 3600 ? `${zData.resolutionSec / 3600}h` : `${Math.round(zData.resolutionSec / 60)}m`} detail` : ""}</span>}
          {hv && hover && (
            <>
              <span className="pointer-events-none absolute inset-y-0 w-px bg-text/30" style={{ left: `${path.fx(hv.t) * 100}%` }} />
              <span className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-2" style={{ left: `${path.fx(hv.t) * 100}%`, top: `${path.fy(hv.v) * 100}%`, background: color }} />
              <div className={cx("pointer-events-none absolute top-0 z-30 w-max max-w-[260px] rounded-lg border border-line bg-bg-2/95 px-2.5 py-2 text-[11px] shadow-xl backdrop-blur",
                  hover.f > 0.5 ? "-translate-x-full -ml-2" : "ml-2")} style={{ left: `${path.fx(hv.t) * 100}%` }}>
                <div className="text-[10px] text-faint">{stamp(hv.t)}</div>
                <div className="num font-semibold text-text">{usd(hv.v)}</div>
                {candles && (() => { const c = path.bars.find((b) => hv.t >= b.t && hv.t < b.t + (path.t1 - path.t0) / path.bars.length); return c ? <div className="num text-[10px] text-muted">O {usd(c.o)} · H {usd(c.h)} · L {usd(c.l)} · C {usd(c.c)}</div> : null; })()}
                <div className={cx("num text-[10.5px]", hv.v - first >= 0 ? "text-up" : "text-down")}>
                  {hv.v - first >= 0 ? "+" : "−"}{usd(Math.abs(hv.v - first))} ({hv.v - first >= 0 ? "" : "−"}{pctLabel(Math.abs(hv.v - first), first)}%) {useBe ? "vs break-even" : "since start"}
                </div>
                {hv.near.length > 0 && (
                  <div className="mt-1.5 space-y-1 border-t border-line pt-1.5">
                    {hv.near.map((x) => (
                      <div key={x.id}>
                        <div className="flex items-center gap-1.5">
                          <span className={cx("rounded px-1 text-[9.5px] font-bold uppercase", x.side === "buy" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{x.side === "buy" ? "Bought" : "Sold"}</span>
                          <span className="font-semibold text-text">{x.symbol}</span>
                          <span className="ml-auto text-[10px] text-faint">{new Date(x.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                        </div>
                        <div className="num text-[10.5px] text-muted">
                          {qty(x.quantity)} @ {px(x.price)} = {usd(x.usd)} · by {SOURCE[x.source] ?? x.source}
                          {x.realizedPnl !== null && x.realizedPnl !== 0 && <span className={x.realizedPnl > 0 ? " text-up" : " text-down"}> · P&L {x.realizedPnl > 0 ? "+" : "−"}{usd(Math.abs(x.realizedPnl))}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : <div className="mt-1 flex items-center gap-2 text-[10.5px] text-faint" style={{ height }}>{data ? "Not enough history yet" : "Loading…"}{zoom && <button onClick={(e) => { e.stopPropagation(); setZoom(null); }} className="text-accent-2 hover:underline">Reset zoom</button>}</div>}
    </div>
  );
}

/**
 * Neon green profit line over the portfolio chart: closed-trade profit from every source over the same window,
 * drawn on its own scale (0 = no profit yet) so it reads clearly on top of the value line.
 */
function NeonProfit({ seconds, t0, t1, compact }: { seconds: number | null; t0: number; t1: number; compact?: boolean }) {
  const { data } = useApi<any>(`/api/pnl/scope?scope=trades${seconds ? `&range=${Math.max(60, Math.round(seconds))}` : ""}`, { refreshMs: 15_000 });
  if (!data) return null;
  const pts: { time: number; value: number }[] = [...data.points.slice(0, -1), { time: data.points[data.points.length - 1].time, value: data.period.realized }];
  const vals = [0, ...pts.map((p) => p.value)], min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const fx = (t: number) => Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1))), fy = (v: number) => (100 - ((v - min) / span) * 84 - 8) / 100;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(fx(p.time) * 300).toFixed(1)},${(fy(p.value) * 100).toFixed(1)}`).join(" ");
  const v = data.period.realized;
  return (
    <>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full [filter:drop-shadow(0_0_3px_#39ff14)_drop-shadow(0_0_9px_#39ff14)]" aria-label="Profit line (closed trades)">
        <path d={d} fill="none" stroke="#39ff14" strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {!compact && <span className="num pointer-events-none absolute left-1 top-0.5 rounded bg-bg-2/80 px-1 text-[10.5px] font-semibold text-[#39ff14] [text-shadow:0_0_8px_#39ff14]">profit {v >= 0 ? "+" : "−"}{usd(Math.abs(v))} · {data.period.closed} closed</span>}
    </>
  );
}
