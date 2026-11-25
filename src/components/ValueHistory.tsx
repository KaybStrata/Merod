"use client";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { Sparkline } from "@/components/ui";
import { TimeRangePicker, range, type Range } from "@/components/TimeRange";
import { usd } from "@/lib/format";


/** Account value over time, from 1 minute to all time. Short windows refresh every 15s. */
export function ValueHistory({ initial = "1D", height = 150 }: { initial?: string; height?: number }) {
  const [rng, setRng] = useState<Range>(range(initial));
  const h = useApi<any>(`/api/portfolio/history?seconds=${rng.seconds}`, { refreshMs: rng.seconds <= 12 * 3600 ? 15_000 : 120_000 });
  const points: number[] = (h.data?.points ?? []).map((p: any) => Number(p.value));
  const first = points[0], last = points.at(-1);
  const change = first && last != null ? last - first : null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {last != null && <span className="num text-sm font-semibold text-text">{usd(last)}</span>}
          {change != null && <span className={change >= 0 ? "ml-2 text-up" : "ml-2 text-down"}>{change >= 0 ? "+" : ""}{usd(change)} ({((change / first) * 100).toFixed(2)}%) · {rng.label}</span>}
          {h.data?.estimated && <span className="ml-2 text-faint" title={h.data.note}>estimated</span>}
        </div>
        <TimeRangePicker value={rng} onChange={setRng} size="sm" />
      </div>
      {h.error ? <div className="flex h-36 items-center justify-center text-xs text-muted">Value history unavailable ({h.error})</div>
        : points.length > 1 ? <Sparkline data={points} width={720} height={height} className="h-36 w-full" />
        : <div className="flex h-36 items-center justify-center text-xs text-muted">{h.loading ? "Loading…" : "Not enough history for this window yet."}</div>}
    </div>
  );
}
