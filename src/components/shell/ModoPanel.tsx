"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cpu, Sparkles, RefreshCw, Newspaper, Users, TrendingUp, Brain, AlertTriangle, Lightbulb, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useShell } from "./context";
import { Badge, cx } from "@/components/ui";
import { ago } from "@/lib/format";

type Step = { text: string; kind: string; at: number };
const STEP_ICON: Record<string, any> = { news: Newspaper, read: Newspaper, signal: TrendingUp, think: Brain, idea: Lightbulb, warn: AlertTriangle, learn: Brain };
const LABEL: Record<string, string> = { news: "News", crowd: "Trader flow", momentum: "Momentum", own: "Your book" };
const pctTxt = (x: number | null) => (x == null ? "pending" : `${x >= 0 ? "+" : ""}${(Number(x) * 100).toFixed(1)}%`);

/**
 * Modo: trading ideas from news, other traders' flow, momentum and your own trades — with its live thought process.
 * Thinks when opened and every 2 minutes while visible. Ideas are suggestions; "Preview" goes through the normal checks.
 */
export function ModoPanel({ active }: { active: boolean }) {
  const { openPrompt, user } = useShell();
  const { data, refresh } = useApi<any>(active ? "/api/modo" : null, { refreshMs: 60_000 });
  const [steps, setSteps] = useState<Step[]>([]);
  const [thinking, setThinking] = useState(false);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const es = useRef<EventSource | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const run = useCallback(() => {
    if (es.current) return;
    setThinking(true); setSteps([]);
    const src = new EventSource("/api/modo/think");
    es.current = src;
    src.addEventListener("step", (e: MessageEvent) => { const s = JSON.parse(e.data); setSteps((cur) => [...cur, s].slice(-40)); });
    const finish = () => { src.close(); es.current = null; setThinking(false); setLastRun(Date.now()); refresh(); };
    src.addEventListener("done", finish);
    src.onerror = finish;
  }, [refresh]);

  // Think when the tab is opened, then every 2 minutes while it stays open and the page is visible.
  useEffect(() => {
    if (!active) return;
    if (!lastRun || Date.now() - lastRun > 120_000) run();
    const t = setInterval(() => { if (document.visibilityState === "visible") run(); }, 120_000);
    return () => clearInterval(t);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { es.current?.close(); es.current = null; }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [steps]);

  const ideas: any[] = data?.ideas ?? [];
  const news: any[] = data?.news ?? [];
  const st = data?.state;
  const graded = st?.stats?.graded ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Sparkles className="size-3.5 text-accent-2" /> Modo</h3>
        <button onClick={run} disabled={thinking} className="flex items-center gap-1 text-[11px] text-accent-2 disabled:opacity-50">
          {thinking ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}{thinking ? "Thinking…" : "Think again"}
        </button>
      </div>

      {/* Live thought process */}
      <section className="rounded-xl border border-line bg-panel p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-faint">
          <span>Thought process</span>
          <span className={cx("flex items-center gap-1 normal-case", thinking ? "text-up" : "")}><span className={cx("size-1.5 rounded-full", thinking ? "bg-up pulse-dot" : "bg-faint")} />{thinking ? "live" : lastRun ? `updated ${ago(lastRun)}` : "idle"}</span>
        </div>
        <div ref={listRef} className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {steps.length === 0 && !thinking && <p className="text-[11px] text-faint">Press Think again to watch Modo work through the latest news and trades.</p>}
          {steps.map((s, i) => {
            const Icon = STEP_ICON[s.kind] ?? Brain;
            return (
              <div key={i} className="fade-up flex gap-1.5 text-[11px] leading-snug">
                <Icon className={cx("mt-px size-3 shrink-0", s.kind === "idea" || s.kind === "news" ? "text-accent-2" : s.kind === "warn" ? "text-warn" : "text-faint")} />
                <span className={s.kind === "idea" || s.kind === "news" ? "text-text" : "text-muted"}>{s.text}</span>
              </div>
            );
          })}
          {thinking && <div className="flex items-center gap-1.5 text-[11px] text-faint"><Loader2 className="size-3 animate-spin" /> working…</div>}
        </div>
      </section>

      {user.role === "super_admin" && <AutoTradesSection active={active} />}

      {/* News facts: real headlines, quoted exactly, with source and link */}
      <section>
        <h4 className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint"><Newspaper className="size-3" /> News facts</h4>
        {news.length === 0 ? <p className="text-[11px] text-faint">{data ? "No recent headlines from the news feeds right now." : "Loading headlines…"}</p> : (
          <ul className="space-y-1.5">
            {news.slice(0, 6).map((n: any) => (
              <li key={n.url} className="rounded-xl border border-line bg-panel p-2.5">
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium leading-snug text-text hover:text-accent-2">{n.title}</a>
                {n.summary && <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted">{n.summary}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] text-faint">
                  <span className={cx("rounded px-1 py-0.5", n.tone === "positive" ? "bg-up/15 text-up" : n.tone === "negative" ? "bg-down/15 text-down" : "bg-panel-2")}>{n.why}</span>
                  <span>{n.source}</span>
                  {n.publishedAt && <span className="ml-auto">{ago(n.publishedAt)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Ideas */}
      <section>
        <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Trade ideas</h4>
        {ideas.length === 0 ? <p className="text-[11px] text-faint">No ideas yet. Modo only suggests a trade when several signals agree.</p> : (
          <ul className="space-y-1.5">
            {ideas.slice(0, 6).map((i) => {
              const r = i.ret_24h ?? i.ret_1h;
              return (
                <li key={i.id} className="rounded-xl border border-line bg-panel p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold"><span className={i.side === "buy" ? "text-up" : "text-down"}>{i.side.toUpperCase()}</span> {i.symbol}</span>
                    <span className="flex items-center gap-1">
                      {r != null && <Badge tone={Number(r) > 0 ? "up" : "down"} title="How the idea has played out so far">{pctTxt(r)}</Badge>}
                      <Badge tone="accent">{Math.round(Number(i.confidence) * 100)}%</Badge>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted">{i.thesis}</p>
                  {i.risk && <p className="mt-0.5 text-[10px] leading-snug text-warn/90">Risk: {i.risk}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px] text-faint">
                    {Object.entries(i.signals ?? {}).filter(([, v]) => Math.abs(Number(v)) > 0.1).map(([k, v]) => (
                      <span key={k} className="rounded bg-panel-2 px-1 py-0.5">{{ news: "news", crowd: "traders", momentum: "momentum", own: "your book" }[k] ?? k} {Number(v) > 0 ? "▲" : "▼"}</span>
                    ))}
                    <span className="ml-auto">{ago(i.created_at)}</span>
                  </div>
                  <button onClick={() => openPrompt(i.side === "buy" ? `Buy $100 of ${i.symbol}` : `Sell 25% of ${i.symbol}`)}
                    className="mt-1.5 w-full rounded-lg border border-line py-1 text-[11px] text-muted hover:border-accent/50 hover:text-text">Preview this trade</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* What Modo learned */}
      <section className="rounded-xl border border-line bg-panel p-2.5">
        <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint"><Brain className="size-3" /> What Modo learned</h4>
        <p className="text-[11px] text-muted">{graded ? <>Graded {graded} idea{graded > 1 ? "s" : ""}; right {Math.round((st.stats.winRate ?? 0) * 100)}% of the time.</> : "Ideas are graded 1 hour and 24 hours after they're made. Results show up here."}</p>
        {st?.stats?.hitRates && Object.keys(st.stats.hitRates).length > 0 && (
          <div className="mt-1.5 grid grid-cols-2 gap-1 text-[10px]">
            {Object.entries(st.stats.hitRates).map(([k, v]: any) => (
              <div key={k} className="rounded-md bg-panel-2 px-1.5 py-1"><div className="text-faint">{LABEL[String(k)] ?? String(k)}</div><div className="num text-text">{Math.round(v * 100)}% right · ×{Number(st.weights?.[k] ?? 1).toFixed(2)}</div></div>
            ))}
          </div>
        )}
        {(st?.notes ?? []).slice(0, 4).map((n: any, i: number) => <p key={i} className="mt-1.5 text-[10px] leading-snug text-muted">• {n.text} <span className="text-faint">{ago(n.at)}</span></p>)}
      </section>
      <p className="text-[9px] leading-snug text-faint">Modo's ideas are suggestions, not financial advice, and can be wrong. Nothing is traded unless you confirm it.</p>
    </div>
  );
}

/** Owner only: the auto-trading switch and Modo's before / during / after explanation of each auto trade. */
function AutoTradesSection({ active }: { active: boolean }) {
  const { data, refresh } = useApi<any>(active ? "/api/auto" : null, { refreshMs: 15_000 });
  const [busy, setBusy] = useState(false);
  const on = !!data?.settings?.enabled;
  async function flip() {
    setBusy(true);
    try { await api("/api/auto", { method: "PATCH", json: { enabled: !on } }); await refresh(); } finally { setBusy(false); }
  }
  const trades: any[] = (data?.trades ?? []).slice(0, 3);
  return (
    <section className="rounded-xl border border-line bg-panel p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <Link href="/auto" className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint hover:text-text"><Cpu className="size-3" /> Auto trading</Link>
        <button onClick={flip} disabled={!data || busy} aria-label="Auto trading switch" className={cx("relative h-5 w-9 rounded-full transition-colors disabled:opacity-50", on ? "bg-up" : "bg-panel-2")}>
          <span className={cx("absolute top-0.5 size-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
      {trades.length === 0 ? <p className="text-[11px] text-faint">{on ? "Watching for trades where the data points agree." : "Off. Turn it on to let Merod trade from the data (theoretical trades first)."}</p> : (
        <ul className="space-y-1.5">
          {trades.map((t) => (
            <li key={t.id} className="text-[11px] leading-snug">
              <div className="flex items-center justify-between"><span className="font-semibold text-text">BUY {t.symbol} <span className="font-normal text-faint">· {t.mode === "real" ? "real" : "theoretical"}</span></span>
                <span className={t.status === "closed" ? (Number(t.return_pct) > 0 ? "text-up" : "text-down") : "text-faint"}>{t.status === "closed" ? `${Number(t.return_pct) >= 0 ? "+" : ""}${Number(t.return_pct).toFixed(2)}%` : t.status}</span></div>
              <p className="text-muted"><b className="text-faint">Before:</b> {String(t.explain_before).split("\n")[0]}</p>
              {t.explain_during && <p className="text-muted"><b className="text-faint">During:</b> {t.explain_during}</p>}
              {t.explain_after && <p className="text-muted"><b className="text-faint">After:</b> {t.explain_after}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
