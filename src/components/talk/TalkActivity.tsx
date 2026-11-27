"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, X, Brain, Target, CheckCircle2, AlertTriangle, BarChart3, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { capFeed } from "@/lib/feed";
import { ItemHeader, type FeedCoin } from "@/components/activity/ItemHeader";
import { WhyLine } from "@/components/agents/Why";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { PortfolioSpark } from "./PortfolioSpark";

type Item = { id: string; at: string; source: string; kind: string; actor: string; title: string; body?: string; link?: string; side?: "buy" | "sell"; pnl?: number; pnlPct?: number; coin?: FeedCoin; eventId?: number };
const KIND: Record<string, [any, string]> = {
  thought: [Brain, "text-[#c9b6ff]"], analysis: [BarChart3, "text-up"], decision: [Target, "text-[#8fbcff]"],
  execution: [CheckCircle2, "text-up"], warning: [AlertTriangle, "text-warn"], state: [Gauge, "text-muted"],
};
const SOURCES: [string, string][] = [["all", "All"], ["order", "Trades"], ["bot", "Bots"], ["agent", "Agents"], ["auto", "Auto"], ["modo", "Modo"], ["copy", "Mimic"], ["update", "Updates"], ["buy", "Buys"], ["sell", "Sells"], ["profit", "Profit"], ["loss", "Loss"]];
/** Profit / Loss: closed trades by realized P&L in $ (or % for theoretical Auto/Modo trades with no order). */
const pnlOf = (i: Item) => i.pnl ?? i.pnlPct;
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
        return capFeed([...add, ...cur], 300);
      });
    } catch { /* keep the last list */ }
  }
  // Any filter other than All is fetched from the server (last 30 days), so busy bots can't crowd trades out of the list.
  const [filtered, setFiltered] = useState<{ key: string; items: Item[] } | null>(null);
  const srcRef = useRef(src); srcRef.current = src;
  async function pullFiltered(key = srcRef.current) {
    if (key === "all") return;
    try {
      const r: any = await api(`/api/live-stream?filter=${key}&limit=300`);
      if (srcRef.current === key) setFiltered({ key, items: r.items as Item[] });
    } catch { /* keep the last list */ }
  }
  useEffect(() => { pull(true); const t = setInterval(() => pull(), 4000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || src === "all") return;
    pullFiltered(src);
    const t = setInterval(() => pullFiltered(src), 8000);
    return () => clearInterval(t);
  }, [open, src]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime((e) => { if (["agent", "bot_log", "fill", "order", "auto", "copy", "trade", "update", "advisor"].includes(e.type)) { pull(); if (openRef.current) pullFiltered(); } });
  const loadingFilter = src !== "all" && filtered?.key !== src;
  const shown = src === "all" ? items : filtered?.key === src ? filtered.items : [];
  const closed = shown.filter((i) => i.pnl !== undefined);
  const net = closed.reduce((s, i) => s + (i.pnl ?? 0), 0);

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
            {(src === "profit" || src === "loss" || src === "sell") && closed.length > 0 && (
              <div className="flex items-center justify-between border-b border-line px-4 py-1.5 text-[11.5px]">
                <span className="text-muted">{closed.length} closed trade{closed.length === 1 ? "" : "s"} shown</span>
                <span className={cx("num font-semibold", net >= 0 ? "text-up" : "text-down")}>Net {net >= 0 ? "+" : "−"}${Math.abs(net).toFixed(2)}</span>
              </div>
            )}
            <ol className="flex-1 overflow-y-auto">
              {loadingFilter && <li className="p-8 text-center text-[12px] text-faint">Loading…</li>}
              {!shown.length && !loadingFilter && src !== "all" && <li className="p-8 text-center text-[12px] text-faint">{src === "profit" ? "No profitable closed trades" : src === "loss" ? "No losing closed trades" : "Nothing here"} in the last 30 days.</li>}
              {!shown.length && src === "all" && <li className="p-8 text-center text-[12px] text-faint">Waiting for activity… Bots, agents, auto trading, Modo and your orders stream here the moment they think, decide or trade.</li>}
              {shown.map((i) => {
                const [I, cls] = KIND[i.kind] ?? KIND.state;
                const row = (
                  <div className="flex gap-2.5 border-b border-line/50 px-4 py-2.5 hover:bg-panel-2/50">
                    <I className={cx("mt-0.5 size-4 shrink-0", cls)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-[11px]"><ItemHeader actor={i.actor} coin={i.coin} /><span className="num shrink-0 text-faint">{hms(i.at)}</span></div>
                      <div className="text-[12.5px] leading-snug">{i.title}
                        {pnlOf(i) !== undefined && (
                          <span className={cx("num ml-1.5 whitespace-nowrap rounded px-1 text-[10.5px] font-semibold", pnlOf(i)! >= 0 ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
                            {i.pnl !== undefined ? `${i.pnl >= 0 ? "+" : "−"}$${Math.abs(i.pnl).toFixed(2)}` : ""}{i.pnl !== undefined && i.pnlPct !== undefined ? " · " : ""}{i.pnlPct !== undefined ? `${i.pnlPct >= 0 ? "+" : ""}${i.pnlPct.toFixed(2)}%` : ""}
                          </span>
                        )}
                      </div>
                      {i.body && <div className="line-clamp-2 text-[11px] text-muted">{i.body}</div>}
                      {i.eventId && <WhyLine eventId={i.eventId} />}
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
