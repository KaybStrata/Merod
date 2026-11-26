"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, PieChart, CheckCircle2, HelpCircle } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";

/** Client side of the widget contract (src/server/talk/widgets.ts). Unknown kinds are ignored. All text renders as plain text. */
export type WidgetT =
  | { kind: "chart"; assetId: string; symbol: string; range: "1W" | "1M" | "3M"; lines: { label: string; price: number }[] }
  | { kind: "portfolio"; total: number; dayPnl: number; cash: number; riskUsedPct: number | null }
  | { kind: "agents"; items: { id: string; name: string; state: "running" | "watching" | "paused"; note: string }[] }
  | { kind: "alert"; draft: { assetId: string; symbol: string; direction: "above" | "below"; price: number; created?: boolean; lastPrice?: number | null } }
  | { kind: "clarify"; question: string; options: { label: string; reply: string }[] }
  | { kind: "plan"; planMessageId: string };
const KNOWN = new Set(["chart", "portfolio", "agents", "alert", "clarify", "plan"]);
export const knownWidgets = (w: unknown): WidgetT[] => (Array.isArray(w) ? w.filter((x: any) => x && KNOWN.has(x.kind)).slice(0, 8) : []);

export const usd = (n: number, d = 2) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const px = (n: number) => (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : Number(n.toPrecision(4)).toString());

export function Widget({ w, onSend, allowed }: { w: WidgetT; onSend: (t: string) => void; allowed?: string[] }) {
  if (allowed && w.kind !== "plan" && w.kind !== "clarify" && !allowed.includes(w.kind)) return null;
  switch (w.kind) {
    case "chart": return <ChartWidget w={w} />;
    case "portfolio": return <PortfolioWidget w={w} />;
    case "agents": return <AgentsWidget w={w} />;
    case "alert": return <AlertWidget w={w} />;
    case "clarify": return <ClarifyWidget w={w} onSend={onSend} />;
    default: return null; // "plan" is rendered by PlanCard in the thread
  }
}

const RANGES = { "1W": { tf: "1h", limit: 168 }, "1M": { tf: "1h", limit: 720 }, "3M": { tf: "1d", limit: 90 } } as const;
function ChartWidget({ w }: { w: Extract<WidgetT, { kind: "chart" }> }) {
  const [range, setRange] = useState<keyof typeof RANGES>(w.range in RANGES ? w.range : "1M");
  const { data } = useApi<any>(`/api/assets/${w.assetId}/bars?tf=${RANGES[range].tf}&limit=${RANGES[range].limit}`);
  const bars: { time: number; close: number }[] = (data?.bars ?? []).map((b: any) => ({ time: Number(b.time), close: Number(b.close) })).filter((b: any) => Number.isFinite(b.close));
  const W = 360, H = 150;
  const geo = useMemo(() => {
    if (bars.length < 2) return null;
    const vals = [...bars.map((b) => b.close), ...w.lines.map((l) => l.price)];
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || hi || 1;
    const x = (i: number) => (i / (bars.length - 1)) * W, y = (v: number) => H - 8 - ((v - lo) / span) * (H - 20);
    const d = bars.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b.close).toFixed(1)}`).join(" ");
    return { d, y, area: `${d} L${W},${H} L0,${H} Z`, last: bars[bars.length - 1].close, first: bars[0].close, lastY: y(bars[bars.length - 1].close) };
  }, [bars, w.lines]);
  const ch = geo ? ((geo.last - geo.first) / geo.first) * 100 : null;
  return (
    <div className="surface rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <Link href={`/terminal/${w.assetId}`} className="text-[14px] font-semibold hover:text-accent-2">{w.symbol}</Link>
          {geo && <span className="num text-[12.5px] text-muted">${px(geo.last)}</span>}
          {ch != null && <span className={cx("num text-[12.5px]", ch >= 0 ? "text-up" : "text-down")}>{ch >= 0 ? "+" : ""}{ch.toFixed(1)}%</span>}
        </div>
        <div className="flex gap-0.5 text-[11px]">
          {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => <button key={r} onClick={() => setRange(r)} className={cx("rounded px-1.5 py-0.5", r === range ? "bg-panel-2 text-text" : "text-faint hover:text-text")}>{r}</button>)}
        </div>
      </div>
      {!data && <div className="mt-3 h-[150px] animate-pulse rounded-lg bg-panel-2/40" />}
      {data && !geo && <p className="mt-3 flex h-[150px] items-center justify-center text-[12px] text-faint">No price history for this range yet.</p>}
      {geo && (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[150px] w-full" preserveAspectRatio="none" role="img" aria-label={`${w.symbol} price, ${range}`}>
          <defs><linearGradient id={`tg-${w.assetId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
          <path d={geo.area} fill={`url(#tg-${w.assetId})`} />
          <path d={geo.d} fill="none" stroke="var(--accent-2)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          {w.lines.map((l, i) => (
            <g key={i}>
              <line x1="0" x2={W} y1={geo.y(l.price)} y2={geo.y(l.price)} stroke="var(--accent)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x="6" y={geo.y(l.price) - 4} fontSize="9" fill="var(--accent-2)">{l.label}</text>
            </g>
          ))}
          <circle cx={W} cy={geo.lastY} r="3" fill="var(--text)" />
        </svg>
      )}
      {data?.source && data.source !== "provider" && <p className="mt-1 text-[10px] text-faint">Source: {String(data.source)}</p>}
    </div>
  );
}

