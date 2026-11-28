"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Tell every Advisor view (sidebar, page) to reload after a change made in one of them. */
export const advisorChanged = () => { try { window.dispatchEvent(new Event("merod-advisor")); } catch { /* ignore */ } };
export function useAdvisorSync(refresh: () => unknown) {
  useEffect(() => { const f = () => { void refresh(); }; window.addEventListener("merod-advisor", f); return () => window.removeEventListener("merod-advisor", f); }, [refresh]);
}
import { Lightbulb, Check, X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime } from "./context";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

/** "30 sec", "1 min", "2 hours" */
export const everyLabel = (sec: number) => (sec < 60 ? `${sec} sec` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} hour${sec >= 7200 ? "s" : ""}`);

export const TOPIC_LABEL: Record<string, string> = { market: "Market", trades: "Trades", bots: "Bots", agents: "Agents", prompts: "Prompts" };

/** One tip row with Apply / Dismiss. */
export function TipRow({ t, onDone, compact }: { t: any; onDone: () => void; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function act(action: "apply" | "dismiss") {
    setBusy(action);
    try { const r = await api(`/api/advisor/tips/${t.id}`, { method: "POST", json: { action, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }); if (action === "apply") toast(r.note, "up"); onDone(); advisorChanged(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  const body = (
    <>
      <div className={cx("font-medium leading-snug", compact ? "text-[12px]" : "text-[13px]")}>{t.priority === 1 && <span className="mr-1 inline-block size-1.5 rounded-full bg-accent-2 align-middle" />}{t.title}</div>
      {!compact && <div className="mt-0.5 text-[12px] leading-snug text-muted">{t.body}</div>}
    </>
  );
  return (
    <div className={cx("group rounded-lg border border-line", compact ? "p-1.5" : "p-2.5", t.applied_at && "opacity-60")}>
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {t.link ? <Link href={t.link} className="hover:underline" title={compact ? t.body : undefined}>{body}</Link> : <div title={compact ? t.body : undefined}>{body}</div>}
          <div className="mt-0.5 text-[10px] text-faint">{TOPIC_LABEL[t.topic] ?? t.topic} · {ago(t.created_at)}{t.applied_at ? " · done" : ""}</div>
          {!compact && t.applied_note && <div className="mt-1 text-[11px] text-up">{t.applied_note}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {t.action && !t.applied_at && <button onClick={() => act("apply")} disabled={!!busy} title={t.action.type === "prompt" ? `Send to Merod: “${t.action.text}”` : "Apply this change"} className="rounded-md bg-grad px-1.5 py-0.5 text-[10.5px] font-semibold text-bg disabled:opacity-60">{busy === "apply" ? <Loader2 className="size-3 animate-spin" /> : t.action.type === "prompt" ? "Do it" : "Apply"}</button>}
          {t.applied_at && <Check className="size-3.5 text-up" />}
          <button onClick={() => act("dismiss")} disabled={!!busy} title="Dismiss" className="rounded-md p-0.5 text-faint hover:text-text"><X className="size-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

/** Left sidebar section: Advisor on/off switch, status and the newest suggestions. */
export function AdvisorPanel({ className, onOpenAll }: { className?: string; onOpenAll?: () => void }) {
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/advisor?limit=20", { refreshMs: 30_000 });
  useRealtime((e) => { if (e.type === "advisor") refresh(); });
  useAdvisorSync(refresh);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("merod-advisor-open") !== "0"; } catch { return true; } });
  const toggleOpen = () => setOpen((o) => { try { localStorage.setItem("merod-advisor-open", o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const s = data?.settings, on = !!s?.active;
  const tips: any[] = (data?.tips ?? []).filter((t: any) => !t.applied_at);
  async function setOn(v: boolean) {
    try { await api("/api/advisor", { method: "POST", json: { active: v } }); if (v) await api("/api/advisor/run", { method: "POST" }).catch(() => {}); await refresh(); advisorChanged(); toast(v ? "Advisor on: it keeps analysing until you turn it off" : "Advisor off", "up"); }
    catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <div className={cx("rounded-xl border border-line bg-panel/60 p-2", className)}>
      <div className="flex items-center gap-1.5">
        <button onClick={toggleOpen} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-semibold" aria-expanded={open}>
          {open ? <ChevronDown className="size-3 text-faint" /> : <ChevronRight className="size-3 text-faint" />}
          <Lightbulb className={cx("size-3.5", on ? "text-accent-2" : "text-faint")} />Advisor
          {on && tips.length > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] text-accent-2">{tips.length}</span>}
        </button>
        <button role="switch" aria-checked={on} aria-label="Advisor on/off" onClick={() => setOn(!on)} title={on ? "Advisor is on: analysing markets and your trading continuously. Click to turn off." : "Turn on: Merod continuously analyses coin/stock data and your trades, bots, agents and prompts, and suggests improvements."}
          className={cx("relative h-4 w-7 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-panel-2 ring-1 ring-line")}>
          <span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-3.5" : "left-0.5")} />
        </button>
      </div>
      {open && (
        <div className="mt-1.5 space-y-1">
          <div className="px-0.5 text-[10.5px] text-faint">{on ? `Watching markets + your trading · every ${everyLabel(s.every_sec ?? (s.every_min ?? 10) * 60)}${s.last_run_at ? ` · checked ${ago(s.last_run_at)}` : ""}` : "Off. Turn on for continuous suggestions on coins, stocks, trades, bots, agents and prompts."}</div>
          {on && !tips.length && <div className="px-0.5 py-1 text-[11px] text-muted">No suggestions right now. You'll see them here as soon as there's something worth doing.</div>}
          {tips.slice(0, 3).map((t) => <TipRow key={t.id} t={t} onDone={refresh} compact />)}
          {onOpenAll
            ? <button onClick={onOpenAll} className="block px-0.5 pt-0.5 text-left text-[11px] text-accent-2 hover:underline">{tips.length > 3 ? `See all ${tips.length} suggestions →` : "Advisor settings & history →"}</button>
            : <Link href="/advisor" className="block px-0.5 pt-0.5 text-[11px] text-accent-2 hover:underline">{tips.length > 3 ? `See all ${tips.length} suggestions →` : "Advisor settings & history →"}</Link>}
        </div>
      )}
    </div>
  );
}
