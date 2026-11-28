"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Cpu } from "lucide-react";
import { useShell, TALK_FLAG, type UiMode } from "@/components/shell/context";
import { cx } from "@/components/ui";

const OPTIONS: { m: UiMode; label: string }[] = [{ m: "classic", label: "Classic" }, { m: "talk", label: "Talk" }, { m: "auton", label: "Auton" }];

/**
 * Classic | Talk segmented control (role="radiogroup", arrow keys). Switching is a human-only UI action:
 * the AI can't change modes, settings or limits. Renders nothing when the Talk flag is off or the user hid it.
 */
export function ModeSwitch({ callout = false, force = false }: { callout?: boolean; force?: boolean }) {
  const { mode, setMode, talk } = useShell();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [showCallout, setShowCallout] = useState(false);
  useEffect(() => {
    if (!callout || mode !== "classic") return;
    try { setShowCallout(localStorage.getItem("merod-talk-callout") !== "1"); } catch {}
  }, [callout, mode]);
  if (!TALK_FLAG || !talk?.enabled) return null;
  if (!force && talk.talkPrefs.showSwitch === false) return null;
  const dismiss = () => { setShowCallout(false); try { localStorage.setItem("merod-talk-callout", "1"); } catch {} };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? OPTIONS.length - 1 : (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + OPTIONS.length) % OPTIONS.length;
    refs.current[n]?.focus();
    setMode(OPTIONS[n].m);
  };
  return (
    <div className="relative hidden items-center gap-1.5 sm:flex">
      <div role="radiogroup" aria-label="Interface mode" className="flex items-center rounded-lg border border-line bg-panel/70 p-0.5">
        {OPTIONS.map((o, i) => {
          const on = mode === o.m;
          return (
            <button key={o.m} ref={(el) => { refs.current[i] = el; }} role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
              onClick={() => { setMode(o.m); dismiss(); }} onKeyDown={(e) => onKey(e, i)}
              className={cx("flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium transition-colors", on ? "bg-grad text-bg shadow" : "text-muted hover:text-text")}>
              {o.m === "talk" && <Sparkles className="size-3" />}{o.m === "auton" && <Cpu className="size-3" />}{o.label}
            </button>
          );
        })}
      </div>
      <kbd title="Toggle Classic ⇄ Talk" className="hidden rounded border border-line-2 px-1 py-px text-[10px] text-faint lg:block">⌘ .</kbd>
      {showCallout && (
        <div role="dialog" aria-label="Talk mode" className="fade-up absolute right-0 top-10 z-40 w-[300px] rounded-xl border border-accent/40 bg-panel p-3.5 shadow-2xl">
          <div className="flex items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-grad text-bg"><Sparkles className="size-4" /></span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="rounded border border-accent/40 bg-accent-soft px-1 text-[9.5px] font-bold tracking-wider text-accent-2">NEW</span>Talk mode</div>
              <p className="mt-1 text-[12px] leading-snug text-muted">Run Merod just by <span className="serif-accent text-accent-2">talking</span>: same agents, same risk limits.</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-faint"><kbd className="rounded border border-line-2 px-1">⌘ .</kbd> to switch anytime</span>
            <span className="flex gap-1.5">
              <button onClick={dismiss} className="rounded-md px-2 py-1 text-[12px] text-muted hover:text-text">Later</button>
              <button onClick={() => { dismiss(); setMode("talk"); }} className="rounded-md bg-grad px-2.5 py-1 text-[12px] font-semibold text-bg">Try it</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