function PortfolioWidget({ w }: { w: Extract<WidgetT, { kind: "portfolio" }> }) {
  const dash = useApi<any>("/api/dashboard");
  const holdings: any[] = (dash.data?.holdings ?? []).slice(0, 4);
  const total = Number(dash.data?.total ?? w.total) || 1;
  const parts = [...holdings.map((h) => ({ label: h.symbol, pct: (Number(h.value) / total) * 100 })), { label: "Cash", pct: (Number(dash.data?.cash ?? w.cash) / total) * 100 }];
  return (
    <div className="surface flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl px-4 py-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-2"><PieChart className="size-3.5" /> Portfolio</span>
      <div><div className="text-[11px] text-faint">Equity</div><div className="num text-[16px] font-semibold">{usd(w.total, 0)}</div></div>
      <div><div className="text-[11px] text-faint">Today</div><div className={cx("num text-[16px] font-semibold", w.dayPnl >= 0 ? "text-up" : "text-down")}>{w.dayPnl >= 0 ? "+" : ""}{usd(w.dayPnl, 0)}</div></div>
      <div><div className="text-[11px] text-faint">Risk used</div><div className="num text-[16px] font-semibold">{w.riskUsedPct == null ? "No limit" : `${w.riskUsedPct}%`}</div></div>
      <div className="min-w-[200px] flex-1">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-2">
          {parts.map((p, i) => <span key={p.label} style={{ width: `${Math.max(0, p.pct)}%`, opacity: 1 - i * 0.15 }} className={p.label === "Cash" ? "bg-line-2" : "bg-accent"} />)}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted">{parts.map((p) => <span key={p.label}>{p.label} <span className="num text-text">{p.pct.toFixed(1)}</span></span>)}</div>
      </div>
    </div>
  );
}

function AgentsWidget({ w }: { w: Extract<WidgetT, { kind: "agents" }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {w.items.map((a) => (
        <Link key={a.id} href={`/agents/${a.id}`} className="flex max-w-full items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1.5 text-[12.5px] hover:border-line-2">
          <span className={cx("size-1.5 shrink-0 rounded-full", a.state === "running" ? "bg-up" : a.state === "watching" ? "bg-accent-2" : "bg-faint")} />
          <span className="font-semibold">{a.name}</span><span className="truncate text-muted">{a.note}</span>
        </Link>
      ))}
    </div>
  );
}

function AlertWidget({ w }: { w: Extract<WidgetT, { kind: "alert" }> }) {
  const toast = useToast();
  const [created, setCreated] = useState(!!w.draft.created);
  const [busy, setBusy] = useState(false);
  const d = w.draft;
  const gap = d.lastPrice ? ((d.lastPrice - d.price) / d.price) * 100 : null;
  async function create() { // human click → existing POST /api/alerts
    setBusy(true);
    try { await api("/api/alerts", { method: "POST", json: { assetId: d.assetId, direction: d.direction, price: d.price } }); setCreated(true); toast("Alert created", "up"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div className="surface rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-2"><Bell className="size-3.5" /> Alert rule · {created ? "active" : "parsed"}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
        <span className="rounded-lg border border-line bg-panel-2 px-2.5 py-1 font-semibold">{d.symbol}</span>
        <span className="rounded-lg border border-dashed border-line-2 px-2.5 py-1 text-muted">{d.direction === "below" ? "crosses below" : "crosses above"}</span>
        <span className="num rounded-lg border border-accent/50 bg-accent-soft px-2.5 py-1 text-accent-2">${px(d.price)}</span>
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] text-muted">
        <span>{d.lastPrice ? `Now $${px(d.lastPrice)}${gap != null ? ` · ${Math.abs(gap).toFixed(1)}% ${gap >= 0 ? "above" : "below"} trigger` : ""}` : "Live price pending"}</span>
        <span>Notify only · no trade</span>
      </div>
      {created
        ? <div className="mt-3 flex items-center gap-1.5 text-[12.5px] text-up"><CheckCircle2 className="size-4" /> Alert is set. Manage it in <Link href="/alerts" className="underline">Alerts</Link>.</div>
        : <button onClick={create} disabled={busy} className="mt-3 h-9 w-full rounded-xl bg-grad text-[13px] font-semibold text-bg disabled:opacity-60">{busy ? "Creating…" : "Create alert"}</button>}
    </div>
  );
}

function ClarifyWidget({ w, onSend }: { w: Extract<WidgetT, { kind: "clarify" }>; onSend: (t: string) => void }) {
  return (
    <div className="surface rounded-2xl border border-accent/40 p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-2"><HelpCircle className="size-3.5" /> Risk check · needs you</div>
      <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-snug">{w.question}</p>
      {/* Buttons only send a new message; they never call the engine directly. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {w.options.map((o, i) => (
          <button key={i} onClick={() => onSend(o.reply)} className={cx("h-9 rounded-xl px-3.5 text-[13px] font-medium", i === 0 ? "bg-grad text-bg" : "border border-line-2 hover:border-accent/60")}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}
