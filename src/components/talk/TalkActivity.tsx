"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, X, Brain, Target, CheckCircle2, AlertTriangle, BarChart3, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { PortfolioSpark } from "./PortfolioSpark";

type Item = { id: string; at: string; source: string; kind: string; actor: string; title: string; body?: string; link?: string; side?: "buy" | "sell" };
const KIND: Record<string, [any, string]> = {
  thought: [Brain, "text-[#c9b6ff]"], analysis: [BarChart3, "text-up"], decision: [Target, "text-[#8fbcff]"],
  execution: [CheckCircle2, "text-up"], warning: [AlertTriangle, "text-warn"], state: [Gauge, "text-muted"],
};
const SOURCES: [string, string][] = [["all", "All"], ["order", "Trades"], ["bot", "Bots"], ["agent", "Agents"], ["auto", "Auto"], ["modo", "Modo"], ["copy", "Mimic"], ["buy", "Buys"], ["sell", "Sells"]];
/** Buys / Sells filter by trade side across every source (orders, fills, Mimic, Auto, Modo). */
const SIDE = new Set(["buy", "sell"]);
const hms = (t: string) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** "Activity" button in the Talk top bar: opens a live side panel of everything trading for you, without leaving Talk. */
export function TalkActivity() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [src, setSrc] = useState("all");
  const [fresh, setFresh] = useState(0);
  const last = useRef(0);
  const openRef = useRef(false); openRef.current = open;
  async function pull(initial = false) {
    try {
      const r: any = await api(`/api/live-stream${initial || !last.current ? "" : `?since=${last.current - 2000}`}`);
      last.current = r.now;
      setItems((cur) => {
        const seen = new Set(cur.map((i) => i.id));
        const add = (r.items as Item[]).filter((i) => !seen.has(i.id));
        if (add.length && !initial && !openRef.current) setFresh((n) => n + add.length);
        return [...add, ...cur].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
      });
    } catch { /* keep the last list */ }
  }
  useEffect(() => { pull(true); const t = setInterval(() => pull(), 4000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime((e) => { if (["agent", "bot_log", "fill", "order", "auto", "copy", "trade"].includes(e.type)) pull(); });
  const shown = items.filter((i) => src === "all" || (SIDE.has(src) ? i.side === src : i.source === src));

  return (
    <>
      <button onClick={() => { setOpen(true); setFresh(0); }} title="Real-time activity: thoughts, decisions and trades from your bots, agents, auto trading, Modo and orders"
        className="relative flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-text">
        <span className="size-1.5 rounded-full bg-up pulse-dot" /><Activity className="size-3.5" /><span className="hidden sm:inline">Activity</span>
        {fresh > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-bg">{fresh > 99 ? "99+" : fresh}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-full max-w-[420px] flex-col border-l border-line bg-bg-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-accent-2" /> Activity <span className="flex items-center gap-1 rounded-full border border-up/40 px-2 py-0.5 text-[10px] font-semibold text-up"><span className="size-1.5 rounded-full bg-up pulse-dot" />LIVE</span></span>
              <div className="flex items-center gap-2">
                <Link href="/live" className="text-[11.5px] text-accent-2 hover:underline">Full screen →</Link>
                <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:text-text" aria-label="Close"><X className="size-4" /></button>
              </div>
            </div>
            <div className="border-b border-line px-4 py-3"><div className="mb-1 text-[11px] font-semibold text-muted">Portfolio · P&L</div><PortfolioSpark height={70} /></div>
            <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
              {SOURCES.map(([k, l]) => (
                <button key={k} onClick={() => setSrc(k)} className={cx("rounded-md px-2 py-0.5 text-[11.5px]", src === k ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>{l}</button>
              ))}
            </div>
            <ol className="flex-1 overflow-y-auto">
              {!shown.length && <li className="p-8 text-center text-[12px] text-faint">Waiting for activity… Bots, agents, auto trading, Modo and your orders stream here the moment they think, decide or trade.</li>}
              {shown.map((i) => {
                const [I, cls] = KIND[i.kind] ?? KIND.state;
                const row = (
                  <div className="flex gap-2.5 border-b border-line/50 px-4 py-2.5 hover:bg-panel-2/50">
                    <I className={cx("mt-0.5 size-4 shrink-0", cls)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-[11px]"><span className="truncate font-semibold text-text">{i.actor}</span><span className="num shrink-0 text-faint">{hms(i.at)}</span></div>
                      <div className="text-[12.5px] leading-snug">{i.title}</div>
                      {i.body && <div className="line-clamp-2 text-[11px] text-muted">{i.body}</div>}
                    </div>
                  </div>
                );
                return <li key={i.id}>{i.link ? <Link href={i.link} onClick={() => setOpen(false)}>{row}</Link> : row}</li>;
              })}
            </ol>
          </aside>
        </div>
      )}
    </>
  );
}
