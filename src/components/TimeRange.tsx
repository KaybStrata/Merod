"use client";
import { useState } from "react";
import { cx } from "@/components/ui";

/** The same time windows everywhere: 1m … 1Y, plus a custom length ("45m", "3d", "2w"). */
export const RANGE_SECS: Record<string, number> = { "1m": 60, "15m": 900, "30m": 1800, "1h": 3600, "6h": 21_600, "12h": 43_200, "1D": 86_400, "1W": 604_800, "1M": 2_592_000, "3M": 7_776_000, "1Y": 31_536_000 };
export type Range = { label: string; seconds: number; custom?: boolean };
export const range = (label: string): Range => ({ label, seconds: RANGE_SECS[label] ?? 86_400 });

const UNIT: [RegExp, number, string][] = [[/^(m|min|mins|minutes?)$/, 60, "minute"], [/^(h|hr|hrs|hours?)$/, 3600, "hour"], [/^(d|days?)$/, 86_400, "day"], [/^(w|wk|wks|weeks?)$/, 604_800, "week"], [/^(mo|mos|months?)$/, 2_592_000, "month"], [/^(y|yr|yrs|years?)$/, 31_536_000, "year"]];
export function parseWindow(text: string): Range | null {
  const m = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!m) return null;
  const n = Number(m[1]); const u = UNIT.find(([re]) => re.test(m[2]));
  if (!u || !(n > 0)) return null;
  const seconds = Math.round(n * u[1]);
  if (seconds < 60 || seconds > 315_360_000) return null;
  return { label: `${n}${m[2][0] === "m" && m[2].startsWith("mo") ? "mo" : m[2][0]}`, seconds, custom: true };
}

/** Which candle size to use for a window, and how many candles cover it. */
export function barsFor(seconds: number): { tf: "1m" | "5m" | "1h" | "1d"; limit: number; since: number } {
  const tf = seconds <= 3 * 3600 ? "1m" : seconds <= 3 * 86_400 ? "5m" : seconds <= 60 * 86_400 ? "1h" : "1d";
  const step = { "1m": 60, "5m": 300, "1h": 3600, "1d": 86_400 }[tf];
  return { tf, limit: Math.min(2000, Math.max(2, Math.ceil(seconds / step) + 1)), since: Math.floor(Date.now() / 1000) - seconds };
}
export const barsQuery = (seconds: number) => { const b = barsFor(seconds); return `tf=${b.tf}&limit=${b.limit}&since=${Math.floor(b.since / 60) * 60}`; };

export function TimeRangePicker({ value, onChange, size = "md", compact = false }: { value: Range; onChange: (r: Range) => void; size?: "sm" | "md"; compact?: boolean }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const btn = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", compact && "gap-1")}>
      <div className="flex flex-wrap gap-0.5 rounded-xl border border-line bg-panel/60 p-0.5">
        {Object.keys(RANGE_SECS).map((k) => (
          <button key={k} type="button" onClick={() => onChange(range(k))}
            className={cx("rounded-lg font-medium transition-colors", btn, !value.custom && value.label === k ? "bg-accent text-black shadow-[0_0_12px_rgba(56,189,248,.5)]" : "text-muted hover:text-text")}>{k}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); const r = parseWindow(text); setBad(!r); if (r) onChange(r); }} className="flex items-center gap-1">
        <input value={text} onChange={(e) => { setText(e.target.value); setBad(false); }} placeholder="Custom: 45m, 3d" title="Type a length of time, e.g. 45m, 2h, 3d, 2w, 6mo, 1y"
          className={cx("rounded-lg border bg-bg-2 px-2 outline-none focus:border-accent", size === "sm" ? "h-6 w-24 text-[10px]" : "h-7 w-28 text-[11px]", bad ? "border-down" : value.custom ? "border-accent" : "border-line")} />
        <button className={cx("rounded-lg border border-line text-muted hover:text-text", size === "sm" ? "h-6 px-1.5 text-[10px]" : "h-7 px-2 text-[11px]")}>Go</button>
        {value.custom && <span className="text-[10px] text-accent-2">{value.label}</span>}
      </form>
    </div>
  );
}
