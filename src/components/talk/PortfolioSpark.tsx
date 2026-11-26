"use client";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";

type Pt = { time: number; value: number };
const RANGES = ["1m", "15m", "30m", "1H", "6H", "12H", "1D", "1W", "1M", "ALL", "Custom"] as const;
/** Short windows are sent as ?seconds= so the API's preset names (1m = minute, 1M = month) never get confused. */
const SHORT: Record<string, number> = { "1m": 60, "15m": 900, "30m": 1800, "1H": 3600, "6H": 21_600, "12H": 43_200 };
/** Change in percent, with enough digits that a small move on a big balance doesn't read as 0.00%. */
const pctLabel = (change: number, base: number) => {
  if (!base) return "0.00";
  const p = (change / base) * 100, a = Math.abs(p);
  return a === 0 ? "0.00" : a >= 0.01 ? p.toFixed(2) : a >= 0.0001 ? p.toFixed(4) : "<0.0001";
};
/** Custom dial: 0–100 mapped on a log scale from 1 minute to 5 years. */
const MIN_S = 60, MAX_S = 5 * 365 * 86_400;
const dialToSec = (v: number) => Math.round(MIN_S * Math.pow(MAX_S / MIN_S, v / 100));
const secLabel = (s: number) => s < 3600 ? `${Math.round(s / 60)}m` : s < 86_400 ? `${+(s / 3600).toFixed(s < 36_000 ? 1 : 0)}h` : s < 30 * 86_400 ? `${+(s / 86_400).toFixed(s < 864_000 ? 1 : 0)}d` : s < 365 * 86_400 ? `${+(s / (30 * 86_400)).toFixed(1)}mo` : `${+(s / (365 * 86_400)).toFixed(1)}y`;

/**
 * Portfolio value / P&L chart (paper book) from /api/portfolio/history. The last point is always the live value.
 * Shows the change for the chosen range and draws an area chart, green when up and red when down.
 */
export function PortfolioSpark({ height = 56, compact = false, className }: { height?: number; compact?: boolean; className?: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1D");
  const [dial, setDial] = useState(45);
  const [dialSec, setDialSec] = useState(() => dialToSec(45));
  const { data, refresh } = useApi<any>(range === "Custom" ? `/api/portfolio/history?seconds=${Math.max(60, dialSec)}` : SHORT[range] ? `/api/portfolio/history?seconds=${SHORT[range]}` : `/api/portfolio/history?range=${range}`, { refreshMs: 30_000 });
  useRealtime((e) => { if (e.type === "fill") refresh(); });
  const pts: Pt[] = useMemo(() => (data?.points ?? []).map((p: any) => ({ time: Number(p.time), value: Number(p.value) })).filter((p: Pt) => Number.isFinite(p.value)), [data]);
  const first = pts[0]?.value ?? 0, last = pts[pts.length - 1]?.value ?? 0, change = last - first;
  const up = change >= 0;
  const path = useMemo(() => {
    if (pts.length < 2) return null;
    const w = 300, h = 100, min = Math.min(...pts.map((p) => p.value)), max = Math.max(...pts.map((p) => p.value));
    const span = max - min || Math.max(1, Math.abs(max) * 0.001);
    const t0 = pts[0].time, t1 = pts[pts.length - 1].time || t0 + 1;
    const xy = pts.map((p) => [((p.time - t0) / (t1 - t0 || 1)) * w, h - ((p.value - min) / span) * (h - 8) - 4]);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return { line, area: `${line} L${w},${h} L0,${h} Z` };
  }, [pts]);
  const color = up ? "var(--color-up, #22c55e)" : "var(--color-down, #f0506e)";
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {!compact && <span className={cx("num whitespace-nowrap text-[12px] font-semibold", up ? "text-up" : "text-down")}>{pts.length > 1 ? `${up ? "+" : "−"}${usd(Math.abs(change))} (${up ? "" : "−"}${pctLabel(Math.abs(change), first)}%)` : "—"}</span>}
        {compact ? (
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
      {range === "Custom" && (
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-faint" onClick={(e) => e.stopPropagation()}>
          <span>1m</span>
          <input type="range" min={0} max={100} step={1} value={dial} aria-label="Custom time range"
            onChange={(e) => setDial(Number(e.target.value))}
            onPointerUp={() => setDialSec(dialToSec(dial))} onKeyUp={() => setDialSec(dialToSec(dial))} onTouchEnd={() => setDialSec(dialToSec(dial))}
            className="h-1 flex-1 cursor-pointer accent-[var(--color-accent-2,#d6b37a)]" />
          <span>5y</span>
          <span className="num w-12 text-right font-semibold text-accent-2">{secLabel(dialToSec(dial))}</span>
        </div>
      )}
      {path ? (
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="mt-1 w-full" style={{ height }} aria-label={`Portfolio ${range}: ${up ? "up" : "down"} ${usd(Math.abs(change))}`}>
          <defs><linearGradient id={`pf-${range}-${up}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
          <path d={path.area} fill={`url(#pf-${range}-${up})`} />
          <path d={path.line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : <div className="mt-1 flex items-center text-[10.5px] text-faint" style={{ height }}>{data ? "Not enough history yet" : "Loading…"}</div>}
    </div>
  );
}
