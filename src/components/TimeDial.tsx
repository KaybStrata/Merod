"use client";
import { useEffect, useState } from "react";
import { dialToSec, secLabel, secToDial, secWords, snapDial } from "@/lib/timeDial";
import { cx } from "@/components/ui";

/**
 * Log-scale time dial, 1 minute → 5 years (shared by the P&L chart and the Review). The label updates live while dragging;
 * onChange fires on release (pointer-up / key-up / touch-end) so the API isn't called mid-drag. Snaps near 1h/1d/1w/1m/3m/1y.
 * Keyboard: ←/→ = 1 unit, Shift = 5 units.
 */
export function TimeDial({ value, onChange, className, min = 60 }: { value: number; onChange: (seconds: number) => void; className?: string; min?: number }) {
  const [dial, setDial] = useState(() => secToDial(value));
  useEffect(() => { setDial(secToDial(value)); }, [value]);
  const commit = (v = dial) => { const s = Math.max(min, dialToSec(snapDial(v))); setDial(secToDial(s)); onChange(s); };
  const live = Math.max(min, dialToSec(snapDial(dial)));
  return (
    <div className={cx("flex items-center gap-2 text-[10px] text-faint", className)} onClick={(e) => e.stopPropagation()}>
      <span>{secLabel(min)}</span>
      <input type="range" min={0} max={100} step={0.5} value={dial} aria-label="Custom time range" aria-valuetext={secWords(live)}
        onChange={(e) => setDial(Number(e.target.value))}
        onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const step = (e.shiftKey ? 5 : 1) * (e.key === "ArrowLeft" ? -1 : 1); const v = Math.min(100, Math.max(0, dial + step)); setDial(v); commit(v); } }}
        onPointerUp={() => commit()} onKeyUp={(e) => { if (!["ArrowLeft", "ArrowRight"].includes(e.key)) commit(); }} onTouchEnd={() => commit()}
        className="h-1 flex-1 cursor-pointer accent-[var(--color-accent-2,#d6b37a)]" />
      <span>5y</span>
      <span className="num w-12 text-right font-semibold text-accent-2">{secLabel(live)}</span>
    </div>
  );
}
