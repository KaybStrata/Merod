"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Play, Loader2, Trash2, PanelRightOpen, PanelRightClose, Settings2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, usePageTitle } from "@/components/shell/context";
import { TalkThread } from "@/components/talk/TalkThread";
import { TalkComposer } from "@/components/talk/TalkComposer";
import { AutonPnlCard } from "@/components/auton/AutonPnl";
import { AutoModesBar } from "@/components/AutoModesBar";
import { SkillText } from "@/components/SkillText";
import { explainActivity } from "@/lib/explainActivity";
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
      {side && <AutonActivity bots={data?.bots ?? []} onAuton={send} />}
    </div>
  );
}

/** Auton's own activity bar: its P&L (separate from everything else) with period comparison, its feed and its bots. */
function AutonActivity({ bots, onAuton }: { bots: any[]; onAuton: (t: string) => void }) {
  const feed = useApi<any>("/api/live-stream?filter=auton&limit=60", { refreshMs: 5_000 });
  return (
    <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel/30 md:flex">
      <AutonControls onAuton={onAuton} />
      <AutonPnlCard className="border-b border-line p-3" />
      <div className="border-b border-line p-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-faint">Auton's bots ({bots.length})<button onClick={() => openFloat("auton")} className="normal-case text-accent-2 hover:underline">Edit all</button></div>
        <div className="max-h-[120px] space-y-0.5 overflow-y-auto">
          {bots.slice(0, 20).map((b) => (
            <div key={b.id} className="flex items-center gap-1.5 text-[11.5px]"><span className={cx("size-1.5 rounded-full", b.status === "running" ? "bg-up" : "bg-faint")} /><span className="min-w-0 flex-1 truncate">{b.name}</span><span className={cx("num", Number(b.pnl_usd) >= 0 ? "text-up" : "text-down")}>{Number(b.pnl_usd) >= 0 ? "+" : "−"}{usd(Math.abs(Number(b.pnl_usd ?? 0)))}</span></div>
          ))}
          {!bots.length && <p className="text-[11px] text-muted">None yet — Auton makes them while it's on.</p>}
        </div>
      </div>
      <div className="p-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Auton activity</div>
        <ul className="space-y-1.5">
          {(feed.data?.items ?? []).map((i: any) => (
            <li key={i.id} title={(() => { const e = explainActivity(i); return [e.headline, ...e.lines].join("\n\n"); })()} className="cursor-help rounded-lg border border-line/70 px-2 py-1.5 text-[11.5px]">
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

/**
 * Auton controls (top of the right bar): the four auto switches, a mini prompt box that talks to Auton or adds a
 * skill/point, and your skills & points (on/off, edit, delete). Skills and points only exist when you add them.
 */
function AutonControls({ onAuton }: { onAuton: (t: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"auton" | "skill" | "point">("auton");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sk = useApi<any>("/api/skills", { refreshMs: 30_000 });
  const rows: any[] = sk.data?.skills ?? [];
  async function submit() {
    const t = text.trim();
    if (!t) return;
    if (mode === "auton") { onAuton(t); setText(""); return; }
    setBusy(true);
    try {
      const r: any = await api("/api/skills", { method: "POST", json: { instructions: t, kind: mode, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      toast(`${mode === "point" ? "Point" : "Skill"} “${r.skill.name}” added and on${r.enforced?.length ? ` · enforces: ${r.enforced.join("; ")}` : ""}`, "up");
      setText(""); sk.refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const act = async (f: () => Promise<any>) => { try { await f(); sk.refresh(); } catch (e: any) { toast(e.message, "down"); } };
  return (
    <div className="space-y-2 border-b border-line p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Auto switches</div>
      <AutoModesBar compact />
      <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Quick prompt</div>
      <div className="flex rounded-md border border-line p-0.5 text-[11px]">
        {([["auton", "Auton"], ["skill", "Skill"], ["point", "Point"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} className={cx("flex-1 rounded py-0.5", mode === k ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>{l}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex items-end gap-1">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
          placeholder={mode === "auton" ? "Customize Auton: “budget $500”, “every 10 seconds”, “focus on SOL memes”, “$50 per trade”…" : mode === "skill" ? "New skill, e.g. “always use a 5% stop loss”" : "New point, e.g. “no buys until Friday”"}
          className="min-w-0 flex-1 resize-none rounded-md border border-line bg-bg-2 px-2 py-1 text-[11.5px] outline-none focus:border-accent/60" />
        <button disabled={busy || !text.trim()} className="shrink-0 rounded-md bg-grad px-2 py-1.5 text-[11px] font-semibold text-bg disabled:opacity-50">{busy ? <Loader2 className="size-3 animate-spin" /> : mode === "auton" ? "Send" : "Add"}</button>
      </form>
      <div className="flex items-center pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Skills & points ({rows.length})
        {rows.some((r) => r.active) && <button onClick={() => act(() => Promise.all(rows.filter((r) => r.active).map((r) => api("/api/skills", { method: "PATCH", json: { kind: "skill", id: r.id, active: false } }))))} className="ml-auto normal-case text-muted hover:text-down">All off</button>}
      </div>
      {!rows.length && <p className="text-[11px] text-muted">None. Add one above when you want one — nothing is added on its own.</p>}
      <div className="max-h-[200px] space-y-1 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="flex items-start gap-1.5 rounded-md border border-line/70 px-1.5 py-1">
            <button role="switch" aria-checked={r.active} aria-label={`${r.name} on/off`} onClick={() => act(() => api("/api/skills", { method: "PATCH", json: { kind: "skill", id: r.id, active: !r.active } }))}
              className={cx("relative mt-0.5 h-3.5 w-6 shrink-0 rounded-full transition", r.active ? "bg-accent" : "bg-panel-2 ring-1 ring-line")}>
              <span className={cx("absolute top-[2px] size-2.5 rounded-full bg-white transition-all", r.active ? "left-[12px]" : "left-[2px]")} />
            </button>
            <SkillText s={r} onSaved={sk.refresh} title={<><span className={cx("mr-1 rounded px-1 text-[9px] font-bold uppercase", r.kind === "point" ? "bg-rose-400/15 text-rose-300" : "bg-amber-300/15 text-amber-200")}>{r.kind ?? "skill"}</span>{r.name}</>} />
            <button onClick={() => { if (confirm(`Delete “${r.name}”?`)) void act(() => api(`/api/skills?id=${r.id}`, { method: "DELETE" })); }} className="mt-0.5 text-faint hover:text-down" aria-label="Delete"><Trash2 className="size-3" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
