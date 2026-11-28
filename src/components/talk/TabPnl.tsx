"use client";
import { useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";

type Pt = { time: number; value: number; trade?: { side: string; symbol: string; qty: number; price: number; usd: number; pnl: number | null } };
const qty = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n >= 1 ? +n.toFixed(4) + "" : n.toPrecision(4));
const px = (n: number) => (n >= 1 ? usd(n) : `$${n.toPrecision(4)}`);
const stamp = (t: number) => new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });

/**
 * A Talk tab's own P&L: only the trades that tab started (its prompts' orders, its bots, its agents, its Auton bots).
 * Realized + unrealized, with a running line. Hover the line for the time, the running P&L and the trade at that point.
 */
export function TabPnl({ conv }: { conv: string }) {
  const { data, refresh } = useApi<any>(`/api/talk/tab-pnl?conv=${conv}`, { refreshMs: 15_000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") refresh(); });
  const pts: Pt[] = data?.points ?? [];
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null); // 0..1 across the chart
  const g = useMemo(() => {
    if (pts.length < 2) return null;
    const vals = [0, ...pts.map((p) => p.value)], min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const t0 = pts[0].time, t1 = pts[pts.length - 1].time || t0 + 1;
    const fx = (t: number) => (t - t0) / (t1 - t0 || 1), fy = (v: number) => (100 - ((v - min) / span) * 92 - 4) / 100;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${(fx(p.time) * 300).toFixed(1)},${(fy(p.value) * 100).toFixed(1)}`).join(" ");
    return { line, zero: fy(0) * 100, fx, fy, t0, t1 };
  }, [pts]);
  // The point nearest the cursor (trades snap the readout to them).
  const hv = useMemo(() => {
    if (hover == null || !g) return null;
    const t = g.t0 + hover * (g.t1 - g.t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
    return best;
  }, [hover, g, pts]);

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
      {g && (
        <div ref={box} className="relative mt-1 h-[64px] cursor-crosshair touch-none select-none"
          onPointerMove={(e) => { const r = box.current?.getBoundingClientRect(); if (r) setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }}
          onPointerDown={(e) => { const r = box.current?.getBoundingClientRect(); if (r) setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }}
          onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label="This tab's P&L">
            <line x1="0" x2="300" y1={g.zero} y2={g.zero} stroke="currentColor" className="text-line-2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <path d={g.line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* trade dots: green = buy, red = sell */}
          {pts.filter((p) => p.trade).map((p, i) => (
            <span key={i} className={cx("pointer-events-none absolute size-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg-2", p.trade!.side === "buy" ? "bg-up" : "bg-down")}
              style={{ left: `${g.fx(p.time) * 100}%`, top: `${g.fy(p.value) * 100}%` }} />
          ))}
          {hv && hover != null && (
            <>
              <span className="pointer-events-none absolute inset-y-0 w-px bg-text/30" style={{ left: `${g.fx(hv.time) * 100}%` }} />
              <span className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-2" style={{ left: `${g.fx(hv.time) * 100}%`, top: `${g.fy(hv.value) * 100}%`, background: color }} />
              <div className={cx("pointer-events-none absolute top-0 z-30 w-max max-w-[240px] rounded-lg border border-line bg-bg-2/95 px-2.5 py-2 text-[11px] shadow-xl backdrop-blur", hover > 0.5 ? "-translate-x-full -ml-2" : "ml-2")}
                style={{ left: `${g.fx(hv.time) * 100}%` }}>
                <div className="text-[10px] text-faint">{stamp(hv.time)}</div>
                <div className={cx("num font-semibold", hv.value >= 0 ? "text-up" : "text-down")}>{hv.value >= 0 ? "+" : "−"}{usd(Math.abs(hv.value))} <span className="font-normal text-muted">{hv.trade ? "realized so far" : "now (incl. open)"}</span></div>
                {hv.trade && (
                  <div className="mt-1 border-t border-line pt-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cx("rounded px-1 text-[9.5px] font-bold uppercase", hv.trade.side === "buy" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{hv.trade.side === "buy" ? "Bought" : "Sold"}</span>
                      <span className="font-semibold text-text">{hv.trade.symbol}</span>
                    </div>
                    <div className="num text-[10.5px] text-muted">{qty(hv.trade.qty)} @ {px(hv.trade.price)} = {usd(hv.trade.usd)}{hv.trade.pnl != null && hv.trade.pnl !== 0 && <span className={hv.trade.pnl > 0 ? " text-up" : " text-down"}> · P&L {hv.trade.pnl > 0 ? "+" : "−"}{usd(Math.abs(hv.trade.pnl))}</span>}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-0.5 text-[10.5px] text-faint">{data.closed} closed trade{data.closed === 1 ? "" : "s"}{data.closed ? ` · ${Math.round((data.wins / data.closed) * 100)}% won` : ""} · {data.bots} bot{data.bots === 1 ? "" : "s"} · {data.agents} agent{data.agents === 1 ? "" : "s"} from this tab{data.open?.length ? ` · holding ${data.open.slice(0, 3).map((o: any) => o.symbol).join(", ")}${data.open.length > 3 ? "…" : ""}` : ""}</div>
    </div>
  );
}
