"use client";
import { useEffect, useState } from "react";
import { GraduationCap, TrendingUp, SlidersHorizontal, ScanSearch } from "lucide-react";
import { api } from "@/lib/api";
import { cx, useToast } from "@/components/ui";

type Mode = "trainer" | "gainer" | "adjuster" | "scanner";
const META: Record<Mode, { label: string; icon: any; tip: string }> = {
  trainer: { label: "Auto trainer", icon: GraduationCap, tip: "Learns from every trade and tunes bot settings" },
  gainer: { label: "Auto gainer", icon: TrendingUp, tip: "Grows $ per trade from winning trades' profit — more buying power after wins" },
  adjuster: { label: "Auto adjuster", icon: SlidersHorizontal, tip: "Fits stop-loss, take-profit and dip to how much each asset is moving" },
  scanner: { label: "Auto scanner", icon: ScanSearch, tip: "Scans all coins & stocks for top movers and points idle bots at them" },
};
const MODES = Object.keys(META) as Mode[];

// One shared copy of the switches so every bar on the page stays in sync.
let cache: any = null;
const subs = new Set<(d: any) => void>();
let inflight: Promise<any> | null = null;
async function load(force = false) {
  if (cache && !force) return cache;
  inflight ??= api("/api/auto-modes").then((d) => { cache = d; subs.forEach((f) => f(d)); return d; }).finally(() => { inflight = null; });
  return inflight;
}
function useModes() {
  const [d, setD] = useState<any>(cache);
  useEffect(() => { subs.add(setD); void load().catch(() => {}); return () => { subs.delete(setD); }; }, []);
  return d;
}

/**
 * The four auto switches. Under a chat reply they act on everything (scope "all"); on a bot's or agent's page pass
 * scope + scopeRef to switch them for that one only.
 */
export function AutoModesBar({ scope = "all", scopeRef, compact, className }: { scope?: "all" | "bot" | "agent"; scopeRef?: string; compact?: boolean; className?: string }) {
  const d = useModes();
  const toast = useToast();
  const [busy, setBusy] = useState<Mode | null>(null);
  const isOn = (m: Mode) => scope === "all" ? !!d?.global?.find((g: any) => g.mode === m)?.active : !!d?.scoped?.find((s: any) => s.mode === m && s.scope === scope && s.scope_ref === scopeRef)?.active;
  const note = (m: Mode) => (scope === "all" ? d?.global?.find((g: any) => g.mode === m)?.last_note : d?.scoped?.find((s: any) => s.mode === m && s.scope_ref === scopeRef)?.last_note) ?? "";
  async function flip(m: Mode) {
    const next = !isOn(m);
    setBusy(m);
    try {
      cache = await api("/api/auto-modes", { method: "POST", json: { mode: m, active: next, scope, scopeRef } });
      cache = { ...cache, movers: d?.movers };
      subs.forEach((f) => f(cache));
      toast(`${META[m].label} ${next ? "on" : "off"}${scope === "all" ? "" : " for this one"}`, next ? "up" : "neutral");
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", className)} aria-label="Auto switches">
      {MODES.map((m) => {
        const on = isOn(m), I = META[m].icon;
        return (
          <button key={m} role="switch" aria-checked={on} disabled={busy === m || !d} onClick={() => flip(m)}
            title={`${META[m].tip}${note(m) ? `\nLast: ${note(m)}` : ""}`}
            className={cx("inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] transition disabled:opacity-60",
              on ? "border-accent/50 bg-accent/12 text-text" : "border-line text-muted hover:text-text")}>
            <I className={cx("size-3", on ? "text-accent-2" : "text-faint")} />
            {compact ? META[m].label.replace("Auto ", "") : META[m].label}
            <span className={cx("relative h-3 w-5 rounded-full transition", on ? "bg-accent" : "bg-panel-2 ring-1 ring-line")}>
              <span className={cx("absolute top-[2px] size-2 rounded-full bg-white transition-all", on ? "left-[10px]" : "left-[2px]")} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
