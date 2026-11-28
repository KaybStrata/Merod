"use client";
import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { api } from "@/lib/api";
import { cx, useToast } from "@/components/ui";

/** Shared state so every master switch on the page agrees. */
let cache: boolean | null = null;
const subs = new Set<(v: boolean) => void>();

/**
 * Master "Bot trading" switch: OFF = no bot, AI bot, Auton or auto switch trades at all. Each bot keeps its own on/off,
 * so turning this back ON resumes exactly the bots that were on. Prompts and your own orders aren't affected.
 */
export function BotTradingSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(cache);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    subs.add(setOn);
    if (cache == null) api<{ on: boolean }>("/api/bots/master").then((r) => { cache = r.on; subs.forEach((f) => f(r.on)); }).catch(() => {});
    return () => { subs.delete(setOn); };
  }, []);
  async function flip() {
    if (on == null) return;
    const next = !on;
    if (!next && !confirm("Turn OFF all bot trading? No bot, AI bot, Auton or auto switch will trade until you turn it back on. Each bot keeps its own on/off.")) return;
    setBusy(true);
    try {
      const r: any = await api("/api/bots/master", { method: "POST", json: { on: next } });
      cache = next; subs.forEach((f) => f(next));
      toast(next ? `Bot trading ON · ${r.running} bot${r.running === 1 ? "" : "s"} switched on` : "Bot trading OFF · nothing automated will trade", next ? "up" : "neutral");
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <button role="switch" aria-checked={!!on} onClick={flip} disabled={busy || on == null}
      title={on ? "Bot trading is ON. Click to stop all bots, AI bots, Auton and auto switches from trading." : "Bot trading is OFF. Click to let the bots you have switched on trade again."}
      className={cx("inline-flex items-center gap-2 rounded-lg border font-semibold transition disabled:opacity-60", compact ? "px-2 py-1 text-[11.5px]" : "px-3 py-1.5 text-[13px]",
        on ? "border-up/50 bg-up/10 text-up" : "border-down/50 bg-down/10 text-down", className)}>
      <Power className={compact ? "size-3.5" : "size-4"} />
      Bot trading {on == null ? "…" : on ? "ON" : "OFF"}
      <span className={cx("relative h-4 w-7 rounded-full transition", on ? "bg-up" : "bg-panel-2 ring-1 ring-line")}>
        <span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-3.5" : "left-0.5")} />
      </span>
    </button>
  );
}
