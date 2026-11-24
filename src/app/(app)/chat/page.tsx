"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Reply, Trash2, Flag, X, VolumeX, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, cx, useToast } from "@/components/ui";

type Msg = { id: number; body: string; reply_to: number | null; created_at: string; user_id: string; handle: string; display_name: string; avatar_color: string | null; role: string; reply_body: string | null; reply_handle: string | null };

const time = (d: string) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (d: string) => new Date(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/** Highlights @mentions and $TICKERS; everything else is plain text (never HTML). */
function Body({ text, me }: { text: string; me: string }) {
  const parts = text.split(/(@[a-zA-Z0-9_]{2,30}|\$[A-Z]{1,10}\b)/g);
  return <>{parts.map((p, i) => p.startsWith("@") ? <span key={i} className={cx("font-medium", p.slice(1).toLowerCase() === me.toLowerCase() ? "rounded bg-accent-soft px-0.5 text-accent-2" : "text-accent-2")}>{p}</span>
    : /^\$[A-Z]/.test(p) ? <span key={i} className="font-medium text-up">{p}</span> : <span key={i}>{p}</span>)}</>;
}

/** Community chat: one shared room for every Merod user, live over the realtime socket (polls if offline). */
export default function CommunityChatPage() {
  const { user, connected } = useShell();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [stats, setStats] = useState<{ members: number; today: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [older, setOlder] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<Msg | null>(null);
  const [unseen, setUnseen] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const keepScroll = useRef<number | null>(null);
  const isAdmin = user.role === "admin" || user.role === "super_admin";

  const merge = useCallback((incoming: Msg[]) => setMsgs((cur) => {
    const seen = new Set(cur.map((m) => m.id));
    const add = incoming.filter((m) => !seen.has(m.id));
    return add.length ? [...cur, ...add].sort((a, b) => a.id - b.id).slice(-500) : cur;
  }), []);

  useEffect(() => {
    api<{ messages: Msg[]; stats: any }>("/api/chat").then((r) => { setMsgs(r.messages); setStats(r.stats); setOlder(r.messages.length >= 60); })
      .catch((e) => toast(e.message, "down")).finally(() => setLoading(false));
  }, []); // eslint-disable-line

  // Live: new messages and deletions arrive over the socket.
  useRealtime((e) => {
    if (e.channel !== "chat") return;
    if (e.type === "message") {
      merge([e.payload]);
      if (e.payload.user_id !== user.id) { setStats((st) => st && { ...st, today: st.today + 1 }); if (!atBottom.current) setUnseen((n) => n + 1); }
    }
    if (e.type === "deleted") setMsgs((cur) => cur.filter((m) => m.id !== e.payload.id));
  });
  // Fallback when the realtime socket is down: catch up every 4s.
  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => {
      const last = msgs[msgs.length - 1]?.id;
      if (last) api<{ messages: Msg[] }>(`/api/chat?after=${last}`).then((r) => merge(r.messages)).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [connected, msgs, merge]);

  // Stick to the bottom for new messages unless the reader scrolled up; keep position when loading older ones.
  useLayoutEffect(() => {
    const el = list.current; if (!el) return;
    if (keepScroll.current != null) { el.scrollTop = el.scrollHeight - keepScroll.current; keepScroll.current = null; return; }
    if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const onScroll = () => {
    const el = list.current; if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom.current) setUnseen(0);
  };

  async function loadOlder() {
    const first = msgs[0]?.id; if (!first) return;
    keepScroll.current = list.current ? list.current.scrollHeight - list.current.scrollTop : null;
    const r = await api<{ messages: Msg[] }>(`/api/chat?before=${first}`);
    setOlder(r.messages.length >= 60);
    setMsgs((cur) => [...r.messages.filter((m) => !cur.some((c) => c.id === m.id)), ...cur]);
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api<{ message: Msg }>("/api/chat", { method: "POST", json: { body, replyTo: reply?.id ?? null } });
      atBottom.current = true; merge([r.message]); setText(""); setReply(null); setStats((st) => st && { ...st, today: st.today + 1 });
    } catch (e: any) { toast(e.message, "down"); } finally { setSending(false); }
  }
  async function remove(m: Msg) {
    if (!confirm(m.user_id === user.id ? "Delete your message?" : `Remove this message from @${m.handle}?`)) return;
    try { await api(`/api/chat/${m.id}`, { method: "DELETE" }); setMsgs((cur) => cur.filter((x) => x.id !== m.id)); } catch (e: any) { toast(e.message, "down"); }
  }
  async function report(m: Msg) {
    const reason = prompt(`Report @${m.handle}'s message. What's wrong? (optional)`);
    if (reason === null) return;
    try { await api(`/api/chat/${m.id}/report`, { method: "POST", json: { reason: reason || undefined } }); toast("Reported. An admin will review it.", "neutral"); } catch (e: any) { toast(e.message, "down"); }
  }
  async function mute(m: Msg) {
    const h = prompt(`Mute @${m.handle} for how many hours?`, "24");
    if (!h || !(Number(h) > 0)) return;
    try { await api("/api/chat/mute", { method: "POST", json: { userId: m.user_id, minutes: Math.round(Number(h) * 60) } }); toast(`@${m.handle} muted for ${h}h`, "neutral"); } catch (e: any) { toast(e.message, "down"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><MessagesSquare className="size-6 text-accent-2" /> Community Chat</h1>
          <p className="mt-1 text-sm text-muted">One room for everyone on Merod. Share ideas, ask questions, talk markets.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1", connected ? "bg-up-soft text-up" : "bg-panel-2 text-muted")}>
            <span className={cx("size-1.5 rounded-full", connected ? "bg-up pulse-dot" : "bg-faint")} />{connected ? "Live" : "Reconnecting…"}
          </span>
          {stats && <span className="rounded-full border border-line px-2.5 py-1 text-muted">{stats.members.toLocaleString()} members · {stats.today} messages today</span>}
        </div>
      </div>

      <section className="flex h-[calc(100vh-300px)] min-h-[380px] flex-col overflow-hidden rounded-xl border border-line bg-panel/80">
        <div ref={list} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-4 py-3">
          {older && msgs.length > 0 && <div className="mb-3 text-center"><button onClick={loadOlder} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-text">Load earlier messages</button></div>}
          {loading ? <div className="flex h-full items-center justify-center text-sm text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Loading chat…</div>
            : msgs.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted"><MessagesSquare className="mb-2 size-8 text-faint" />No messages yet. Say hello to the community 👋</div>
            : msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const newDay = !prev || day(prev.created_at) !== day(m.created_at);
              const grouped = !newDay && prev && prev.user_id === m.user_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000 && !m.reply_to;
              const mine = m.user_id === user.id;
              const admin = m.role === "admin" || m.role === "super_admin";
              const color = m.avatar_color || "#38bdf8";
              return (
                <div key={m.id}>
                  {newDay && <div className="my-3 flex items-center gap-3 text-[10px] uppercase tracking-wide text-faint"><span className="h-px flex-1 bg-line" />{day(m.created_at)}<span className="h-px flex-1 bg-line" /></div>}
                  <div className={cx("group relative flex gap-3 rounded-lg px-2 hover:bg-panel-2/50", grouped ? "py-0.5" : "mt-2 py-1")}>
                    <div className="w-8 shrink-0">
                      {!grouped && <Link href={`/social/${m.handle}`} className="flex size-8 items-center justify-center rounded-full text-xs font-semibold" style={{ background: `${color}22`, color }}>{(m.display_name || m.handle).slice(0, 1).toUpperCase()}</Link>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                          <Link href={`/social/${m.handle}`} className="font-semibold text-text hover:underline">{m.display_name || m.handle}</Link>
                          <span className="text-faint">@{m.handle}</span>
                          {admin && <Badge tone="accent">{m.role === "super_admin" ? "owner" : "admin"}</Badge>}
                          {mine && <Badge>you</Badge>}
                          <span className="text-[10px] text-faint">{time(m.created_at)}</span>
                        </div>
                      )}
                      {m.reply_to && (
                        <div className="mt-0.5 truncate border-l-2 border-line-2 pl-2 text-[11px] text-faint">
                          {m.reply_body ? <>↪ @{m.reply_handle}: {m.reply_body}</> : "↪ message deleted"}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text"><Body text={m.body} me={user.handle} /></div>
                    </div>
                    <div className="absolute -top-2 right-2 hidden items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5 shadow-lg group-hover:flex">
                      <button onClick={() => { setReply(m); }} className="rounded p-1 text-muted hover:text-text" title="Reply"><Reply className="size-3.5" /></button>
                      {!mine && <button onClick={() => report(m)} className="rounded p-1 text-muted hover:text-warn" title="Report"><Flag className="size-3.5" /></button>}
                      {isAdmin && !mine && <button onClick={() => mute(m)} className="rounded p-1 text-muted hover:text-warn" title="Mute user"><VolumeX className="size-3.5" /></button>}
                      {(mine || isAdmin) && <button onClick={() => remove(m)} className="rounded p-1 text-muted hover:text-down" title="Delete"><Trash2 className="size-3.5" /></button>}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
        {unseen > 0 && (
          <button onClick={() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; setUnseen(0); }}
            className="mx-auto -mt-10 mb-2 rounded-full bg-grad px-3 py-1 text-xs font-medium text-white shadow-lg">{unseen} new message{unseen > 1 ? "s" : ""} ↓</button>
        )}

        <div className="border-t border-line p-3">
          {reply && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-panel-2 px-3 py-1.5 text-xs text-muted">
              <span className="truncate">Replying to <b className="text-text">@{reply.handle}</b>: {reply.body}</span>
              <button onClick={() => setReply(null)} className="text-faint hover:text-text" aria-label="Cancel reply"><X className="size-3.5" /></button>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} rows={1} maxLength={1000}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message everyone…  (Enter to send, Shift+Enter for a new line)"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-line bg-bg-2 px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent" />
            <button type="submit" disabled={!text.trim() || sending} className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-grad text-white disabled:opacity-40" aria-label="Send">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </form>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-faint"><ShieldCheck className="size-3" /> Be respectful. Nothing here is financial advice. Never share keys, passwords or seed phrases; Merod blocks messages that look like them.</p>
        </div>
      </section>
    </div>
  );
}
