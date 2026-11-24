"use client";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { Pills, Sparkline } from "@/components/ui";
import { usd } from "@/lib/format";

const RANGES = ["1m", "15m", "30m", "1h", "3h", "6h", "12h", "1D", "1W", "1M", "3M", "1Y", "ALL"];
const SHORT = new Set(["1m", "15m", "30m", "1h", "3h", "6h", "12h"]);

/** Account value over time, from 1 minute to all time. Short windows refresh every 15s. */
export function ValueHistory({ initial = "1D", height = 150 }: { initial?: string; height?: number }) {
  const [range, setRange] = useState(initial);
  const h = useApi<any>(`/api/portfolio/history?range=${range}`, { refreshMs: SHORT.has(range) ? 15_000 : 120_000 });
  const points: number[] = (h.data?.points ?? []).map((p: any) => Number(p.value));
  const first = points[0], last = points.at(-1);
  const change = first && last != null ? last - first : null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {last != null && <span className="num text-sm font-semibold text-text">{usd(last)}</span>}
          {change != null && <span className={change >= 0 ? "ml-2 text-up" : "ml-2 text-down"}>{change >= 0 ? "+" : ""}{usd(change)} ({((change / first) * 100).toFixed(2)}%) · {range}</span>}
          {h.data?.estimated && <span className="ml-2 text-faint" title={h.data.note}>estimated</span>}
        </div>
        <div className="max-w-full overflow-x-auto"><Pills size="sm" value={range} onChange={setRange} options={RANGES.map((v) => ({ value: v, label: v }))} /></div>
      </div>
      {h.error ? <div className="flex h-36 items-center justify-center text-xs text-muted">Value history unavailable ({h.error})</div>
        : points.length > 1 ? <Sparkline data={points} width={720} height={height} className="h-36 w-full" />
        : <div className="flex h-36 items-center justify-center text-xs text-muted">{h.loading ? "Loading…" : "Not enough history for this window yet."}</div>}
    </div>
  );
}
