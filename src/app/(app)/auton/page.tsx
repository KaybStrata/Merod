"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Play, Loader2, PanelRightOpen, PanelRightClose, Settings2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, usePageTitle } from "@/components/shell/context";
import { TalkThread } from "@/components/talk/TalkThread";
import { TalkComposer } from "@/components/talk/TalkComposer";
import { PnlLine } from "@/components/talk/TabPnl";
import { AutoModesBar } from "@/components/AutoModesBar";
import { openFloat } from "@/components/talk/FloatingPages";
import { cx, useToast } from "@/components/ui";
import { usd, ago } from "@/lib/format";

export default function AutonPage() {
  return <Suspense fallback={null}><AutonMode /></Suspense>;
}

/**
 * Auton mode: talk to Auton the way Talk mode talks to Merod. Auton reports into this conversation, its thinking and
 * actions stream in, and the activity bar on the right shows only Auton's own P&L (with period comparison), its feed
 * and its bots. The auto switches sit in the header.
 */
function AutonMode() {
  usePageTitle({ section: "Auton", title: "Auton · autonomous trader", accent: "Auton" });
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/auton", { refreshMs: 10_000 });
  const s = data?.settings;
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [side, setSide] = useState(true);
  const [book, setBook] = useState<"paper" | "live">("paper");
  const bottom = useRef<HTMLDivElement>(null);

  // Auton's own conversation: the one it reports to.
  useEffect(() => { if (s && !convId && s.conversation_id) setConvId(s.conversation_id); }, [s, convId]);
  const load = useCallback(async (id: string) => { const r: any = await api(`/api/ai/conversations?c=${id}`); setMessages(r.messages ?? []); }, []);
  useEffect(() => { if (convId) load(convId).catch(() => setMessages([])); }, [convId, load]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, busy]);

  // Auton's thinking and actions stream into the chat as they happen.
  const since = useRef(Date.now());
  useEffect(() => {
    let live = true;
    const pull = async () => {
      try {
        const r: any = await api(`/api/live-stream?filter=auton&since=${since.current - 1000}&limit=40`);
        if (!live) return;
        since.current = r.now ?? Date.now();
        const items = (r.items ?? []).filter((i: any) => ["execution", "decision", "warning"].includes(i.kind)).reverse();
        if (!items.length) return;
        setMessages((m) => {
          const seen = new Set(m.map((x: any) => x.id));
          const add = items.filter((i: any) => !seen.has(`n-${i.id}`)).slice(-8).map((i: any) => ({ id: `n-${i.id}`, role: "assistant", narration: true, created_at: i.at, content: `Auton: ${i.title}${i.body ? ` — ${String(i.body).slice(0, 200)}` : ""}` }));
          return add.length ? [...m, ...add] : m;
        });
      } catch { /* retry */ }
    };
    const t = setInterval(pull, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const kick = useRef(0);
  useRealtime((e) => { if (convId && ["fill", "order"].includes(e.type) && Date.now() - kick.current > 2000) { kick.current = Date.now(); load(convId).catch(() => {}); } });

  async function send(text: string, attachmentIds?: string[]) {
    setBusy(true);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: text }]);
    try {
      const r: any = await api("/api/ai/prompt", { method: "POST", json: { text, conversationId: convId, book, provider: "auton", attachmentIds, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      const replies = Array.isArray(r.messages) && r.messages.length ? r.messages : [r.message];
      setMessages((m) => [...m, ...replies]);
      if (r.conversationId && r.conversationId !== convId) setConvId(r.conversationId);
      refresh();
    } catch (e: any) { setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: e.message, status: "error" }]); }
    finally { setBusy(false); }
  }
  async function setActive(on: boolean) {
    try { await api("/api/auton", { method: "POST", json: { active: on } }); toast(on ? "Auton is on" : "Auton is off", on ? "up" : "neutral"); refresh(); } catch (e: any) { toast(e.message, "down"); }
  }
  async function runNow() {
    setRunning(true);
    try { const r = await api("/api/auton", { method: "POST", json: { runNow: true } }); toast(r.run?.actions?.length ? `Auton: ${r.run.actions.length} action(s)` : "Auton: nothing needed changing", "up"); refresh(); if (convId) load(convId).catch(() => {}); }
    catch (e: any) { toast(e.message, "down"); } finally { setRunning(false); }
  }

  const suggestions = ["Focus on Solana meme coins", "Auton budget $2000", "What are you doing right now?", "Make 3 momentum bots", "Stop Auton"];
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header: Auton status, controls and the auto switches */}
        <div className="shrink-0 border-b border-line bg-panel/40 px-4 py-2">
          <div className="mx-auto flex w-full max-w-[860px] flex-wrap items-center gap-2">
            <span className={cx("flex size-7 items-center justify-center rounded-lg", s?.active ? "bg-orange-400/20 text-orange-300" : "bg-panel-2 text-faint")}><Cpu className="size-4" /></span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">Auton {s ? (s.active ? <span className="text-up">· on</span> : <span className="text-muted">· off</span>) : null}</div>
              <div className="text-[10.5px] text-faint">{s ? `${Number(s.max_capital_usd) ? `budget ${usd(Number(s.max_capital_usd))}` : "no budget limit"} · ${Number(s.max_bots) ? `max ${s.max_bots} bots` : "no bot limit"} · every ${s.every_sec}s · ${s.real_money ? "real money" : "paper"}${s.last_run_at ? ` · checked ${ago(s.last_run_at)}` : ""}` : "Loading…"}</div>
            </div>
            <button role="switch" aria-checked={!!s?.active} aria-label="Auton on/off" onClick={() => setActive(!s?.active)} className={cx("relative ml-1 h-5 w-9 rounded-full transition", s?.active ? "bg-accent" : "bg-panel-2 ring-1 ring-line")}>
              <span className={cx("absolute top-0.5 size-4 rounded-full bg-white transition-all", s?.active ? "left-[18px]" : "left-0.5")} />
            </button>
            <button onClick={runNow} disabled={running} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] text-muted hover:text-text disabled:opacity-60">{running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}Run now</button>
            <button onClick={() => openFloat("auton")} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] text-muted hover:text-text" title="Edit Auton's settings and every bot/agent it made"><Settings2 className="size-3.5" />Edit Auton</button>
            <button onClick={() => setSide((v) => !v)} className="ml-auto rounded-lg border border-line p-1.5 text-muted hover:text-text" title={side ? "Hide activity" : "Show activity"}>{side ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}</button>
            <AutoModesBar compact className="w-full" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[860px] space-y-6 px-4 pb-6 pt-6 sm:px-6">
            {!messages.length && (
              <div className="pt-12 text-center">
                <h2 className="text-[24px] font-semibold">What should <span className="serif-accent text-orange-300">Auton</span> work on?</h2>
                <p className="mt-1 text-sm text-muted">Give it goals in plain words, paste a link for it to learn from, or just switch it on. It makes and runs its own bots, and reports here.</p>
              </div>
            )}
            <TalkThread messages={messages} onSend={send} onDone={() => convId && load(convId)} />
            {busy && <div className="flex items-center gap-2 pl-12 text-[13px] text-muted"><span className="size-1.5 animate-pulse rounded-full bg-orange-300" /> Auton is thinking…</div>}
            <div ref={bottom} />
          </div>
        </div>
        <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-[860px]">
            <TalkComposer onSend={send} busy={busy} suggestions={suggestions} voice={false} book={book} onBook={setBook} ai="auton" onAi={() => {}} placeholder="Tell Auton what to do, or paste/drop a link for it to learn from…" />
          </div>
        </div>
      </div>
      {side && <AutonActivity bots={data?.bots ?? []} />}
    </div>
  );
}

