"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiNote } from "@/components/talk/AiNote";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useRealtime, useShell, usePageTitle, TALK_FLAG } from "@/components/shell/context";
import { Digest, type DigestT } from "@/components/talk/Digest";
import { TalkThread } from "@/components/talk/TalkThread";
import { TalkComposer } from "@/components/talk/TalkComposer";
import { knownWidgets } from "@/components/talk/widgets/Widgets";

export default function TalkPage() {
  return <Suspense fallback={null}><Talk /></Suspense>;
}

/** Talk mode: a calm full-screen conversation. Same prompt API, same plans, same engine and risk checks as Classic. */
function Talk() {
  const { talk } = useShell();
  const router = useRouter();
  const sp = useSearchParams();
  const c = sp.get("c");
  const fresh = sp.get("new");
  const [convId, setConvId] = useState<string | null>(c);
  const [title, setTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestT | null>(null);
  // Paper or real money for trades and bots from Talk prompts (remembered in this browser).
  const [book, setBookState] = useState<"paper" | "live">("paper");
  useEffect(() => { try { if (localStorage.getItem("merod-talk-book") === "live") setBookState("live"); } catch { /* ignore */ } }, []);
  const setBook = (b: "paper" | "live") => { setBookState(b); try { localStorage.setItem("merod-talk-book", b); } catch { /* ignore */ } };
  // Talk switch: bots, agents and trades post what they do into this conversation (remembered in this browser).
  const [narrate, setNarrateState] = useState(false);
  useEffect(() => { try { setNarrateState(localStorage.getItem("merod-talk-narrate") === "1"); } catch { /* ignore */ } }, []);
  const setNarrate = (on: boolean) => { setNarrateState(on); try { localStorage.setItem("merod-talk-narrate", on ? "1" : "0"); } catch { /* ignore */ }
    setMessages((m) => [...m, { id: `n-sys-${Date.now()}`, role: "assistant", narration: true, content: on ? "Talk is on for this tab: the trades, bots, agents and Auton started from this tab will tell you here what they do, as it happens. Other tabs narrate their own." : "Talk is off. Everything is still in Activity." }]); };
  const narrSince = useRef(0);
  // Each tab narrates only its own activity: what that conversation started (its trades, bots, agents, Auton).
  const narrConv = useRef<string | null>(null);
  useEffect(() => {
    if (!narrate || !convId) return;
    let live = true;
    narrSince.current = Date.now();
    narrConv.current = convId;
    const pull = async () => {
      try {
        const c = narrConv.current;
        const r: any = await api(`/api/live-stream?since=${narrSince.current - 1000}&conv=${c}`);
        if (!live || narrConv.current !== c) return;
        narrSince.current = r.now;
        // Meaningful steps only: trades, decisions, warnings — not the per-tick "watching" lines.
        const items = (r.items ?? []).filter((i: any) => ["execution", "decision", "warning"].includes(i.kind) && i.source !== "merod").reverse();
        if (!items.length) return;
        setMessages((m) => {
          const seen = new Set(m.map((x: any) => x.id));
          const add = items.filter((i: any) => !seen.has(`n-${i.id}`)).slice(-8).map((i: any) => ({
            id: `n-${i.id}`, role: "assistant", narration: true, created_at: i.at,
            content: `${i.coin?.symbol ? `${i.coin.symbol} · ` : ""}${i.actor}: ${i.title}${i.pnl != null ? ` (${i.pnl >= 0 ? "+" : "−"}$${Math.abs(i.pnl).toFixed(2)})` : ""}`,
          }));
          if (add.length && talk?.talkPrefs.voice && typeof window !== "undefined" && "speechSynthesis" in window) {
            for (const a of add.slice(-2)) window.speechSynthesis.speak(new SpeechSynthesisUtterance(a.content.replace(/\$/g, " dollars ").slice(0, 200)));
          }
          return add.length ? [...m, ...add] : m;
        });
      } catch { /* try again */ }
    };
    const t = setInterval(pull, 5000);
    return () => { live = false; clearInterval(t); };
  }, [narrate, convId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Which AI answers Talk prompts (remembered in this browser). Modo = built-in rules, no key needed.
  const [ai, setAiState] = useState<"merod" | "openai" | "anthropic" | "auton">("merod");
  useEffect(() => { try { const v = localStorage.getItem("merod-talk-ai"); if (v === "openai" || v === "anthropic" || v === "merod" || v === "auton") setAiState(v); } catch { /* ignore */ } }, []);
  const setAi = (v: "merod" | "openai" | "anthropic" | "auton") => { setAiState(v); try { localStorage.setItem("merod-talk-ai", v); } catch { /* ignore */ } };
  const held = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  usePageTitle({ title: title ?? (convId ? "Conversation" : "New conversation"), section: new Date().toLocaleDateString([], { weekday: "long" }) }, [title, convId]);

  const loadConversation = useCallback(async (id: string) => {
    const r: any = await api(`/api/ai/conversations?c=${id}`);
    setMessages(r.messages ?? []);
    held.current = id;
  }, []);
  // URL → conversation (skip the reload when we already hold it, e.g. right after sending the first message).
  useEffect(() => {
    if (c) { setConvId(c); if (held.current !== c) loadConversation(c).catch(() => setMessages([])); }
    else { setConvId(null); setMessages([]); setTitle(null); held.current = null; }
  }, [c, fresh, loadConversation]);
  useEffect(() => {
    if (!convId) return;
    api<any>("/api/ai/conversations").then((r) => setTitle(r.conversations?.find((x: any) => x.id === convId)?.title ?? null)).catch(() => {});
  }, [convId]);
  // "While you were away" digest: fetched once per visit (it marks events as seen).
  const wantDigest = talk ? talk.talkPrefs.digest !== false : true;
  useEffect(() => { if (wantDigest && !digest) api<DigestT>("/api/talk/digest").then(setDigest).catch(() => {}); }, [wantDigest]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, busy]);

  // Live updates: fills / agent / alert events refresh the conversation so plan statuses and widgets stay current.
  const kick = useRef(0);
  useRealtime((e) => {
    if (!["fill", "order", "agent", "alert", "notification", "auto"].includes(e.type) || Date.now() - kick.current < 1500) return;
    kick.current = Date.now();
    if (convId) loadConversation(convId).catch(() => {});
  });

  async function send(text: string, attachmentIds?: string[]) {
    setBusy(true); setNote(null);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: `${text}${attachmentIds?.length ? `${text ? "\n" : ""}📎 ${attachmentIds.length} file${attachmentIds.length > 1 ? "s" : ""} attached` : ""}` }]);
    try {
      const r: any = await api("/api/ai/prompt", { method: "POST", json: { text, conversationId: convId, book, provider: ai, attachmentIds, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      const replies = Array.isArray(r.messages) && r.messages.length ? r.messages : [r.message];
      setMessages((m) => [...m, ...replies]);
      setNote(r.fallbackReason ?? null);
      if (r.conversationId && r.conversationId !== convId) {
        held.current = r.conversationId; setConvId(r.conversationId); setTitle((text || "Attached files").slice(0, 60));
        router.replace(`/talk?c=${r.conversationId}`);
      }
      window.dispatchEvent(new Event("merod-talk-refresh"));
    } catch (e: any) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: e.message, status: "error" }]);
    } finally { setBusy(false); }
  }

  const suggestions = useMemo(() => {
    const lastMerod = [...messages].reverse().find((m) => m.role === "assistant");
    const chart = knownWidgets(lastMerod?.plan?.widgets).find((w) => w.kind === "chart") as any;
    const sym = chart?.symbol;
    const base = ["How is my portfolio doing?", "How are my agents doing?"];
    if (sym) return [`Buy $100 of ${sym}`, `Alert me if ${sym} drops 5%`, `Why is ${sym} moving?`, ...base];
    if (!messages.length) return ["How is my portfolio doing?", "Buy $500 of SOL", "Alert me if BTC drops 5%", "Create 3 agents that trade Solana meme coins"];
    return [...base, "Show my open orders", "Pause all my bots"];
  }, [messages]);

  if (!TALK_FLAG) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        <div>Talk mode isn&apos;t switched on for this deployment. <Link href="/" className="text-accent-2 underline">Back to Merod</Link></div>
      </div>
    );
  }
  const allowed = talk?.talkPrefs.widgets;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] space-y-6 px-4 pb-6 pt-6 sm:px-6">
          {!convId && digest && <Digest d={digest} />}
          {!convId && !digest && wantDigest && <div className="h-40 animate-pulse rounded-2xl bg-panel/40" />}
          {!convId && !wantDigest && !messages.length && (
            <div className="pt-16 text-center"><h2 className="text-[24px] font-semibold">What should Merod <span className="serif-accent text-accent-2">do</span>?</h2><p className="mt-1 text-sm text-muted">Ask, approve and monitor, all in one conversation.</p></div>
          )}
          <TalkThread messages={messages} onSend={send} onDone={() => convId && loadConversation(convId)} allowed={allowed} />
          {busy && <div className="flex items-center gap-2 pl-12 text-[13px] text-muted"><span className="size-1.5 animate-pulse rounded-full bg-accent-2" /> Merod is thinking…</div>}
          <AiNote note={note} className="pl-12 text-[11.5px] text-faint" />
          <div ref={bottom} />
        </div>
      </div>
      <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
        <div className="mx-auto w-full max-w-[860px]">
          <TalkComposer onSend={send} busy={busy} suggestions={suggestions} voice={!!talk?.talkPrefs.voice} book={book} onBook={setBook} ai={ai} onAi={setAi} narrate={narrate} onNarrate={setNarrate}
            placeholder={messages.length ? "Reply, or ask Merod anything…" : "Ask Merod anything, or just talk…"} />
          <p className="mt-1.5 text-center text-[10.5px] text-faint">Every plan runs through the same preview, risk checks, approval and audit log as Classic mode.</p>
        </div>
      </div>
    </div>
  );
}
