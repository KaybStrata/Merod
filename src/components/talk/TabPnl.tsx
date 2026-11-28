"use client";
import { useMemo } from "react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";

/**
 * A Talk tab's own P&L: only the trades that tab started (its prompts' orders, its bots, its agents, its Auton bots).
 * Realized + unrealized, with a running line, separate from every other tab and from the whole portfolio.
 */
export function TabPnl({ conv }: { conv: string }) {
  const { data, refresh } = useApi<any>(`/api/talk/tab-pnl?conv=${conv}`, { refreshMs: 15_000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") refresh(); });
  const pts: { time: number; value: number }[] = data?.points ?? [];
  const path = useMemo(() => {
    if (pts.length < 2) return null;
    const vals = [0, ...pts.map((p) => p.value)], min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const t0 = pts[0].time, t1 = pts[pts.length - 1].time || t0 + 1;
    const xy = pts.map((p) => [((p.time - t0) / (t1 - t0 || 1)) * 300, 100 - ((p.value - min) / span) * 92 - 4]);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return { line, zero: 100 - ((0 - min) / span) * 92 - 4 };
  }, [pts]);
  if (!data) return <div className="h-[70px] text-[11px] text-faint">Loading…</div>;
  const up = data.total >= 0, color = up ? "var(--color-up, #22c55e)" : "var(--color-down, #f0506e)";
  if (!data.orders) return (
    <div className="text-[11.5px] text-muted">
      <div className="num text-[13px] font-semibold text-text">$0.00</div>
      No trades from this tab yet. Trades, bots and agents you start here (and Auton, if it reports to this tab) count toward this tab's P&L only.
    </div>
  );
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className={cx("num text-[13px] font-semibold", up ? "text-up" : "text-down")}>{up ? "+" : "−"}{usd(Math.abs(data.total))}</span>
        <span className="num text-[11px] text-muted">realized {data.realized >= 0 ? "+" : "−"}{usd(Math.abs(data.realized))} · open {data.unrealized >= 0 ? "+" : "−"}{usd(Math.abs(data.unrealized))}</span>
        {data.invested > 0 && <span className="num text-[11px] text-faint">/ {usd(data.invested)} traded</span>}
      </div>
      {path && (
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="mt-1 h-[56px] w-full" aria-label="This tab's P&L">
          <line x1="0" x2="300" y1={path.zero} y2={path.zero} stroke="currentColor" className="text-line-2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <path d={path.line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="mt-0.5 text-[10.5px] text-faint">{data.closed} closed trade{data.closed === 1 ? "" : "s"}{data.closed ? ` · ${Math.round((data.wins / data.closed) * 100)}% won` : ""} · {data.bots} bot{data.bots === 1 ? "" : "s"} · {data.agents} agent{data.agents === 1 ? "" : "s"} from this tab{data.open?.length ? ` · holding ${data.open.slice(0, 3).map((o: any) => o.symbol).join(", ")}${data.open.length > 3 ? "…" : ""}` : ""}</div>
    </div>
  );
}
