"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Brain, Target, CheckCircle2, AlertTriangle, Gauge, Bot, Sparkles, Cpu, Repeat, ArrowLeftRight, Landmark, Pause, Play, Search, BarChart3, TrendingUp, ArrowUpRight, ShoppingCart, RefreshCw } from "lucide-react";
import { TradeHistory } from "@/components/activity/TradeHistory";
import { api } from "@/lib/api";
import { capFeed } from "@/lib/feed";
import { ItemHeader, type FeedCoin } from "@/components/activity/ItemHeader";
import { WhyLine } from "@/components/agents/Why";
import { usePageTitle, useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";

type Item = { id: string; at: string; source: string; kind: string; actor: string; title: string; body?: string; link?: string; side?: string; pnl?: number; coin?: FeedCoin; eventId?: number };
const SOURCES: [string, string, any][] = [["all", "Everything", Activity], ["agent", "Agents", Sparkles], ["bot", "Bots", Bot], ["auto", "Auto trading", Cpu], ["modo", "Modo", Brain], ["order", "Orders", ArrowLeftRight], ["copy", "Mimic & copy", Repeat], ["update", "Updates & Advisor", RefreshCw], ["merod", "Merod", Landmark]];
const KINDS: [string, string, any, string][] = [
  ["thought", "Thoughts", Brain, "text-[#c9b6ff] bg-[rgba(185,163,240,.14)]"],
  ["analysis", "Analysis", BarChart3, "text-up bg-up-soft"],
  ["decision", "Decisions", Target, "text-[#8fbcff] bg-[rgba(106,168,255,.14)]"],
  ["execution", "Executions", CheckCircle2, "text-up bg-up-soft"],
  ["warning", "Warnings", AlertTriangle, "text-warn bg-warn-soft"],
  ["state", "Status", Gauge, "text-muted bg-panel-2"],
];
const SRC_ICON: Record<string, any> = Object.fromEntries(SOURCES.map(([k, , I]) => [k, I]));
/** Trade-history tabs: a full table of your filled trades instead of the live stream. */
const HISTORY: [string, string, any, "profit" | "sell" | "buy"][] = [["profit", "Profit", TrendingUp, "profit"], ["sold", "Sold", ArrowUpRight, "sell"], ["purchases", "Purchase history", ShoppingCart, "buy"]];
const BAR: Record<string, string> = { thought: "bg-[#c9b6ff]", analysis: "bg-up/70", decision: "bg-[#8fbcff]", execution: "bg-up", warning: "bg-warn", state: "bg-faint" };
const SINGULAR: Record<string, string> = { thought: "Thought", analysis: "Analysis", decision: "Decision", execution: "Execution", warning: "Warning", state: "Status" };
const time = (t: string) => {
  const d = new Date(t), today = d.toDateString() === new Date().toDateString();
  const hms = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return today ? hms : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hms.slice(0, 5)}`;
};

/** Activity: purely real-time live data of Merod, bots and agents — thought process, decisions and executions. */
export default function LiveActivity() {
  usePageTitle({ section: "Insight · Activity", title: "Live Activity", accent: "Activity" });
  const [items, setItems] = useState<Item[]>([]);
  const [src, setSrc] = useState("all");
  const [kinds, setKinds] = useState<Set<string>>(new Set(KINDS.map(([k]) => k)));
  const [paused, setPaused] = useState(false);
  const [q, setQ] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [ok, setOk] = useState<boolean | null>(null);
  const last = useRef<number>(0);
  const pausedRef = useRef(false); pausedRef.current = paused;
  async function pull(initial = false) {
    if (pausedRef.current && !initial) return;
    try {
      const r: any = await api(`/api/live-stream${initial || !last.current ? "" : `?since=${last.current - 2000}`}`);
      last.current = r.now;
      setOk(true);
      setItems((cur) => {
        const seen = new Set(cur.map((i) => i.id));
        const add = (r.items as Item[]).filter((i) => !seen.has(i.id));
        if (add.length && !initial) { setFresh(new Set(add.map((i) => i.id))); setTimeout(() => setFresh(new Set()), 2500); }
        return capFeed([...add, ...cur], 500);
      });
    } catch { setOk(false); }
  }
  useEffect(() => { pull(true); const t = setInterval(() => pull(), 3000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const kick = useRef(0);
  useRealtime((e) => { if (["agent", "bot_log", "fill", "order", "auto", "copy", "trade", "update", "advisor"].includes(e.type) && Date.now() - kick.current > 800) { kick.current = Date.now(); pull(); } });
  // A source tab other than All is fetched from the server (last 30 days) so chatty bots can't push it off the list.
  const [bySrc, setBySrc] = useState<{ key: string; items: Item[] } | null>(null);
  useEffect(() => {
    if (src === "all") return;
    let live = true;
    const load = () => api(`/api/live-stream?filter=${src}&limit=300`).then((r: any) => { if (live) setBySrc({ key: src, items: r.items }); }).catch(() => {});
    load(); const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, [src]);
  const base = src === "all" ? items : bySrc?.key === src ? bySrc.items : [];
  const shown = useMemo(() => base.filter((i) => kinds.has(i.kind) && (!q || `${i.coin?.symbol ?? ""} ${i.actor} ${i.title} ${i.body ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [base, kinds, q]);
  const minute = items.filter((i) => Date.now() - new Date(i.at).getTime() < 60_000).length;
  const counts = (k: string) => items.filter((i) => i.source === k).length;
  // Events per minute over the last 30 minutes (histogram) and the mix of kinds in the last hour.
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 5000); return () => clearInterval(t); }, []);
  const buckets = useMemo(() => {
    const now = Date.now(), b = Array(30).fill(0);
    for (const i of items) { const m = Math.floor((now - new Date(i.at).getTime()) / 60_000); if (m >= 0 && m < 30) b[29 - m]++; }
    return b;
  }, [items, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const peak = Math.max(1, ...buckets);
  const hour = items.filter((i) => Date.now() - new Date(i.at).getTime() < 3_600_000);
  const mix = KINDS.map(([k, l, , cls]) => ({ k, l, cls, n: hour.filter((i) => i.kind === k).length }));
  const mixMax = Math.max(1, ...mix.map((m) => m.n));
  const lastExec = items.find((i) => i.kind === "execution");
  const lastDecision = items.find((i) => i.kind === "decision");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-panel/60 p-1">
          {SOURCES.map(([k, l, I]) => (
            <button key={k} onClick={() => setSrc(k)} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px]", src === k ? "nav-active" : "text-muted hover:text-text")}>
              <I className="size-3.5" />{l}<span className="num text-[10.5px] text-faint">{k === "all" ? items.length : counts(k)}</span>
            </button>
          ))}
          <span className="mx-1 my-1 w-px bg-line" aria-hidden />
          {HISTORY.map(([k, l, I]) => (
            <button key={k} onClick={() => setSrc(k)} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px]", src === k ? "nav-active" : "text-muted hover:text-text")}><I className="size-3.5" />{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search thoughts, tickers, agents…" className="h-8 w-60 rounded-lg border border-line bg-panel-2/60 pl-8 pr-3 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60" /></div>
          <span className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", paused ? "border-warn/40 text-warn" : ok === false ? "border-down/40 text-down" : "border-up/40 text-up")}>
            <span className={cx("size-1.5 rounded-full", paused ? "bg-warn" : ok === false ? "bg-down" : "bg-up pulse-dot")} />{paused ? "PAUSED" : ok === false ? "RECONNECTING" : "LIVE"}
          </span>
          <button onClick={() => { setPaused(!paused); if (paused) pull(); }} className="flex h-8 items-center gap-1.5 rounded-lg border border-line-2 px-3 text-[12.5px] hover:border-accent/50">{paused ? <><Play className="size-3.5" /> Resume stream</> : <><Pause className="size-3.5" /> Pause stream</>}</button>
        </div>
      </div>
      {HISTORY.some(([k]) => k === src) ? <TradeHistory type={HISTORY.find(([k]) => k === src)![3]} q={q} /> : <>
      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map(([k, l, I, cls]) => (
          <button key={k} onClick={() => setKinds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}
            className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-opacity", cls, !kinds.has(k) && "opacity-35")}><I className="size-3.5" />{l}</button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="surface overflow-hidden rounded-2xl">
          {!shown.length && <p className="p-10 text-center text-sm text-muted">{items.length ? "Nothing matches these filters." : "Waiting for activity… Start an agent, a bot or auto trading, or place a trade, and it streams here instantly."}</p>}
          <ol>
            {shown.map((i) => {
              const k = KINDS.find(([kk]) => kk === i.kind) ?? KINDS[5];
              const SI = SRC_ICON[i.source] ?? Activity;
              const KI = k[2];
              const row = (
                <div className={cx("flex items-start gap-3 border-b border-line/60 px-4 py-2.5 transition-colors last:border-0 hover:bg-panel-2/50", fresh.has(i.id) && "fade-up bg-accent-soft/40")}>
                  <span className="num w-[64px] shrink-0 pt-0.5 text-[11px] text-faint">{time(i.at)}</span>
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-accent-2"><SI className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ItemHeader actor={i.actor} coin={i.coin} className="text-[12.5px]" />
                      <span className={cx("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", k[3])}><KI className="size-3" />{SINGULAR[i.kind] ?? k[1]}</span>
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug">{i.title}</div>
                    {i.body && <div className="mt-1 line-clamp-2 rounded-lg border border-line/60 bg-bg-2/50 px-2.5 py-1.5 text-[11.5px] text-muted">{i.body}</div>}
                    {i.eventId && <WhyLine eventId={i.eventId} />}
                  </div>
                </div>
              );
              return <li key={i.id}>{i.link ? <Link href={i.link}>{row}</Link> : row}</li>;
            })}
          </ol>
        </section>

        <aside className="space-y-3">
          <section className="surface rounded-2xl p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Throughput</div>
            <div className="mt-1 flex items-baseline gap-1.5"><span className="num text-[34px] font-semibold leading-none">{minute}</span><span className="text-[12px] text-muted">events / min</span></div>
            <div className="mt-3 flex h-16 items-end gap-[3px]" aria-label="Events per minute, last 30 minutes">
              {buckets.map((n, idx) => <span key={idx} title={`${n} events`} className={cx("flex-1 rounded-sm", idx === 29 ? "bg-accent-2" : "bg-accent/35")} style={{ height: `${Math.max(4, (n / peak) * 100)}%` }} />)}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-faint"><span>30m ago</span><span>now</span></div>
            <div className="mt-4 space-y-2">
              {mix.map((m) => (
                <div key={m.k} className="flex items-center gap-2 text-[11.5px]">
                  <span className="w-20 text-muted">{m.l}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2"><span className={cx("block h-full rounded-full", BAR[m.k])} style={{ width: `${(m.n / mixMax) * 100}%` }} /></span>
                  <span className="num w-8 text-right">{m.n}</span>
                </div>
              ))}
              <div className="text-[10px] text-faint">Last hour</div>
            </div>
          </section>
          {[{ label: "Now executing", item: lastExec, tone: "text-up" }, { label: "Latest decision", item: lastDecision, tone: "text-[#8fbcff]" }].map(({ label, item, tone }) => (
            <section key={label} className="surface rounded-2xl p-4">
              <div className="flex items-center justify-between"><span className={cx("text-[10px] font-semibold uppercase tracking-[0.14em]", tone)}>{label}</span>{item && <span className="text-[10.5px] text-faint">{time(item.at)}</span>}</div>
              {item ? (
                <div className="mt-2">
                  <div className="text-[12px] font-semibold">{item.actor}</div>
                  <div className="mt-0.5 text-[13px] leading-snug">{item.title}</div>
                  {item.body && <div className="mt-1 line-clamp-3 text-[11.5px] text-muted">{item.body}</div>}
                  {item.link && <Link href={item.link} className="mt-2 inline-block text-[11.5px] text-accent-2 hover:underline">Open →</Link>}
                </div>
              ) : <p className="mt-2 text-[12px] text-faint">Nothing yet.</p>}
            </section>
          ))}
          <p className="px-1 text-[10.5px] leading-relaxed text-faint">Updates every 3 seconds and instantly on live events. Decision summaries and rule checks only, never private model chain-of-thought. Platform trades from other Merod traders are anonymous.</p>
        </aside>
      </div>
      </>}
    </div>
  );
}
