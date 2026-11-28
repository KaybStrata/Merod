"use client";
import { useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { PnlLine } from "@/components/talk/TabPnl";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";

const RANGES: [string, number | null, string][] = [["1H", 3600, "previous hour"], ["24H", 86_400, "previous 24h"], ["7D", 7 * 86_400, "previous 7 days"], ["30D", 30 * 86_400, "previous 30 days"], ["All", null, ""]];

/** Auton's own P&L (only bots/AI bots Auton made or manages): pick a range; it's compared with the period before. */
export function AutonPnlCard({ className }: { className?: string }) {
  const [ri, setRi] = useState(1);
  const [, label, prevLabel] = [null, RANGES[ri][0], RANGES[ri][2]];
  const range = RANGES[ri][1];
  const pnl = useApi<any>(`/api/auton/pnl${range ? `?range=${range}` : ""}`, { refreshMs: 10_000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") pnl.refresh(); });
  const d = pnl.data;
  const p = d?.period?.pnl ?? 0, prev = d?.previous?.pnl ?? null, up = p >= 0;
  const color = up ? "var(--color-up, #22c55e)" : "var(--color-down, #f0506e)";
  const delta = prev == null ? null : p - prev;
  return (
    <div className={className}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Auton P&L</span>
          <div className="flex rounded-md border border-line p-0.5">
            {RANGES.map(([l], i) => <button key={l} onClick={() => setRi(i)} className={cx("rounded px-1.5 py-0.5 text-[10.5px]", ri === i ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>{l}</button>)}
          </div>
        </div>
        {!d ? <div className="h-[150px] text-[11px] text-faint">Loading…</div> : (
          <>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className={cx("num text-[22px] font-semibold", up ? "text-up" : "text-down")}>{up ? "+" : "−"}{usd(Math.abs(p))}</span>
              <span className="text-[11px] text-muted">{range ? `this ${label === "1H" ? "hour" : label === "24H" ? "24h" : label === "7D" ? "week" : "month"}` : "all time"}</span>
            </div>
            {prev != null && (
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                {delta! >= 0 ? <ArrowUpRight className="size-3.5 text-up" /> : <ArrowDownRight className="size-3.5 text-down" />}
                <span className={cx("num", delta! >= 0 ? "text-up" : "text-down")}>{delta! >= 0 ? "+" : "−"}{usd(Math.abs(delta!))}</span>
                <span className="text-muted">vs {prevLabel} ({prev >= 0 ? "+" : "−"}{usd(Math.abs(prev))})</span>
              </div>
            )}
            <PnlLine pts={d.points ?? []} color={color} height={110} nowLabel={range ? "this period, now (incl. open)" : "now (incl. open)"} />
            <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[10.5px]">
              <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Closed</div><div className="num text-text">{d.period.closed}{prev != null ? <span className="text-faint"> / {d.previous.closed}</span> : null}</div></div>
              <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Won</div><div className="num text-text">{d.period.closed ? Math.round((d.period.wins / d.period.closed) * 100) : 0}%{prev != null && d.previous.closed ? <span className="text-faint"> / {Math.round((d.previous.wins / d.previous.closed) * 100)}%</span> : null}</div></div>
              <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Open</div><div className={cx("num", d.unrealized >= 0 ? "text-up" : "text-down")}>{d.unrealized >= 0 ? "+" : "−"}{usd(Math.abs(d.unrealized))}</div></div>
            </div>
            <div className="mt-1 text-[10.5px] text-faint">All time {d.total >= 0 ? "+" : "−"}{usd(Math.abs(d.total))} · {d.bots} bot{d.bots === 1 ? "" : "s"} · {d.agents} agent{d.agents === 1 ? "" : "s"} · {usd(d.invested)} traded{d.open?.length ? ` · holding ${d.open.slice(0, 3).map((o: any) => o.symbol).join(", ")}` : ""}</div>
          </>
        )}
    </div>
  );
}
