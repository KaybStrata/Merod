"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowUp, ChevronDown, ChevronUp, Maximize2, Minimize2, Loader2, X, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { cx } from "@/components/ui";
import { useShell } from "./context";
import { PlanCard } from "./PlanCard";

/** Floating natural-language prompt bar, present on every screen. Knows which asset is on screen. */
export function PromptBar({ leftCollapsed = false, railOpen = true }: { leftCollapsed?: boolean; railOpen?: boolean }) {
  const { screenAsset, promptRequest } = useShell();
  const [text, setText] = useState("");
  /** open = normal panel above the box · min = collapsed to a slim bar · full = large centered panel */
  const [view, setView] = useState<"open" | "min" | "full">("open");
  const setOpen = (o: boolean) => setView(o ? "open" : "min");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (promptRequest) { setText(promptRequest.text); setOpen(true); inputRef.current?.focus(); } }, [promptRequest]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView((v) => (v === "full" ? "open" : v));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // Other prompt boxes (top search "Ask Merod", Home composer) hand their text to this conversation.
  useEffect(() => {
    const h = (e: Event) => { const t = (e as CustomEvent).detail; if (typeof t === "string" && t.trim()) send(t); };
    window.addEventListener("merod-prompt", h);
    return () => window.removeEventListener("merod-prompt", h);
  });

  /** X: close the conversation entirely; the next prompt starts a fresh one. */
  const close = () => { setMessages([]); setConversationId(null); setNote(null); setView("open"); };
  // Auto-grow the input from one line up to ~6 lines.
  useEffect(() => { const el = inputRef.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 150)}px`; }, [text]);
  const hasChat = messages.length > 0;

  async function send(t = text) {
    const value = t.trim();
    if (!value || busy) return;
    setBusy(true); setView((v) => (v === "min" ? "open" : v)); setText("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: value }]);
    try {
      const r = await api("/api/ai/prompt", { method: "POST", json: { text: value, conversationId, screenAssetId: screenAsset?.id ?? null } });
      setConversationId(r.conversationId);
      setNote(r.fallbackReason);
      setMessages((m) => [...m, ...(Array.isArray(r.messages) && r.messages.length ? r.messages : [r.message])]);
    } catch (e: any) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: e.message, status: "error" }]);
    } finally { setBusy(false); }
  }

  return (
    <div className={cx("pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3", leftCollapsed ? "lg:pl-3" : "lg:pl-[236px]", railOpen ? "xl:pr-[332px]" : "xl:pr-3")}>
      <div className="pointer-events-auto w-full max-w-[640px]">
        {hasChat && view === "min" && (
          <button onClick={() => setView("open")} className="fade-up mb-1.5 flex w-full items-center justify-between rounded-xl border border-line bg-panel/95 px-3 py-1.5 text-xs text-muted shadow-lg backdrop-blur hover:text-text">
            <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-accent-2" /> Merod AI · {messages.length} message{messages.length > 1 ? "s" : ""}{busy && " · thinking…"}</span>
            <span className="flex items-center gap-1"><ChevronUp className="size-4" /><span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); close(); }} className="rounded p-0.5 hover:text-down" title="Close"><X className="size-3.5" /></span></span>
          </button>
        )}
        {hasChat && view !== "min" && (
          <>
          {view === "full" && <div className="pointer-events-auto fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={() => setView("open")} />}
          <div className={cx("fade-up flex flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-2xl backdrop-blur",
            view === "full" ? "fixed inset-x-3 bottom-24 top-16 z-50 mx-auto max-w-[900px] sm:inset-x-8" : "mb-2")}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs text-muted">
              <span className="flex min-w-0 items-center gap-1.5"><Sparkles className="size-3.5 shrink-0 text-accent-2" /> <span className="shrink-0">Merod AI</span> {note && <span className="truncate text-warn">· {note}</span>}</span>
              <span className="flex shrink-0 items-center gap-0.5">
                <Link href={conversationId ? `/ai?c=${conversationId}` : "/ai"} className="rounded p-1 hover:text-text" title="Open full prompt history"><ExternalLink className="size-3.5" /></Link>
                <button onClick={() => setView(view === "full" ? "open" : "full")} className="rounded p-1 hover:text-text" title={view === "full" ? "Exit full screen" : "Full screen"}>
                  {view === "full" ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
                <button onClick={() => setView("min")} className="rounded p-1 hover:text-text" title="Minimize"><ChevronDown className="size-4" /></button>
                <button onClick={close} className="rounded p-1 hover:text-down" title="Close"><X className="size-4" /></button>
              </span>
            </div>
            <div ref={listRef} className={cx("space-y-3 overflow-y-auto px-4 py-3", view === "full" ? "flex-1" : "max-h-[45vh]")}>
              {messages.map((m) => (
                <div key={m.id} className={cx("text-sm", m.role === "user" ? "ml-auto w-fit max-w-[85%] rounded-xl rounded-br-md bg-accent px-3 py-1.5 text-white" : "max-w-full")}>
                  {m.role === "user" ? m.content : (
                    <div className={cx(m.status === "error" && "text-down")}>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      <PlanCard message={m} onChip={(s) => send(s)} />
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Interpreting and validating…</div>}
            </div>
          </div>
          </>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(); }}
          className="relative z-50 flex items-end gap-2 rounded-2xl border border-line-2 bg-panel/95 p-1.5 shadow-[0_10px_40px_rgba(0,0,0,.45)] backdrop-blur focus-within:border-accent">
          <div className="min-w-0 flex-1">
            <textarea ref={inputRef} rows={1} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label="Prompt" placeholder="What would you like to do today?"
              className="block max-h-[150px] min-h-[36px] w-full resize-none bg-transparent px-2.5 py-2 text-[14px] leading-5 outline-none placeholder:text-faint" />
          </div>
          <button type="submit" disabled={!text.trim() || busy} className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-grad text-white disabled:opacity-40" aria-label="Send">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
