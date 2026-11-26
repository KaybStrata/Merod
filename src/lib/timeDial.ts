/**
 * The Custom time dial shared by the Portfolio P&L chart and the Review: a 0–100 slider on a log scale from 1 minute to 5 years.
 * Same maths everywhere, so the same dial position always means the same window.
 */
export const DIAL_MIN_S = 60, DIAL_MAX_S = 5 * 365 * 86_400;
export const dialToSec = (v: number) => Math.round(DIAL_MIN_S * Math.pow(DIAL_MAX_S / DIAL_MIN_S, Math.min(100, Math.max(0, v)) / 100));
export const secToDial = (s: number) => (100 * Math.log(Math.min(DIAL_MAX_S, Math.max(DIAL_MIN_S, s)) / DIAL_MIN_S)) / Math.log(DIAL_MAX_S / DIAL_MIN_S);
/** "45m" "6h" "18d" "4.5mo" "2.1y". */
export const secLabel = (s: number) => s < 3600 ? `${Math.round(s / 60)}m` : s < 86_400 ? `${+(s / 3600).toFixed(s < 36_000 ? 1 : 0)}h` : s < 30 * 86_400 ? `${+(s / 86_400).toFixed(s < 864_000 ? 1 : 0)}d` : s < 365 * 86_400 ? `${+(s / (30 * 86_400)).toFixed(1)}mo` : `${+(s / (365 * 86_400)).toFixed(1)}y`;
/** Long form for screen readers and titles: "18 days", "6 hours". */
export function secWords(s: number) {
  const u: [number, string][] = [[365 * 86_400, "year"], [30 * 86_400, "month"], [86_400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [n, w] of u) if (s >= n) { const v = +(s / n).toFixed(s / n < 10 ? 1 : 0); return `${v} ${w}${v === 1 ? "" : "s"}`; }
  return `${s} seconds`;
}
export const PRESETS = { "1D": 86_400, "1W": 604_800, "1M": 2_592_000, "3M": 7_776_000, "1Y": 31_536_000 } as const;
/** Seconds since 1 January (local) for YTD. */
export const ytdSeconds = (now = new Date()) => Math.max(DIAL_MIN_S, Math.round((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 1000));
/** Snap to common windows (1h, 1d, 1w, 1m, 3m, 1y) when within ±2 dial units. */
const SNAPS = [3600, 86_400, 604_800, 2_592_000, 7_776_000, 31_536_000].map(secToDial);
export const snapDial = (v: number) => { for (const s of SNAPS) if (Math.abs(v - s) <= 2) return s; return v; };
