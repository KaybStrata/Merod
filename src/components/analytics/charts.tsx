"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cx } from "@/components/ui";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Gold area chart of account value over time with a hover crosshair (real history points only). */
export function EquityChart({ points, height = 220, className }: { points: { time: number; value: number }[]; height?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = height, padT = 10, padB = 22;
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.value);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const ticks = [0.25, 0.5, 0.75].map((f) => lo + (hi - lo) * f);
    const labels = [0, 0.25, 0.5, 0.75, 1].map((f) => { const i = Math.round(f * (points.length - 1)); return { x: x(i), t: points[i].time }; });
    return { x, y, line, area: `${line} L${W},${H - padB} L0,${H - padB} Z`, ticks, labels, span: points[points.length - 1].time - points[0].time };
  }, [points, H]);
  if (!geo) return <div className={cx("flex items-center justify-center text-xs text-muted", className)} style={{ height }}>Not enough history for this window yet.</div>;
  const up = points[points.length - 1].value >= points[0].value;
  const stroke = up ? "#d6b37a" : "#e06c6c";
  const fmtT = (t: number) => { const d = new Date(t * (t < 1e12 ? 1000 : 1)); return geo.span < 2 * 86400 * (t < 1e12 ? 1 : 1000) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const h = hover != null ? points[hover] : null;
  return (
    <div className={cx("relative", className)}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }}
        onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1))))); }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={stroke} stopOpacity="0.28" /><stop offset="1" stopColor={stroke} stopOpacity="0" /></linearGradient>
        </defs>
        {geo.ticks.map((v) => <line key={v} x1="0" x2={W} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--line)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
        <path d={geo.area} fill="url(#eq-fill)" />
        <path d={geo.line} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {h && <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1={padT} y2={H - padB} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />}
        {h && <circle cx={geo.x(hover!)} cy={geo.y(h.value)} r="3.5" fill={stroke} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between text-[10px] text-faint">{geo.labels.map((l, i) => <span key={i}>{fmtT(l.t)}</span>)}</div>
      {h && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-panel/95 px-2 py-1 text-[11px] shadow-lg" style={{ left: `min(calc(${(hover! / (points.length - 1)) * 100}% + 8px), calc(100% - 130px))` }}>
          <div className="num font-semibold">{money(h.value)}</div><div className="text-faint">{new Date(h.time * (h.time < 1e12 ? 1000 : 1)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        </div>
      )}
    </div>
  );
}

/** Allocation ring with a centre label. */
export function Donut({ parts, size = 132, center, sub }: { parts: { label: string; value: number; color: string }[]; size?: number; center?: string; sub?: string }) {
  const total = parts.reduce((s, p) => s + Math.max(p.value, 0), 0);
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Allocation">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
      {total > 0 && parts.map((p) => {
        const f = Math.max(p.value, 0) / total;
        const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth="9" strokeDasharray={`${Math.max(f * c - 2, 0)} ${c}`} strokeDashoffset={-acc * c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
        acc += f; return el;
      })}
      {center && <text x="50%" y="48%" textAnchor="middle" className="fill-[var(--text)]" style={{ fontSize: 15, fontWeight: 600 }}>{center}</text>}
      {sub && <text x="50%" y="62%" textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 10 }}>{sub}</text>}
    </svg>
  );
}

