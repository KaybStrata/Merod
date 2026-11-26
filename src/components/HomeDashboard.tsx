"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { TrendingUp, Flame, Rocket, Star, History, Bot, Sparkles, Users, PieChart, ArrowRight, AlertTriangle, Wallet } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Card, Badge, Pills, Sparkline, Skeleton, Empty, ChangeText, AssetIcon, StatusPill, SourceBadge, PaperBadge, cx } from "@/components/ui";
import { usd, price, pct, qty, ago, compact, tone } from "@/lib/format";
import { ShortcutBar } from "@/components/ShortcutBar";
import { ProgressPanel } from "@/components/ProgressPanel";
import { QuickLists } from "@/components/QuickLists";
import { DraggableBoard, type Block } from "@/components/DraggableBoard";
import { LiveSuggestions } from "@/components/LiveSuggestions";

const ValueChart = dynamic(() => import("@/components/terminal/charts").then((m) => m.ValueChart), { ssr: false, loading: () => <Skeleton className="h-[180px]" /> });

export default function Dashboard() {
  const { user, openPrompt } = useShell();
  const d = useApi<any>("/api/dashboard", { refreshMs: 15000 });
  // Chart window: a preset, or a custom length typed by the user ("45m", "3d", "2w"…).
  const [range, setRange] = useState<string>("1M");
  const [custom, setCustom] = useState<{ label: string; seconds: number } | null>(null);
  const hist = useApi<any>(custom ? `/api/portfolio/history?seconds=${custom.seconds}` : `/api/portfolio/history?range=${range}`,
    { refreshMs: (custom?.seconds ?? RANGE_SECS[range] ?? 86_400) <= 6 * 3600 ? 30_000 : 120_000 });
  const pts: { time: number; value: number }[] = hist.data?.points ?? [];
  const windowChange = pts.length > 1 ? pts[pts.length - 1].value - pts[0].value : null;
  const windowPct = pts.length > 1 && pts[0].value ? (windowChange! / pts[0].value) * 100 : null;
  const windowLabel = custom ? custom.label : RANGE_LABEL[range] ?? range;
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") d.refresh(); }, undefined);

  const s = d.data;
  const blocks: Block[] = [
    { id: "lists", title: "Trending & My list", size: "half", node: (
      <QuickLists part="lists" myList={s?.watchlist} recent={s?.recentOrders} onListChange={d.refresh} />
    ) },
    { id: "history", title: "Recent trading history", size: "half", node: (
      <QuickLists part="history" myList={s?.watchlist} recent={s?.recentOrders} onListChange={d.refresh} />
    ) },
    { id: "progress", title: "Progress", size: "full", node: (
      <ProgressPanel compact />
    ) },
    { id: "portfolio", title: "Portfolio value", size: "wide", node: (
        <Card pad={false}>
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted">Total portfolio value <PaperBadge /></div>
              {s ? <div className="num mt-1 text-3xl font-semibold tracking-tight">{usd(s.total)}</div> : <Skeleton className="mt-2 h-10 w-56" />}
              {windowChange != null
                ? <div className={cx("num mt-1 text-sm", tone(windowChange))}>{usd(windowChange, { sign: true })} ({pct(windowPct)}) <span className="text-faint">over the last {windowLabel}</span></div>
                : s && <div className={cx("num mt-1 text-sm", tone(s.dayChange))}>{usd(s.dayChange, { sign: true })} ({pct(s.dayChangePct)}) today</div>}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="max-w-full overflow-x-auto">
                <Pills size="sm" value={custom ? "" : range} onChange={(v) => { setCustom(null); setRange(v); }} options={Object.keys(RANGE_SECS).map((v) => ({ value: v, label: v }))} />
              </div>
              <CustomRange active={custom?.label ?? null} onPick={setCustom} />
            </div>
          </div>
          <div className="px-2">{hist.data ? <ValueChart points={hist.data.points} /> : <Skeleton className="mx-3 h-[180px]" />}</div>
          {hist.data?.estimated && <p className="px-5 text-[11px] text-faint">Estimated from your current holdings × past prices{hist.data.resolutionSec ? ` (${hist.data.resolutionSec >= 86400 ? "daily" : hist.data.resolutionSec >= 3600 ? "hourly" : "5-minute"} detail)` : ""}, until enough history is recorded.</p>}
          <div className="grid grid-cols-2 gap-4 border-t border-line px-5 py-4 sm:grid-cols-4">
            <Mini label="Cash (virtual)" value={usd(s?.cash)} />
            <Mini label="Invested" value={usd(s?.invested)} />
            <Mini label="Unrealized P&L" value={usd(s?.unrealized, { sign: true })} cls={tone(s?.unrealized)} />
            <Mini label="Lifetime P&L" value={`${usd(s?.lifetimePnl, { sign: true })} (${pct(s?.lifetimePct)})`} cls={tone(s?.lifetimePnl)} />
          </div>
        </Card>
    ) },
    { id: "allocation", title: "Allocation", size: "third", node: (
        <Card title="Allocation" icon={<PieChart className="size-4 text-accent-2" />}>
          {s ? <Allocation a={s.allocation} total={s.total} /> : <Skeleton className="h-40" />}
        </Card>
    ) },
    { id: "shortcuts", title: "Shortcuts", size: "full", node: (
      <Card title="Shortcuts" icon={<Sparkles className="size-4 text-accent-2" />} action={<Link href="/shortcuts" className="text-xs text-accent-2 hover:underline">Manage</Link>}>
        <ShortcutBar placement="dashboard" />
        <div className="mt-4"><LiveSuggestions title="Suggested for you right now" /></div>
      </Card>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Good to see you, {user.displayName.split(" ")[0]}</h1>
          <p className="text-sm text-muted">Your unified overview across stocks and crypto.</p>
        </div>
        {s?.pendingApprovals > 0 && (
          <Link href="/portfolio?tab=orders" className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
            <AlertTriangle className="size-4" /> {s.pendingApprovals} order{s.pendingApprovals > 1 ? "s" : ""} awaiting your approval
          </Link>
        )}
      </div>

      <DraggableBoard storageKey={`merod-home-layout:${user.id}`} blocks={blocks} />
    </div>
  );
}

const RANGE_SECS: Record<string, number> = { "1m": 60, "15m": 900, "30m": 1800, "1h": 3600, "6h": 21_600, "12h": 43_200, "1D": 86_400, "1W": 604_800, "1M": 2_592_000, "3M": 7_776_000, "1Y": 31_536_000 };
const RANGE_LABEL: Record<string, string> = { "1m": "minute", "15m": "15 minutes", "30m": "30 minutes", "1h": "hour", "6h": "6 hours", "12h": "12 hours", "1D": "day", "1W": "week", "1M": "month", "3M": "3 months", "1Y": "year" };
const UNIT: [RegExp, number, string][] = [[/^(m|min|mins|minutes?)$/, 60, "minute"], [/^(h|hr|hrs|hours?)$/, 3600, "hour"], [/^(d|days?)$/, 86_400, "day"], [/^(w|wk|wks|weeks?)$/, 604_800, "week"], [/^(mo|mos|months?)$/, 2_592_000, "month"], [/^(y|yr|yrs|years?)$/, 31_536_000, "year"]];
/** "45m", "3 days", "2w", "1.5h" → seconds and a readable label. */
function parseWindow(text: string): { label: string; seconds: number } | null {
  const m = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!m) return null;
  const n = Number(m[1]); const u = UNIT.find(([re]) => re.test(m[2]));
  if (!u || !(n > 0)) return null;
  const seconds = Math.round(n * u[1]);
  if (seconds < 60 || seconds > 315_360_000) return null;
  return { label: `${n} ${u[2]}${n === 1 ? "" : "s"}`, seconds };
}
function CustomRange({ active, onPick }: { active: string | null; onPick: (r: { label: string; seconds: number }) => void }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const r = parseWindow(text); setBad(!r); if (r) onPick(r); }} className="flex items-center gap-1.5">
      <input value={text} onChange={(e) => { setText(e.target.value); setBad(false); }} placeholder="Custom: 45m, 3d, 2w"
        className={cx("h-7 w-32 rounded-lg border bg-bg-2 px-2 text-[11px] outline-none focus:border-accent", bad ? "border-down" : active ? "border-accent" : "border-line")}
        title="Type a length of time, e.g. 45m, 2h, 3d, 2w, 6mo, 1y" />
      <button className="h-7 rounded-lg border border-line px-2 text-[11px] text-muted hover:text-text">Go</button>
      {active && <span className="text-[10px] text-accent-2">{active}</span>}
    </form>
  );
}