const RANGES: [string, number | null, string][] = [["1H", 3600, "previous hour"], ["24H", 86_400, "previous 24h"], ["7D", 7 * 86_400, "previous 7 days"], ["30D", 30 * 86_400, "previous 30 days"], ["All", null, ""]];

/** Auton's own activity bar: its P&L (separate from everything else) with period comparison, its feed and its bots. */
function AutonActivity({ bots }: { bots: any[] }) {
  const [ri, setRi] = useState(1);
  const [, label, prevLabel] = [null, RANGES[ri][0], RANGES[ri][2]];
  const range = RANGES[ri][1];
  const pnl = useApi<any>(`/api/auton/pnl${range ? `?range=${range}` : ""}`, { refreshMs: 10_000 });
  const feed = useApi<any>("/api/live-stream?filter=auton&limit=60", { refreshMs: 5_000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") pnl.refresh(); });
  const d = pnl.data;
  const p = d?.period?.pnl ?? 0, prev = d?.previous?.pnl ?? null, up = p >= 0;
  const color = up ? "var(--color-up, #22c55e)" : "var(--color-down, #f0506e)";
  const delta = prev == null ? null : p - prev;
  return (
    <aside className="hidden w-[340px] shrink-0 flex-col border-l border-line bg-panel/30 md:flex">
      <div className="border-b border-line p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Auton P&L</span>
          <div className="flex rounded-md border border-line p-0.5">
            {RANGES.map(([l], i) => <button key={l} onClick={() => setRi(i)} className={cx("rounded px-1.5 py-0.5 text-[10.5px]", ri === i ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>{l}</button>)}
          </div>
        </div>
        {!d ? <div className="h-[150px] text-[11px] text-faint">Loading…</div> : (
          <>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className={cx("num text-[22px] font-semibold", up ? "text-up" : "text-down")}>{up ? "+" : "−"}{usd(Math.abs(p))}</span>
              <span className="text-[11px] text-muted">{range ? `this ${label === "1H" ? "hour" : label === "24H" ? "24h" : label === "7D" ? "week" : "month"}` : "all time"}</span>
            </div>
            {prev != null && (
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                {delta! >= 0 ? <ArrowUpRight className="size-3.5 text-up" /> : <ArrowDownRight className="size-3.5 text-down" />}
                <span className={cx("num", delta! >= 0 ? "text-up" : "text-down")}>{delta! >= 0 ? "+" : "−"}{usd(Math.abs(delta!))}</span>
                <span className="text-muted">vs {prevLabel} ({prev >= 0 ? "+" : "−"}{usd(Math.abs(prev))})</span>
              </div>
            )}
            <PnlLine pts={d.points ?? []} color={color} height={110} nowLabel={range ? "this period, now (incl. open)" : "now (incl. open)"} />
            <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[10.5px]">
              <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Closed</div><div className="num text-text">{d.period.closed}{prev != null ? <span className="text-faint"> / {d.previous.closed}</span> : null}</div></div>
              <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Won</div><div className="num text-text">{d.period.closed ? Math.round((d.period.wins / d.period.closed) * 100) : 0}%{prev != null && d.previous.closed ? <span className="text-faint"> / {Math.round((d.previous.wins / d.previous.closed) * 100)}%</span> : null}</div></div>
              <div className="rounded-md bg-panel/60 py-1"><div className="text-faint">Open</div><div className={cx("num", d.unrealized >= 0 ? "text-up" : "text-down")}>{d.unrealized >= 0 ? "+" : "−"}{usd(Math.abs(d.unrealized))}</div></div>
            </div>
            <div className="mt-1 text-[10.5px] text-faint">All time {d.total >= 0 ? "+" : "−"}{usd(Math.abs(d.total))} · {d.bots} bot{d.bots === 1 ? "" : "s"} · {d.agents} agent{d.agents === 1 ? "" : "s"} · {usd(d.invested)} traded{d.open?.length ? ` · holding ${d.open.slice(0, 3).map((o: any) => o.symbol).join(", ")}` : ""}</div>
          </>
        )}
      </div>
      <div className="border-b border-line p-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-faint">Auton's bots ({bots.length})<button onClick={() => openFloat("auton")} className="normal-case text-accent-2 hover:underline">Edit all</button></div>
        <div className="max-h-[120px] space-y-0.5 overflow-y-auto">
          {bots.slice(0, 20).map((b) => (
            <div key={b.id} className="flex items-center gap-1.5 text-[11.5px]"><span className={cx("size-1.5 rounded-full", b.status === "running" ? "bg-up" : "bg-faint")} /><span className="min-w-0 flex-1 truncate">{b.name}</span><span className={cx("num", Number(b.pnl_usd) >= 0 ? "text-up" : "text-down")}>{Number(b.pnl_usd) >= 0 ? "+" : "−"}{usd(Math.abs(Number(b.pnl_usd ?? 0)))}</span></div>
          ))}
          {!bots.length && <p className="text-[11px] text-muted">None yet — Auton makes them while it's on.</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Auton activity</div>
        <ul className="space-y-1.5">
          {(feed.data?.items ?? []).map((i: any) => (
            <li key={i.id} className="rounded-lg border border-line/70 px-2 py-1.5 text-[11.5px]">
              <div className="flex items-center gap-1.5"><span className={cx("rounded px-1 text-[9px] font-bold uppercase", i.kind === "execution" ? "bg-up/15 text-up" : i.kind === "warning" ? "bg-down/15 text-down" : i.kind === "decision" ? "bg-accent/15 text-accent-2" : "bg-panel-2 text-muted")}>{i.kind}</span><span className="ml-auto text-[10px] text-faint">{new Date(i.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}</span></div>
              <div className="mt-0.5 leading-snug">{i.title}</div>
              {i.body && <div className="line-clamp-2 text-[10.5px] text-muted">{i.body}</div>}
            </li>
          ))}
          {!feed.data?.items?.length && <li className="text-[11px] text-muted">Nothing yet. Switch Auton on or press Run now.</li>}
        </ul>
      </div>
    </aside>
  );
}
