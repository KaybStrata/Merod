"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cx } from "@/components/ui";

/**
 * Suggestions while you type in the prompt box: a faint inline completion (Tab or → to accept) and a short list of
 * accurate full prompts built from your real coins, bots, agents and past prompts (↑/↓ to pick, Enter to use, Esc to hide).
 */
export function useTypeAhead(text: string, setText: (t: string) => void, opts: { disabled?: boolean } = {}) {
  const [list, setList] = useState<string[]>([]);
  const [ghost, setGhost] = useState("");
  const [idx, setIdx] = useState(-1);
  const [hidden, setHidden] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    setHidden(false); setIdx(-1);
    if (opts.disabled || !text.trim() || text.length > 300) { setList([]); setGhost(""); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r: any = await api(`/api/ai/autocomplete?q=${encodeURIComponent(text)}`);
        if (my !== seq.current) return;
        setList(r.suggestions ?? []); setGhost(r.ghost ?? "");
      } catch { /* suggestions are optional */ }
    }, 140);
    return () => clearTimeout(t);
  }, [text, opts.disabled]);

  const open = !hidden && list.length > 0;
  /** Returns true when the key was used by the type-ahead (so the composer shouldn't also act on it). */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const atEnd = el.selectionStart === text.length && el.selectionEnd === text.length;
    if ((e.key === "Tab" || (e.key === "ArrowRight" && atEnd)) && ghost && !hidden) { e.preventDefault(); setText(text + ghost); setGhost(""); return true; }
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % list.length); return true; }
    if (e.key === "ArrowUp" && idx >= 0) { e.preventDefault(); setIdx((i) => (i - 1 + list.length) % list.length); return true; }
    if (e.key === "Enter" && !e.shiftKey && idx >= 0) { e.preventDefault(); setText(list[idx]); setIdx(-1); setHidden(true); return true; }
    if (e.key === "Escape") { setHidden(true); setGhost(""); return true; }
    return false;
  }
  const pick = (s: string) => { setText(s); setHidden(true); setGhost(""); };
  return { list: open ? list : [], ghost: hidden ? "" : ghost, idx, onKeyDown, pick, hide: () => setHidden(true) };
}

/** The faint inline completion, drawn behind a transparent textarea with the same text styles. */
export function GhostText({ text, ghost, className }: { text: string; ghost: string; className?: string }) {
  if (!ghost) return null;
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words", className)}>
      <span className="invisible">{text}</span><span className="text-faint/70">{ghost}</span>
      <span className="ml-1.5 rounded border border-line px-1 align-middle text-[9.5px] text-faint">Tab</span>
    </div>
  );
}

/** The suggestion list (opens above the prompt box). */
export function TypeAheadList({ list, idx, onPick, query, className }: { list: string[]; idx: number; onPick: (s: string) => void; query: string; className?: string }) {
  if (!list.length) return null;
  const q = query.toLowerCase();
  return (
    <div role="listbox" className={cx("absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-xl border border-line bg-panel/95 p-1 shadow-2xl backdrop-blur", className)}>
      {list.map((s, i) => {
        const at = s.toLowerCase().indexOf(q);
        return (
          <button key={s} role="option" aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); onPick(s); }}
            className={cx("block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px]", i === idx ? "bg-accent-soft text-text" : "text-muted hover:bg-panel-2 hover:text-text")}>
            {at >= 0 ? <>{s.slice(0, at)}<b className="font-semibold text-text">{s.slice(at, at + q.length)}</b>{s.slice(at + q.length)}</> : s}
          </button>
        );
      })}
      <div className="px-2.5 pb-0.5 pt-1 text-[10px] text-faint">Tab completes · ↑↓ choose · Enter uses · Esc hides</div>
    </div>
  );
}