function Mini({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return <div className="min-w-0"><div className="text-xs text-muted">{label}</div><div className={cx("num mt-0.5 truncate text-sm font-semibold", cls)}>{value}</div></div>;
}

function Allocation({ a, total }: { a: { stocks: number; crypto: number; cash: number }; total: number }) {
  const parts = [{ k: "Stocks", v: a.stocks, c: "var(--up)" }, { k: "Crypto", v: a.crypto, c: "var(--accent)" }, { k: "Cash", v: a.cash, c: "var(--line-2)" }];
  let acc = 0;
  const R = 54, C = 2 * Math.PI * R;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-4">
      <svg viewBox="0 0 140 140" className="size-[104px] shrink-0 -rotate-90 2xl:size-[132px]" aria-hidden>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--panel-2)" strokeWidth="16" />
        {parts.map((p) => { const frac = total ? p.v / total : 0; const el = <circle key={p.k} cx="70" cy="70" r={R} fill="none" stroke={p.c} strokeWidth="16" strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} />; acc += frac; return el; })}
      </svg>
      <div className="min-w-[150px] flex-1 space-y-2.5">
        {parts.map((p) => (
          <div key={p.k} className="flex min-w-0 items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: p.c }} /><span className="truncate">{p.k}</span></span>
            <span className="num shrink-0 text-muted">{total ? ((p.v / total) * 100).toFixed(1) : "0.0"}%</span>
          </div>
        ))}
        <div className="num border-t border-line pt-2 text-xs text-faint">{usd(total)} total</div>
      </div>
    </div>
  );
}

