"use client";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";

type Pt = { time: number; value: number };
const RANGES = ["1D", "1W", "1M", "ALL"] as const;

/**
 * Portfolio value / P&L chart (paper book) from /api/portfolio/history. The last point is always the live value.
 * Shows the change for the chosen range and draws an area chart, green when up and red when down.
 */
export function PortfolioSpark({ height = 56, compact = false, className }: { height?: number; compact?: boolean; className?: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1D");
  const { data, refresh } = useApi<any>(`/api/portfolio/history?range=${range}`, { refreshMs: 30_000 });
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
      <div className="flex items-center justify-between gap-2">
        {!compact && <span className={cx("num text-[12px] font-semibold", up ? "text-up" : "text-down")}>{pts.length > 1 ? `${up ? "+" : "−"}${usd(Math.abs(change))} (${first ? ((change / first) * 100).toFixed(2) : "0.00"}%)` : "—"}</span>}
        <div className="ml-auto flex gap-0.5 text-[10px]">
          {RANGES.map((r) => <button key={r} onClick={(e) => { e.stopPropagation(); setRange(r); }} className={cx("rounded px-1.5 py-px", range === r ? "bg-accent-soft text-accent-2" : "text-faint hover:text-text")}>{r}</button>)}
        </div>
      </div>
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
