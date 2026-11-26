"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, Mic, Paperclip, Clock, Loader2, Zap, Sparkles } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";

/** Talk composer: text (and optional browser speech-to-text), Attach, Paper badge, @Agents, suggestion pills. Sends via the existing prompt API. */
export function TalkComposer({ onSend, busy, suggestions, placeholder, voice, book = "paper", onBook, ai = "merod", onAi }: { onSend: (t: string) => void; busy: boolean; suggestions: string[]; placeholder: string; voice: boolean; book?: "paper" | "live"; onBook?: (b: "paper" | "live") => void; ai?: "merod" | "openai" | "anthropic"; onAi?: (a: "merod" | "openai" | "anthropic") => void }) {
  const { user } = useShell();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const rec = useRef<any>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const agents = useApi<any>(agentsOpen ? "/api/agents" : null);
  const [speech, setSpeech] = useState(false);
  useEffect(() => { setSpeech(typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); }, []);
  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(180, el.scrollHeight)}px`; } }, [text]);

  const send = (t = text) => { const v = t.trim(); if (!v || busy) return; onSend(v); setText(""); };
  function toggleVoice() { // browser speech → text only; nothing is sent until you press send
    if (listening) { rec.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR(); rec.current = r;
    r.lang = navigator.language || "en-US"; r.interimResults = true; r.continuous = false;
    const base = text ? `${text} ` : "";
    r.onresult = (e: any) => setText(base + Array.from(e.results).map((x: any) => x[0].transcript).join(""));
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    setListening(true); r.start();
  }
  return (
    <div className="space-y-2.5">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.slice(0, 4).map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-line-2 bg-panel/60 px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/60 hover:text-text disabled:opacity-50">↳ {s}</button>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-accent/40 bg-panel/80 p-3 shadow-[0_0_40px_-12px_rgba(214,179,122,.35)] focus-within:border-accent/70">
        <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="w-full resize-none bg-transparent px-1 text-[15.5px] outline-none placeholder:font-serif placeholder:italic placeholder:text-faint" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button disabled title="Attachments are coming soon" className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-muted opacity-60"><Paperclip className="size-3.5" /> Attach</button>
          <div role="radiogroup" aria-label="Paper or real money" className="flex h-8 items-center rounded-lg border border-line p-0.5 text-[12.5px]">
            <button role="radio" aria-checked={book === "paper"} onClick={() => onBook?.("paper")}
              className={cx("flex h-full items-center gap-1.5 rounded-md px-2.5", book === "paper" ? "border border-accent/50 bg-accent-soft/40 text-accent-2" : "text-muted hover:text-text")}><Clock className="size-3.5" />Paper</button>
            <button role="radio" aria-checked={book === "live"} title="Trades and bots from your prompts use your real accounts: crypto through your exchange or Merod Wallet, stocks through your broker. Needs the Real money switch and 2FA."
              onClick={() => { if (book !== "live" && !confirm("Use real money for trades and bots from your prompts? Crypto goes through your exchange or Merod Wallet, stocks through your broker.")) return; onBook?.("live"); }}
              className={cx("flex h-full items-center gap-1.5 rounded-md px-2.5", book === "live" ? "border border-down/50 bg-down-soft/40 text-down" : "text-muted hover:text-text")}><Zap className="size-3.5" />Real money / crypto</button>
          </div>
          <div role="radiogroup" aria-label="Which AI answers" className="flex h-8 items-center rounded-lg border border-line p-0.5 text-[12.5px]">
            {([["merod", "Modo"], ["openai", "OpenAI"], ["anthropic", "Claude"]] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={ai === k} onClick={() => onAi?.(k)}
                title={k === "merod" ? "Merod's built-in rules: trades, bots, settings, mimic and market data. No key needed." : `Answers and plans from ${l}, using your own ${l} key (Broker & AI keys).`}
                className={cx("flex h-full items-center gap-1 rounded-md px-2.5", ai === k ? "border border-accent/50 bg-accent-soft/40 text-accent-2" : "text-muted hover:text-text")}><Sparkles className="size-3.5" />{l}</button>
            ))}
          </div>
          {ai !== "merod" && <a href={ai === "openai" ? "https://platform.openai.com/settings/organization/billing/" : "https://console.anthropic.com/settings/billing"} target="_blank" rel="noreferrer noopener" className="text-[11.5px] text-accent-2 underline underline-offset-2 hover:text-text">{ai === "openai" ? "OpenAI" : "Claude"} credits →</a>}
          <div className="relative">
            <button onClick={() => setAgentsOpen((o) => !o)} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-muted hover:text-text"><AtSign className="size-3.5" /> Agents</button>
            {agentsOpen && (
              <div className="absolute bottom-10 left-0 z-30 max-h-64 w-60 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-2xl" onMouseLeave={() => setAgentsOpen(false)}>
                {!agents.data && <p className="px-2 py-2 text-[12px] text-faint">Loading…</p>}
                {agents.data && !(agents.data.agents ?? []).length && <p className="px-2 py-2 text-[12px] text-faint">No agents yet. Try “create 3 agents that trade Solana meme coins”.</p>}
                {(agents.data?.agents ?? []).slice(0, 30).map((a: any) => (
                  <button key={a.id} onClick={() => { setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${a.name} `); setAgentsOpen(false); ta.current?.focus(); }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-panel-2">
                    <span className="truncate">{a.name}</span><span className="shrink-0 text-[10.5px] text-faint">{a.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {listening && <span className="flex h-6 items-end gap-0.5" aria-hidden>{[3, 6, 4, 8, 5, 7, 3].map((h, i) => <span key={i} className="w-0.5 animate-pulse rounded bg-accent-2" style={{ height: h * 2.5, animationDelay: `${i * 90}ms` }} />)}</span>}
            {voice && speech && (
              <button onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Speak"} title="Speech to text (in your browser)"
                className={cx("flex size-10 items-center justify-center rounded-full", listening ? "bg-grad text-bg" : "border border-line-2 text-muted hover:text-text")}><Mic className="size-4" /></button>
            )}
            <button onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send" className="flex size-10 items-center justify-center rounded-full border border-line-2 text-text hover:border-accent/60 disabled:opacity-40">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