function AssetRows({ rows, showVolume }: { rows?: any[]; showVolume?: boolean }) {
  if (!rows) return <Skeleton className="h-40" />;
  if (!rows.length) return <Empty title="No assets" />;
  return (
    <div className="space-y-1">
      {rows.map((a, i) => (
        <Link key={a.id} href={`/terminal/${a.id}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-panel-2">
          <span className="w-4 text-xs text-faint">{i + 1}</span>
          <AssetIcon symbol={a.symbol} logo={a.logo_url} size={26} />
          <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-sm font-semibold">{a.symbol}{a.price_source === "simulated" && <span className="size-1.5 rounded-full bg-warn" title="Simulated price" />}</div><div className="truncate text-xs text-muted">{showVolume ? `Vol ${compact(a.volume_24h)}` : a.name}</div></div>
          <Sparkline data={(a.spark ?? []).map(Number)} width={60} height={22} />
          <div className="w-24 text-right"><div className="num text-sm">{price(a.last_price)}</div><ChangeText value={a.change_24h} className="text-xs" /></div>
        </Link>
      ))}
    </div>
  );
}

function AISummary({ s, trending, onAsk }: { s: any; trending?: any[]; onAsk: (t?: string) => void }) {
  const lines: string[] = [];
  if (s) {
    lines.push(`Your paper portfolio is ${s.dayChange >= 0 ? "up" : "down"} ${usd(Math.abs(s.dayChange))} (${pct(s.dayChangePct)}) today across ${s.holdings.length} position${s.holdings.length === 1 ? "" : "s"}.`);
    const best = [...s.holdings].sort((a: any, b: any) => (b.change_24h ?? 0) - (a.change_24h ?? 0))[0];
    if (best) lines.push(`Best performer today: ${best.symbol} (${pct(best.change_24h)}).`);
    if (s.bots.length) lines.push(`${s.bots.filter((b: any) => b.status === "running").length} bot(s) running; bot P&L ${usd(s.bots.reduce((a: number, b: any) => a + Number(b.pnl_usd), 0), { sign: true })}.`);
  }
  if (trending?.length) lines.push(`Highest volume: ${trending.slice(0, 3).map((a) => `${a.symbol} ${pct(a.change_24h)}`).join(", ")}.`);
  const simulated = trending?.some((a) => a.price_source === "simulated");
  return (
    <Card title="Market summary" icon={<Sparkles className="size-4 text-accent-2" />} action={<button onClick={() => onAsk("Summarize today's market and my portfolio")} className="text-xs text-accent-2 hover:underline">Ask AI</button>}>
      {!s ? <Skeleton className="h-28" /> : (
        <div className="space-y-2 text-sm text-muted">
          {lines.map((l) => <p key={l}>{l}</p>)}
          {simulated && <div className="flex items-center gap-2 pt-1 text-[11px] text-faint"><SourceBadge source="simulated" /> Some prices come from the simulated feed until market-data providers are connected.</div>}
        </div>
      )}
    </Card>
  );
}
