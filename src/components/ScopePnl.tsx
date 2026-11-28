"use client";
import { useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { PnlLine } from "@/components/talk/TabPnl";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";

export type PnlScope = "trades" | "bot" | "auto" | "modo" | "copy" | "auton" | "prompt" | "manual";
const RANGES: [string, number | null, string, string][] = [
  ["1H", 3600, "previous hour", "this hour"], ["24H", 86_400, "previous 24h", "last 24h"], ["7D", 7 * 86_400, "previous 7 days", "this week"],
  ["30D", 30 * 86_400, "previous 30 days", "this month"], ["All", null, "", "all time"],
];
export const SCOPE_TITLE: Record<PnlScope, string> = { trades: "All trades", bot: "Bots", auto: "Auto trading", modo: "Modo", copy: "Mimic", auton: "Auton", prompt: "Prompts", manual: "Your orders" };

/** Shared "Profit" toggle (remembered): the line shows profit/loss from closed trades only, without open positions. */
export function useProfitOnly(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem("merod-pnl-profit") === "1"; } catch { return false; } });
  return [on, (v: boolean) => { setOn(v); try { localStorage.setItem("merod-pnl-profit", v ? "1" : "0"); } catch { /* ignore */ } }];
}
export function ProfitToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} title={on ? "Showing profit/loss from closed trades only. Click to include open positions." : "Show only profit/loss from closed (sold) trades"}
      className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px]", on ? "border-up/50 bg-up/10 text-up" : "border-line text-muted hover:text-text")}>
      <span className={cx("relative h-2.5 w-4 rounded-full", on ? "bg-up" : "bg-panel-2 ring-1 ring-line")}><span className={cx("absolute top-[1px] size-2 rounded-full bg-white transition-all", on ? "left-[7px]" : "left-[1px]")} /></span>Profit
    </button>
  );
}

/**
 * One group's own P&L graph (all trades, bots, auto, Modo, Mimic, Auton…), optionally only what one Talk tab started.
 * Pick a range; it's compared with the period before. "Profit" shows closed-trade profit only.
 */
export function ScopePnlCard({ scope, conv, refId, title, className }: { scope: PnlScope; conv?: string | null; refId?: string; title?: string; className?: string }) {
  const [ri, setRi] = useState(1);
  const [profitOnly, setProfitOnly] = useProfitOnly();
  const [label, range, prevLabel, nowLabel] = [RANGES[ri][0], RANGES[ri][1], RANGES[ri][2], RANGES[ri][3]];
  const pnl = useApi<any>(`/api/pnl/scope?scope=${scope}${range ? `&range=${range}` : ""}${conv ? `&conv=${conv}` : ""}${refId ? `&ref=${refId}` : ""}`, { refreshMs: 10_000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") pnl.refresh(); });
  const d = pnl.data;
  const p = profitOnly ? (d?.period?.realized ?? 0) : (d?.period?.pnl ?? 0), prev = d?.previous?.pnl ?? null, up = p >= 0;
  const color = up ? "var(--color-up, #22c55e)" : "var(--color-down, #f0506e)";
  const delta = prev == null ? null : p - prev;
  const pts = !d ? [] : profitOnly ? [...d.points.slice(0, -1), { ...d.points[d.points.length - 1], value: d.period.realized }] : d.points;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{title ?? `${SCOPE_TITLE[scope]}${conv ? " · this tab" : ""}`} · P&L</span>
        <div className="flex items-center gap-1">
          <ProfitToggle on={profitOnly} onChange={setProfitOnly} />
          <div className="flex rounded-md border border-line p-0.5">
            {RANGES.map(([l], i) => <button key={l} onClick={() => setRi(i)} className={cx("rounded px-1.5 py-0.5 text-[10.5px]", ri === i ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>{l}</button>)}
          </div>
        </div>
      </div>
      {!d ? <div className="h-[140px] text-[11px] text-faint">Loading…</div> : (
        <>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className={cx("num text-[22px] font-semibold", up ? "text-up" : "text-down")}>{up ? "+" : "−"}{usd(Math.abs(p))}</span>
            <span className="text-[11px] text-muted">{nowLabel}{profitOnly ? " · closed trades" : ""}</span>
          </div>
          {prev != null && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
              {delta! >= 0 ? <ArrowUpRight className="size-3.5 text-up" /> : <ArrowDownRight className="size-3.5 text-down" />}
              <span className={cx("num", delta! >= 0 ? "text-up" : "text-down")}>{delta! >= 0 ? "+" : "−"}{usd(Math.abs(delta!))}</span>
              <span className="text-muted">vs {prevLabel} ({prev >= 0 ? "+" : "−"}{usd(Math.abs(prev))})</span>
            </div>
          )}
          <PnlLine pts={pts} color={color} height={100} nowLabel={profitOnly ? "closed-trade profit so far" : range ? "this period, now (incl. open)" : "now (incl. open)"} />
          {!d.orders && <div className="mt-0.5 text-[10.5px] text-faint">No trades {conv ? "from this tab" : `from ${SCOPE_TITLE[scope].toLowerCase()}`} yet — the line starts at $0 and moves with the first trade.</div>}
          <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[10.5px]">
            <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Closed</div><div className="num text-text">{d.period.closed}{prev != null ? <span className="text-faint"> / {d.previous.closed}</span> : null}</div></div>
            <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Won</div><div className="num text-text">{d.period.closed ? Math.round((d.period.wins / d.period.closed) * 100) : 0}%{prev != null && d.previous.closed ? <span className="text-faint"> / {Math.round((d.previous.wins / d.previous.closed) * 100)}%</span> : null}</div></div>
            <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Open</div><div className={cx("num", d.unrealized >= 0 ? "text-up" : "text-down")}>{d.unrealized >= 0 ? "+" : "−"}{usd(Math.abs(d.unrealized))}</div></div>
          </div>
          <div className="mt-1 text-[10.5px] text-faint">All time {d.total >= 0 ? "+" : "−"}{usd(Math.abs(d.total))}{d.bots != null ? ` · ${d.bots} bot${d.bots === 1 ? "" : "s"}` : ""} · {usd(d.invested)} traded{d.open?.length ? ` · holding ${d.open.slice(0, 3).map((o: any) => o.symbol).join(", ")}` : ""}{label === "All" ? "" : ` · ${prevLabel ? "compared with the " + prevLabel : ""}`}</div>
        </>
      )}
    </div>
  );
}
