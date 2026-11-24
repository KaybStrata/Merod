"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowUp, ChevronDown, Maximize2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cx } from "@/components/ui";
import { useShell } from "./context";
import { PlanCard } from "./PlanCard";

/** Floating natural-language prompt bar, present on every screen. Knows which asset is on screen. */
export function PromptBar({ leftCollapsed = false, railOpen = true }: { leftCollapsed?: boolean; railOpen?: boolean }) {
  const { screenAsset, promptRequest } = useShell();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (promptRequest) { setText(promptRequest.text); setOpen(true); inputRef.current?.focus(); } }, [promptRequest]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); inputRef.current?.focus(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  async function send(t = text) {
    const value = t.trim();
    if (!value || busy) return;
    setBusy(true); setOpen(true); setText("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: value }]);
    try {
      const r = await api("/api/ai/prompt", { method: "POST", json: { text: value, conversationId, screenAssetId: screenAsset?.id ?? null } });
      setConversationId(r.conversationId);
      setNote(r.fallbackReason);
      setMessages((m) => [...m, r.message]);
    } catch (e: any) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: e.message, status: "error" }]);
    } finally { setBusy(false); }
  }

  return (
    <div className={cx("pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3", leftCollapsed ? "lg:pl-3" : "lg:pl-[252px]", railOpen ? "xl:pr-[300px]" : "xl:pr-3")}>
      <div className="pointer-events-auto w-full max-w-[640px]">
        {open && messages.length > 0 && (
          <div className="fade-up mb-2 overflow-hidden rounded-xl border border-line bg-panel/95 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
              <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-accent-2" /> Merod AI {note && <span className="text-warn">· {note}</span>}</span>
              <span className="flex items-center gap-1">
                <Link href={conversationId ? `/ai?c=${conversationId}` : "/ai"} className="rounded p-1 hover:text-text" title="Open in AI Trade"><Maximize2 className="size-3.5" /></Link>
                <button onClick={() => setOpen(false)} className="rounded p-1 hover:text-text" title="Minimize"><ChevronDown className="size-4" /></button>
              </span>
            </div>
            <div ref={listRef} className="max-h-[55vh] space-y-3 overflow-y-auto px-4 py-3">
              {messages.map((m) => (
                <div key={m.id} className={cx("text-sm", m.role === "user" ? "ml-auto max-w-[85%] rounded-xl rounded-br-md bg-accent px-3.5 py-2 text-white" : "max-w-full")}>
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
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-end gap-2 rounded-2xl border border-line-2 bg-panel/95 p-3 shadow-[0_10px_40px_rgba(0,0,0,.45)] backdrop-blur focus-within:border-accent">
          <div className="min-w-0 flex-1">
            <textarea ref={inputRef} rows={2} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => messages.length && setOpen(true)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label="Prompt"
              className="block max-h-[200px] min-h-[64px] w-full resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none" />
          </div>
          <button type="submit" disabled={!text.trim() || busy} className="flex size-[44px] shrink-0 items-center justify-center rounded-xl bg-grad text-white disabled:opacity-40" aria-label="Send">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