/** Semi-circle gauge 0–100. */
export function Gauge({ value, label }: { value: number | null; label: string }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const a = v == null ? 0 : Math.PI * (1 - v / 100);
  const R = 52, cx0 = 64, cy0 = 62;
  const arc = (from: number, to: number) => `M${cx0 + R * Math.cos(from)},${cy0 - R * Math.sin(from)} A${R},${R} 0 0 1 ${cx0 + R * Math.cos(to)},${cy0 - R * Math.sin(to)}`;
  const segs: [number, number, string][] = [[Math.PI, Math.PI * 0.8, "#e06c6c"], [Math.PI * 0.8, Math.PI * 0.6, "#d98b5f"], [Math.PI * 0.6, Math.PI * 0.4, "#9c937f"], [Math.PI * 0.4, Math.PI * 0.2, "#8fbf7a"], [Math.PI * 0.2, 0, "#4fbf8a"]];
  return (
    <svg width="128" height="74" viewBox="0 0 128 74" aria-label={`${label}: ${v ?? "unknown"}`}>
      {segs.map(([f, t, col]) => <path key={col} d={arc(f - 0.02, t + 0.02)} stroke={col} strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.85" />)}
      {v != null && <line x1={cx0} y1={cy0} x2={cx0 + (R - 12) * Math.cos(a)} y2={cy0 - (R - 12) * Math.sin(a)} stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />}
      <circle cx={cx0} cy={cy0} r="3.5" fill="var(--text)" />
    </svg>
  );
}

type TItem = { id: string; label: string; sub?: string; value: number; change: number | null; href?: string; group?: string };
/** Squarified treemap (area = weight, colour = 24h change). */
export function Treemap({ items, height = 420, className }: { items: TItem[]; height?: number; className?: string }) {
  const rects = useMemo(() => squarify(items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value), 0, 0, 100, 100), [items]);
  if (!rects.length) return <div className={cx("flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted", className)} style={{ height }}>No market-cap data for this market yet.</div>;
  return (
    <div className={cx("relative overflow-hidden rounded-lg", className)} style={{ height }}>
      {rects.map(({ item, x, y, w, h }) => {
        const big = w * h > 90, mid = w * h > 25;
        const body = (
          <div className="absolute flex flex-col items-center justify-center overflow-hidden border border-bg text-center transition-[filter] hover:brightness-125"
            style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, background: heat(item.change) }} title={`${item.label}${item.sub ? ` · ${item.sub}` : ""}: ${item.change == null ? "—" : `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%`}`}>
            {mid && <span className={cx("font-semibold leading-tight text-white", big ? "text-[15px]" : "text-[11px]")}>{item.label}</span>}
            {mid && <span className={cx("num leading-tight text-white/85", big ? "text-[11px]" : "text-[9.5px]")}>{item.change == null ? "—" : `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%`}</span>}
          </div>
        );
        return item.href ? <Link key={item.id} href={item.href}>{body}</Link> : <div key={item.id}>{body}</div>;
      })}
    </div>
  );
}
function heat(c: number | null) {
  if (c == null) return "#2a2723";
  const t = Math.min(Math.abs(c) / 5, 1);
  return c >= 0 ? `rgb(${Math.round(30 - 10 * t)},${Math.round(70 + 85 * t)},${Math.round(50 + 30 * t)})` : `rgb(${Math.round(80 + 120 * t)},${Math.round(40 - 5 * t)},${Math.round(40 - 5 * t)})`;
}
function squarify(items: TItem[], x: number, y: number, w: number, h: number): { item: TItem; x: number; y: number; w: number; h: number }[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!items.length || total <= 0) return [];
  const out: { item: TItem; x: number; y: number; w: number; h: number }[] = [];
  let rest = items.map((i) => ({ i, a: (i.value / total) * w * h }));
  while (rest.length) {
    const short = Math.min(w, h);
    let row: typeof rest = [], best = Infinity;
    for (const r of rest) {
      const tryRow = [...row, r];
      const s = tryRow.reduce((t, q) => t + q.a, 0);
      const worst = Math.max(...tryRow.map((q) => Math.max((short * short * q.a) / (s * s), (s * s) / (short * short * q.a))));
      if (worst > best) break;
      best = worst; row = tryRow;
    }
    const s = row.reduce((t, q) => t + q.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; for (const r of row) { const rh = r.a / cw; out.push({ item: r.i, x, y: cy, w: cw, h: rh }); cy += rh; } x += cw; w -= cw; }
    else { const ch = s / w; let cx2 = x; for (const r of row) { const rw = r.a / ch; out.push({ item: r.i, x: cx2, y, w: rw, h: ch }); cx2 += rw; } y += ch; h -= ch; }
    rest = rest.slice(row.length);
  }
  return out;
}

/** Calendar of daily P&L (green/red cells), from day-to-day changes in account value. */
export function PnlCalendar({ days }: { days: { date: string; pnl: number }[] }) {
  if (!days.length) return <p className="py-6 text-center text-xs text-muted">Daily P&L appears after a few days of account history.</p>;
  const max = Math.max(...days.map((d) => Math.abs(d.pnl)), 1);
  const first = new Date(days[0].date + "T00:00:00");
  const lead = (first.getDay() + 6) % 7;
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[9.5px] text-faint">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
        {days.map((d) => {
          const t = Math.min(Math.abs(d.pnl) / max, 1);
          return (
            <span key={d.date} title={`${d.date}: ${d.pnl >= 0 ? "+" : "-"}$${Math.abs(d.pnl).toFixed(2)}`}
              className="num flex h-7 items-center justify-center rounded text-[9px] text-white/90"
              style={{ background: Math.abs(d.pnl) < 0.005 ? "var(--panel-2)" : d.pnl > 0 ? `rgba(79,191,138,${0.18 + 0.62 * t})` : `rgba(224,108,108,${0.18 + 0.62 * t})` }}>
              {Math.abs(d.pnl) >= 1000 ? `${(d.pnl / 1000).toFixed(1)}k` : Math.abs(d.pnl) >= 1 ? d.pnl.toFixed(0) : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Range pills (1D 1W 1M 3M YTD 1Y ALL). */
export const RANGES: [string, number][] = [["1D", 86_400], ["1W", 604_800], ["1M", 2_592_000], ["3M", 7_776_000], ["YTD", -1], ["1Y", 31_536_000], ["ALL", 315_360_000]];
export const rangeSeconds = (k: string) => { const r = RANGES.find(([l]) => l === k)?.[1] ?? 2_592_000; if (r !== -1) return r; const now = new Date(); return Math.max(86_400, Math.round((+now - +new Date(now.getFullYear(), 0, 1)) / 1000)); };
export function RangePills({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cx("flex gap-0.5 rounded-lg border border-line bg-bg-2/60 p-0.5", className)}>
      {RANGES.map(([k]) => <button key={k} onClick={() => onChange(k)} className={cx("rounded-md px-2 py-0.5 text-[11px] font-medium", value === k ? "bg-panel-2 text-text shadow-sm" : "text-faint hover:text-text")}>{k}</button>)}
    </div>
  );
}

/** Thin labelled stat used in headers. */
export function Stat({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</div><div className={cx("num mt-0.5 text-[15px] font-semibold", cls)}>{value}</div></div>;
}

/** Normalise history points: time may be seconds or ms; value numeric. */
export const toPoints = (raw: any[] | undefined) => (raw ?? []).map((p: any) => ({ time: Number(p.time ?? p.t ?? p.ts), value: Number(p.value ?? p.v) })).filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time));
