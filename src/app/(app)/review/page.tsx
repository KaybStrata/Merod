"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardCheck, ShieldCheck, TrendingUp, TrendingDown, Lightbulb, CalendarClock, Share2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle } from "@/components/shell/context";
import { cx, useToast } from "@/components/ui";
import { PortfolioSpark } from "@/components/talk/PortfolioSpark";
import { TimeDial } from "@/components/TimeDial";
import { PRESETS, secLabel, secWords, ytdSeconds } from "@/lib/timeDial";

const LS = "merod-review-period";
const money = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const SRC: Record<string, string> = { manual: "You (manual)", prompt: "Ask Merod", shortcut: "Shortcuts", bot: "Bots", agent: "Agents", copy: "Mimic", auto: "Auto", conditional: "Conditional", system: "Merod" };
const hold = (s: number | null) => s == null ? "—" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86_400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86_400).toFixed(1)}d`;

export default function ReviewPage() { return <Suspense fallback={null}><Review /></Suspense>; }

/** Performance review for any period that ends now (presets or the shared 1m → 5y dial), with Break even, compare and schedules. */
function Review() {
  usePageTitle({ section: "Insight", title: "Review" });
  const sp = useSearchParams(), router = useRouter(), toast = useToast();
  const [seconds, setSeconds] = useState<number>(() => {
    const q = Number(sp.get("seconds"));
    if (q >= 60) return q;
    try { const s = Number(localStorage.getItem(LS)); if (s >= 60) return s; } catch { /* ignore */ }
    return PRESETS["1W"];
  });
  const [custom, setCustom] = useState(false);
  const [compare, setCompare] = useState(false);
  useEffect(() => { try { localStorage.setItem(LS, String(seconds)); } catch { /* ignore */ } router.replace(`/review?seconds=${seconds}`, { scroll: false }); }, [seconds]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error } = useApi<any>(`/api/review?seconds=${seconds}${compare ? "&compare=1" : ""}`);
  const r = data?.review;
  const presets: [string, number][] = useMemo(() => [...Object.entries(PRESETS).slice(0, 4), ["YTD", ytdSeconds()], ["1Y", PRESETS["1Y"]]] as [string, number][], []);
  const short = seconds < 3600;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-[1.2rem] font-semibold"><ClipboardCheck className="size-5 text-accent-2" />Your review · last {secWords(seconds)}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[12px]">
          <button onClick={() => setCompare((c) => !c)} aria-pressed={compare} className={cx("rounded-lg border px-2.5 py-1", compare ? "border-accent/50 bg-accent-soft text-accent-2" : "border-line text-muted hover:text-text")}>⟲ Compare to previous {secLabel(seconds)}</button>
          <ScheduleButton schedule={data?.schedule} />
          <button onClick={() => { navigator.clipboard?.writeText(location.href).then(() => toast("Link copied", "up")).catch(() => {}); }} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-muted hover:text-text"><Share2 className="size-3.5" />Share</button>
        </div>
      </div>

      {/* Period: presets + Custom (the same dial as the P&L chart) */}
      <div className="surface flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
        {presets.map(([k, s]) => <button key={k} onClick={() => { setCustom(false); setSeconds(s); }} className={cx("rounded-md px-2 py-0.5 text-[12px]", !custom && Math.abs(seconds - s) < 60 ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>{k}</button>)}
        <button onClick={() => setCustom(true)} className={cx("rounded-md px-2 py-0.5 text-[12px]", custom ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>Custom{custom ? ` · ${secLabel(seconds)}` : ""}</button>
        {custom && <TimeDial value={seconds} onChange={setSeconds} className="min-w-[260px] flex-1" />}
      </div>

      {error && <p className="text-sm text-down">{error}</p>}
      {!r ? <div className="surface h-64 animate-pulse rounded-2xl" /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="surface rounded-2xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">P&L this period{r.estimated ? " (est.)" : ""}</div>
            <div className={cx("num mt-1 text-[1.7rem] font-semibold", r.pnl.change >= 0 ? "text-up" : "text-down")}>{money(r.pnl.change)} <span className="text-[1rem]">{r.pnl.pct >= 0 ? "+" : ""}{r.pnl.pct.toFixed(2)}%</span></div>
            <div className="text-[11.5px] text-muted">Realized {money(r.pnl.realized)} · unrealized {money(r.pnl.unrealized)}</div>
            <div className="text-[11.5px] text-muted">{money(r.pnl.vsInvested)} vs ${r.pnl.invested.toLocaleString("en-US", { maximumFractionDigits: 0 })} invested{r.pnl.previous != null ? ` · prev ${secLabel(seconds)}: ${money(r.pnl.previous)}` : ""}</div>
            <PortfolioSpark seconds={seconds} height={90} className="mt-3" />
            {r.notes.map((n: string) => <p key={n} className="mt-2 text-[10.5px] text-faint">{n}</p>)}
          </section>
          <section className="surface rounded-2xl p-4">
            <List title="What worked" icon={<TrendingUp className="size-4 text-up" />} items={r.worked} empty="No profitable closed trades in this period." />
            <div className="my-3 border-t border-line" />
            <List title="What didn't" icon={<TrendingDown className="size-4 text-down" />} items={r.didnt} empty="No losing closed trades in this period." />
          </section>
          <section className="surface rounded-2xl p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><ShieldCheck className="size-4 text-accent-2" />Rules that saved you</h3>
            {!r.saved.length && <p className="text-[12px] text-faint">No blocked orders or stops in this period.</p>}
            {r.saved.length > 0 && (() => { const est = r.saved.reduce((a: number, s: any) => a + (s.estAvoided ?? 0), 0); return est > 0 ? <div className="num mb-2 text-[1.2rem] font-semibold text-up">~${est.toFixed(2)} <span className="text-[11px] font-normal text-muted">loss avoided (est.)</span></div> : null; })()}
            <ul className="space-y-1.5">{r.saved.slice(0, 6).map((s: any, i: number) => <li key={i} className="text-[12px]"><span className="text-accent-2">🛡</span> {s.detail}{s.estAvoided ? <span className="text-faint"> · ~${s.estAvoided.toFixed(2)} avoided (est.)</span> : null} <span className="text-[10.5px] text-faint">{new Date(s.at * 1000).toLocaleDateString([], { month: "short", day: "numeric" })}</span></li>)}</ul>
          </section>
          <section className="surface rounded-2xl p-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">P&L by source</h3>
            {!r.bySource.length && <p className="text-[12px] text-faint">No trades in this period.</p>}
            {(() => { const max = Math.max(1, ...r.bySource.map((s: any) => Math.abs(s.pnl))); return r.bySource.map((s: any) => (
              <div key={s.source} className="mb-1.5 text-[12px]"><div className="flex justify-between"><span>{SRC[s.source] ?? s.source} <span className="text-faint">· {s.trades}</span></span><span className={cx("num", s.pnl >= 0 ? "text-up" : "text-down")}>{money(s.pnl)}</span></div>
                <div className="mt-0.5 h-1.5 rounded-full bg-panel-2"><div className={cx("h-full rounded-full", s.pnl >= 0 ? "bg-up/70" : "bg-down/70")} style={{ width: `${(Math.abs(s.pnl) / max) * 100}%` }} /></div></div>
            )); })()}
          </section>
          {!short && (
            <section className="surface rounded-2xl p-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Habits</h3>
              <div className="grid grid-cols-2 gap-3">
                <Stat v={r.habits.winRate == null ? "—" : `${r.habits.winRate.toFixed(0)}%`} k={`win rate · ${r.habits.closed} closed`} />
                <Stat v={hold(r.habits.avgHoldSec)} k="average hold" />
                <Stat v={`$${r.habits.feesUsd.toFixed(2)}`} k={`fees · ${r.habits.trades} trades`} />
                <Stat v={(() => { const rated = r.agents.filter((a: any) => a.rated); if (!rated.length) return "—"; const n = rated.reduce((x: number, a: any) => x + a.rated, 0); return `${Math.round(rated.reduce((x: number, a: any) => x + (a.agreement ?? 0) * a.rated, 0) / n)}%`; })()} k="agent agreement" />
              </div>
              {r.agents.length > 0 && <div className="mt-3 space-y-1">{r.agents.slice(0, 5).map((a: any) => <Link key={a.agentId} href={`/agents/${a.agentId}`} className="flex justify-between text-[12px] hover:text-accent-2"><span>{a.name}{a.agreement != null ? <span className="text-faint"> · {a.agreement}% agreed ({a.rated})</span> : null}</span><span className={cx("num", a.pnl >= 0 ? "text-up" : "text-down")}>{money(a.pnl)}</span></Link>)}</div>}
            </section>
          )}
          {!short && (
            <section className="surface rounded-2xl p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Lightbulb className="size-4 text-accent-2" />Merod suggests</h3>
              {!r.suggestions.length && <p className="text-[12px] text-faint">Nothing to change right now.</p>}
              <ol className="space-y-2">{r.suggestions.map((s: any, i: number) => <li key={i} className="text-[12.5px]"><b>{i + 1}.</b> {s.text} <Link href={s.href} className="text-accent-2 hover:underline">{s.action} ›</Link><div className="text-[11px] text-faint">{s.why}</div></li>)}</ol>
              <p className="mt-3 text-[10.5px] text-faint">Suggestions open the normal approval flow. Nothing changes automatically.</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function List({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: any[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{icon}{title}</h3>
      {!items.length && <p className="text-[12px] text-faint">{empty}</p>}
      {items.map((it) => <Link key={it.label} href={it.link ?? "#"} className="flex justify-between py-0.5 text-[12.5px] hover:text-accent-2"><span className="truncate">{it.label}</span><span className={cx("num shrink-0", it.pnl >= 0 ? "text-up" : "text-down")}>{money(it.pnl)}</span></Link>)}
    </div>
  );
}
const Stat = ({ v, k }: { v: string; k: string }) => <div><div className="num text-[1.15rem] font-semibold">{v}</div><div className="text-[11px] text-muted">{k}</div></div>;

/** Scheduled reviews: Off · Daily · Weekly · Monthly · Custom (the dial, "every N", min 1 hour). */
function ScheduleButton({ schedule }: { schedule: any }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [every, setEvery] = useState<number | null>(schedule?.every_sec ?? null);
  const [custom, setCustom] = useState(false);
  useEffect(() => { setEvery(schedule?.every_sec ?? null); }, [schedule?.every_sec]);
  const save = async (v: number | null) => {
    try { await api("/api/review", { method: "PUT", json: { everySec: v } }); setEvery(v); toast(v ? `Review every ${secWords(v)}, sent as a notification` : "Scheduled review off", "up"); }
    catch (e: any) { toast(e.message, "down"); }
  };
  const opts: [string, number | null][] = [["Off", null], ["Daily", 86_400], ["Weekly", 604_800], ["Monthly", 2_592_000]];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={cx("flex items-center gap-1 rounded-lg border px-2.5 py-1", every ? "border-accent/50 text-accent-2" : "border-line text-muted hover:text-text")}><CalendarClock className="size-3.5" />{every ? `Every ${secLabel(every)}` : "Schedule…"}</button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-line bg-panel p-2 shadow-2xl">
          <div className="flex flex-wrap gap-1">
            {opts.map(([k, v]) => <button key={k} onClick={() => { setCustom(false); save(v); }} className={cx("rounded-md px-2 py-0.5 text-[12px]", !custom && every === v ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>{k}</button>)}
            <button onClick={() => setCustom(true)} className={cx("rounded-md px-2 py-0.5 text-[12px]", custom ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>Custom</button>
          </div>
          {custom && <TimeDial value={every ?? 864_000} min={3600} onChange={(s) => save(s)} className="mt-2" />}
          <p className="mt-2 text-[10.5px] text-faint">You get a notification with the review for that period, linking back here.</p>
        </div>
      )}
    </div>
  );
}
