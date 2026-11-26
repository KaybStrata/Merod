"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, Mic, Paperclip, Loader2, Zap, Sparkles, Bot, Brain, FlaskConical, Lightbulb } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";

/** Talk composer: text (and optional browser speech-to-text), Attach, Paper badge, @Agents, suggestion pills. Sends via the existing prompt API. */
export function TalkComposer({ onSend, busy, suggestions, placeholder, voice, book = "paper", onBook, ai = "merod", onAi }: { onSend: (t: string) => void; busy: boolean; suggestions: string[]; placeholder: string; voice: boolean; book?: "paper" | "live"; onBook?: (b: "paper" | "live") => void; ai?: "merod" | "openai" | "anthropic"; onAi?: (a: "merod" | "openai" | "anthropic") => void }) {
  const { user } = useShell();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [suggOpen, setSuggOpen] = useState(false);
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
          {/* Money: where trades and bots from this prompt go */}
          <ControlGroup label="Money">
            <Seg on={book === "paper"} onClick={() => onBook?.("paper")} icon={FlaskConical} title="Practice with virtual funds">Paper</Seg>
            <Seg on={book === "live"} tone="down" icon={Zap} title="Trades and bots from your prompts use your real accounts: crypto through your exchange or Merod Wallet, stocks through your broker. Needs the Real money switch and 2FA."
              onClick={() => { if (book !== "live" && !confirm("Use real money for trades and bots from your prompts? Crypto goes through your exchange or Merod Wallet, stocks through your broker.")) return; onBook?.("live"); }}>Real money</Seg>
          </ControlGroup>
          {/* AI: who answers */}
          <ControlGroup label="AI">
            <Seg on={ai === "merod"} onClick={() => onAi?.("merod")} icon={Sparkles} title="Merod's built-in rules: trades, bots, settings, mimic and market data. No key needed.">Modo</Seg>
            <Seg on={ai === "openai"} onClick={() => onAi?.("openai")} icon={Bot} title="Answers and plans from OpenAI, using your own OpenAI key (Broker & AI keys).">OpenAI</Seg>
            <Seg on={ai === "anthropic"} onClick={() => onAi?.("anthropic")} icon={Brain} title="Answers and plans from Claude, using your own Claude key (Broker & AI keys).">Claude</Seg>
          </ControlGroup>
          {ai !== "merod" && <a href={ai === "openai" ? "https://platform.openai.com/settings/organization/billing/" : "https://console.anthropic.com/settings/billing"} target="_blank" rel="noreferrer noopener" className="text-[11px] text-accent-2 underline underline-offset-2 hover:text-text">{ai === "openai" ? "OpenAI" : "Claude"} credits →</a>}
          <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
          {/* Tools */}
          <div className="relative">
            <button onClick={() => setSuggOpen((o) => !o)} aria-expanded={suggOpen} className={cx("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]", suggOpen ? "border-accent/50 text-accent-2" : "border-line text-muted hover:text-text")}><Lightbulb className="size-3.5" /> Suggestions</button>
            {suggOpen && (
              <div className="absolute bottom-10 left-0 z-30 max-h-72 w-80 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-2xl" onMouseLeave={() => setSuggOpen(false)}>
                {SUGGESTION_GROUPS.map(([group, items]) => (
                  <div key={group} className="mb-1">
                    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{group}</div>
                    {(group === "For you" ? [...new Set([...suggestions, ...items])].slice(0, 6) : items).map((s) => (
                      <button key={s} onClick={() => { setText(s); setSuggOpen(false); ta.current?.focus(); }} className="block w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-panel-2">{s}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button disabled title="Attachments are coming soon" className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-muted opacity-50"><Paperclip className="size-3.5" /> Attach</button>
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

/** Ready-made prompts for the Suggestions menu, grouped by what they do. */
const SUGGESTION_GROUPS: [string, string[]][] = [
  ["For you", ["How is my portfolio doing?", "What moved my portfolio today?"]],
  ["Trade", ["Buy $100 of SOL", "Sell 25% of my biggest winner", "Buy $500 of NVDA if it dips 3%, take profit at 8%"]],
  ["Bots & agents", ["Pick the top 20 Solana meme coin gainers, buy $10 each, sell at 2% profit, repeat", "Create 3 agents that trade Solana meme coins", "Make a bot that buys ETH at a 3% dip and sells at 5% profit"]],
  ["Mimic", ["Mimic the top 50 stock and crypto traders this week", "Mimic the top ROI earner for Solana meme coins this week"]],
  ["Settings", ["Turn off risk flagging for all bots", "Turn Modo Autopilot on", "Risk level 80, per trade $50, take profit 10%, stop loss 3%", "Open purchase history"]],
];

/** A small labelled group of segmented buttons ("Money", "AI"). */
function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex h-8 items-center gap-0.5 rounded-lg border border-line bg-bg/40 p-0.5 text-[12px]">{children}</div>
    </div>
  );
}

/** One option inside a ControlGroup. */
function Seg({ on, onClick, icon: Icon, title, tone, children }: { on: boolean; onClick: () => void; icon: any; title?: string; tone?: "down"; children: React.ReactNode }) {
  return (
    <button role="radio" aria-checked={on} onClick={onClick} title={title}
      className={cx("flex h-full items-center gap-1.5 rounded-md px-2.5 transition-colors", on ? (tone === "down" ? "bg-down-soft/60 text-down ring-1 ring-down/40" : "bg-accent-soft/60 text-accent-2 ring-1 ring-accent/40") : "text-muted hover:text-text")}>
      <Icon className="size-3.5" />{children}
    </button>
  );
}
