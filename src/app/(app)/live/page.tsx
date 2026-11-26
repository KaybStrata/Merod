"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Brain, Target, CheckCircle2, AlertTriangle, Gauge, Bot, Sparkles, Cpu, Repeat, ArrowLeftRight, Landmark, Pause, Play, Search, BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";

type Item = { id: string; at: string; source: string; kind: string; actor: string; title: string; body?: string; link?: string };
const SOURCES: [string, string, any][] = [["all", "Everything", Activity], ["agent", "Agents", Sparkles], ["bot", "Bots", Bot], ["auto", "Auto trading", Cpu], ["modo", "Modo", Brain], ["order", "Orders", ArrowLeftRight], ["copy", "Mimic & copy", Repeat], ["merod", "Merod", Landmark]];
const KINDS: [string, string, any, string][] = [
  ["thought", "Thoughts", Brain, "text-[#c9b6ff] bg-[rgba(185,163,240,.14)]"],
  ["analysis", "Analysis", BarChart3, "text-up bg-up-soft"],
  ["decision", "Decisions", Target, "text-[#8fbcff] bg-[rgba(106,168,255,.14)]"],
  ["execution", "Executions", CheckCircle2, "text-up bg-up-soft"],
  ["warning", "Warnings", AlertTriangle, "text-warn bg-warn-soft"],
  ["state", "Status", Gauge, "text-muted bg-panel-2"],
];
const SRC_ICON: Record<string, any> = Object.fromEntries(SOURCES.map(([k, , I]) => [k, I]));
const SINGULAR: Record<string, string> = { thought: "Thought", analysis: "Analysis", decision: "Decision", execution: "Execution", warning: "Warning", state: "Status" };
const time = (t: string) => {
  const d = new Date(t), today = d.toDateString() === new Date().toDateString();
  const hms = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return today ? hms : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hms.slice(0, 5)}`;
};

/** Activity: purely real-time live data of Merod, bots and agents — thought process, decisions and executions. */
export default function LiveActivity() {
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
        return [...add, ...cur].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
      });
    } catch { setOk(false); }
  }
  useEffect(() => { pull(true); const t = setInterval(() => pull(), 3000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const kick = useRef(0);
  useRealtime((e) => { if (["agent", "bot_log", "fill", "order", "auto", "copy", "trade"].includes(e.type) && Date.now() - kick.current > 800) { kick.current = Date.now(); pull(); } });
  const shown = useMemo(() => items.filter((i) => (src === "all" || i.source === src) && kinds.has(i.kind) && (!q || `${i.actor} ${i.title} ${i.body ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [items, src, kinds, q]);
  const minute = items.filter((i) => Date.now() - new Date(i.at).getTime() < 60_000).length;
  const counts = (k: string) => items.filter((i) => i.source === k).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title"><Activity className="text-accent-2" /> Activity</h1>
          <p>Everything thinking, deciding and trading for you, as it happens: agents, bots, auto trading, Modo, your orders, mimic trades and Merod itself.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold", paused ? "border-warn/40 text-warn" : ok === false ? "border-down/40 text-down" : "border-up/40 text-up")}>
            <span className={cx("size-2 rounded-full", paused ? "bg-warn" : ok === false ? "bg-down" : "bg-up pulse-dot")} />{paused ? "PAUSED" : ok === false ? "RECONNECTING" : "LIVE"}
          </span>
          <span className="rounded-full border border-line-2 px-3 py-1.5 text-[12px] text-muted"><b className="num text-text">{minute}</b> events / last minute</span>
          <button onClick={() => { setPaused(!paused); if (paused) pull(); }} className="flex h-9 items-center gap-1.5 rounded-xl border border-line-2 px-3 text-sm hover:border-accent/50">{paused ? <><Play className="size-4" /> Resume</> : <><Pause className="size-4" /> Pause</>}</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-panel/60 p-1">
        {SOURCES.map(([k, l, I]) => (
          <button key={k} onClick={() => setSrc(k)} className={cx("flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px]", src === k ? "nav-active" : "text-muted hover:text-text")}>
            <I className="size-4" />{l}{k !== "all" && <span className="num text-[11px] text-faint">{counts(k)}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map(([k, l, I, cls]) => (
          <button key={k} onClick={() => setKinds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}
            className={cx("flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-opacity", cls, !kinds.has(k) && "opacity-35")}><I className="size-3.5" />{l}</button>
        ))}
        <div className="relative ml-auto"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, coin, word…" className="h-9 w-64 rounded-xl border border-line bg-panel-2/60 pl-8 pr-3 text-sm outline-none focus:border-accent/60" /></div>
      </div>

      <section className="surface rounded-2xl">
        {!shown.length && <p className="p-10 text-center text-sm text-muted">{items.length ? "Nothing matches these filters." : "Waiting for activity… Start an agent, a bot or auto trading, or place a trade, and it streams here instantly."}</p>}
        <ol>
          {shown.map((i) => {
            const k = KINDS.find(([kk]) => kk === i.kind) ?? KINDS[5];
            const SI = SRC_ICON[i.source] ?? Activity;
            const KI = k[2];
            const row = (
              <div className={cx("flex items-start gap-3 border-b border-line/60 px-4 py-3 transition-colors last:border-0 hover:bg-panel-2/50", fresh.has(i.id) && "fade-up bg-accent-soft/40")}>
                <span className="num w-[70px] shrink-0 pt-0.5 text-[11.5px] text-faint">{time(i.at)}</span>
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-accent-2"><SI className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold">{i.actor}</span>
                    <span className={cx("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", k[3])}><KI className="size-3" />{SINGULAR[i.kind] ?? k[1]}</span>
                  </div>
                  <div className="mt-0.5 text-[13.5px] leading-snug">{i.title}</div>
                  {i.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{i.body}</div>}
                </div>
              </div>
            );
            return <li key={i.id}>{i.link ? <Link href={i.link}>{row}</Link> : row}</li>;
          })}
        </ol>
      </section>
      <p className="text-[11px] text-faint">Updates every 3 seconds and instantly on live events. Decision summaries and rule checks only, never private model chain-of-thought. Platform trades from other Merod traders are anonymous.</p>
    </div>
  );
}
