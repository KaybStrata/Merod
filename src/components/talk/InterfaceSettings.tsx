"use client";
import { useEffect, useState } from "react";
import { Sparkles, Pause, ShieldCheck, ScrollText, ArrowUpRight, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { Toggle, cx, useToast } from "@/components/ui";

type Prefs = { showSwitch: boolean; digest: boolean; voice: boolean; widgets: string[] };
const WIDGETS: { id: string; label: string; sub: string }[] = [
  { id: "chart", label: "Charts", sub: "Price, P&L and limit lines" }, { id: "plan", label: "Plans", sub: "Checked plans with Approve" },
  { id: "alert", label: "Alerts", sub: "Parsed rules, one-tap create" }, { id: "agents", label: "Agent controls", sub: "Agent status at a glance" },
  { id: "portfolio", label: "Portfolio", sub: "Equity, allocation, risk used" },
];

/** Settings › Interface: Classic | Talk preferences. Saved through the authenticated settings route (human session only). */
export function InterfaceSettings() {
  const { talk, refreshTalk, setMode } = useShell();
  const toast = useToast();
  const [def, setDef] = useState<"classic" | "talk" | "last">("classic");
  const [p, setP] = useState<Prefs>({ showSwitch: true, digest: true, voice: false, widgets: ["chart", "plan", "alert", "agents", "portfolio"] });
  const [saved, setSaved] = useState(true);
  useEffect(() => { if (talk) { setDef(talk.uiModeDefault); setP(talk.talkPrefs); } }, [talk]);
  async function save(nextDef = def, next = p) {
    try {
      await api("/api/settings", { method: "PATCH", json: { section: "interface", values: { ui_mode_default: nextDef, talk_prefs: next } } });
      setSaved(true); refreshTalk();
    } catch (e: any) { toast(e.message, "down"); }
  }
  const upd = (n: Partial<Prefs>) => { const next = { ...p, ...n }; setP(next); setSaved(false); save(def, next); };
  const voiceSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  return (
    <div className="space-y-4">
      <div className="surface flex flex-wrap items-center gap-4 rounded-2xl border border-accent/30 p-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-grad text-bg"><Sparkles className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Talk mode is optional. Classic stays exactly as it is.</div>
          <p className="mt-0.5 text-[12.5px] text-muted">Talk turns Merod into a calm conversation: ask, approve and monitor with plans, charts and alerts rendered inline. Every action still runs through the same preview, risk checks, approval and audit log.</p>
        </div>
        <button onClick={() => setMode("talk")} className="flex h-9 items-center gap-1.5 rounded-lg border border-line-2 px-3 text-[13px] hover:border-accent/60">Preview Talk <ArrowUpRight className="size-3.5" /></button>
      </div>

      <div className="surface rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[14px] font-semibold">Interface</span>
          <span className="text-[11.5px] text-faint">{saved ? "Saved · synced to all devices" : "Saving…"}</span>
        </div>
        <Row title="Default mode" sub="What Merod opens in when you start a new session">
          <div role="radiogroup" aria-label="Default mode" className="flex rounded-lg border border-line bg-panel/70 p-0.5">
            {([["classic", "Classic"], ["talk", "Talk"], ["last", "Remember last"]] as const).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={def === v} onClick={() => { setDef(v); setSaved(false); save(v, p); }}
                className={cx("flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium", def === v ? "border border-accent/50 bg-accent-soft text-text" : "text-muted hover:text-text")}>
                {v === "talk" && <Sparkles className="size-3" />}{l}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Show Talk switch in top bar" sub="The Classic | Talk control next to the Paper badge. ⌘ . works even when hidden.">
          <Toggle checked={p.showSwitch} onChange={(v: boolean) => upd({ showSwitch: v })} />
        </Row>
        <Row title="Open Talk mode with a digest" sub="Talk starts with a summary of fills, agent actions and alerts since your last visit">
          <Toggle checked={p.digest} onChange={(v: boolean) => upd({ digest: v })} />
        </Row>
        <Row title="Voice input" sub={voiceSupported ? "Speech to text in your browser. Text only: nothing is sent until you press send." : "Your browser doesn't support speech to text."}>
          <Toggle checked={p.voice} onChange={(v: boolean) => upd({ voice: v })} />
        </Row>
        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <div><div className="text-[13.5px] font-medium">Widgets Merod may show</div><div className="text-[12px] text-muted">Interactive cards inside replies. Anything that trades still needs your approval.</div></div>
            <span className="text-[11.5px] text-faint">{p.widgets.length} of {WIDGETS.length} on</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {WIDGETS.map((w) => {
              const on = p.widgets.includes(w.id);
              return (
                <button key={w.id} onClick={() => upd({ widgets: on ? p.widgets.filter((x) => x !== w.id) : [...p.widgets, w.id] })} aria-pressed={on}
                  className={cx("flex items-start gap-2 rounded-xl border p-2.5 text-left", on ? "border-accent/50 bg-accent-soft/30" : "border-line hover:border-line-2")}>
                  <span className={cx("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent text-bg" : "border-line-2")}>{on && <Check className="size-3" />}</span>
                  <span><span className="block text-[13px] font-medium">{w.label}</span><span className="block text-[11px] text-muted">{w.sub}</span></span>
                </button>
              );
            })}
          </div>
        </div>
        <Row title="Keyboard shortcuts" sub="Same in both modes">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            <span><kbd className="rounded border border-line-2 px-1.5">⌘ .</kbd> Toggle Classic ⇄ Talk</span>
            <span><kbd className="rounded border border-line-2 px-1.5">⌘ K</kbd> New conversation (Talk)</span>
          </span>
        </Row>
      </div>

      <div className="surface grid rounded-2xl sm:grid-cols-3">
        {[[Pause, "Pause everything", "Always visible, in both modes. It's the same emergency stop."], [ShieldCheck, "Same approvals", "Talk can't skip previews, risk checks or your limits."], [ScrollText, "Audited either way", "Prompts from both modes land in the same hash-chained log."]].map(([I, t, s]: any, i) => (
          <div key={t} className={cx("flex gap-3 p-4", i > 0 && "sm:border-l sm:border-line")}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-accent-2"><I className="size-4" /></span>
            <div><div className="text-[13.5px] font-semibold">{t}</div><div className="text-[12px] text-muted">{s}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 first:border-t-0">
      <div className="min-w-0"><div className="text-[13.5px] font-medium">{title}</div><div className="text-[12px] text-muted">{sub}</div></div>
      {children}
    </div>
  );
}
