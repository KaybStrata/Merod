"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Tell every Advisor view (sidebar, page) to reload after a change made in one of them. */
export const advisorChanged = () => { try { window.dispatchEvent(new Event("merod-advisor")); } catch { /* ignore */ } };
export function useAdvisorSync(refresh: () => unknown) {
  useEffect(() => { const f = () => { void refresh(); }; window.addEventListener("merod-advisor", f); return () => window.removeEventListener("merod-advisor", f); }, [refresh]);
}
import { Lightbulb, Check, X, ChevronDown, ChevronRight, Loader2, Maximize2 } from "lucide-react";
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
      <div className={cx("mt-0.5 leading-snug text-muted", compact ? "line-clamp-2 text-[11px]" : "text-[12.5px]")}>{t.body}</div>
      {t.action && !t.applied_at && <div className={cx("mt-0.5 text-faint", compact ? "text-[10.5px]" : "text-[11px]")}>“Do it” → {t.action.type === "prompt" ? `“${t.action.text}”` : t.action.type === "pause" ? `turn off ${t.action.name}` : t.action.type === "edit" ? `change ${t.action.name}'s settings` : `add a point: ${t.action.text}`}</div>}
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

/** Links dragged in from a browser tab, the address bar or another page. */
export const hasDroppedLink = (e: React.DragEvent) => [...e.dataTransfer.types].some((t) => t === "text/uri-list" || t === "text/plain" || t === "text/html");
export function droppedLinks(e: React.DragEvent): string | null {
  const raw = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || (e.dataTransfer.getData("text/html").match(/href="([^"]+)"/)?.[1] ?? "");
  const links = raw.split(/\s+/).filter((x) => /^https?:\/\//i.test(x) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(x));
  return links.length ? links.slice(0, 5).join(" ") : null;
}

/** "Train Momo": paste or drop any link (YouTube, news, strategy page); add words like "and train my bots on it". */
function MomoTrain({ busy, onTeach, big }: { busy: boolean; onTeach: (t: string) => void; big?: boolean }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onTeach(v.trim()); setV(""); } }} className="flex items-center gap-1">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={big ? "Train Momo: paste or drop a link (YouTube, news…) + optional “train my bots on it”" : "Train Momo: paste or drop a link"}
        className={cx("min-w-0 flex-1 rounded-md border border-line bg-bg-2 px-2 outline-none focus:border-accent/60", big ? "py-1.5 text-[12.5px]" : "py-1 text-[11px]")} />
      <button disabled={busy || !v.trim()} className={cx("shrink-0 rounded-md bg-grad px-2 font-semibold text-bg disabled:opacity-50", big ? "py-1.5 text-[12px]" : "py-1 text-[10.5px]")}>{busy ? <Loader2 className="size-3 animate-spin" /> : "Learn"}</button>
    </form>
  );
}

/** Left sidebar section: Momo (the Advisor) on/off switch, status and the newest suggestions. */
export function AdvisorPanel({ className, onOpenAll }: { className?: string; onOpenAll?: () => void }) {
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/advisor?limit=20", { refreshMs: 30_000 });
  useRealtime((e) => { if (e.type === "advisor") refresh(); });
  useAdvisorSync(refresh);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("merod-advisor-open") !== "0"; } catch { return true; } });
  const toggleOpen = () => setOpen((o) => { try { localStorage.setItem("merod-advisor-open", o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const s = data?.settings, on = !!s?.active;
  const tips: any[] = (data?.tips ?? []).filter((t: any) => !t.applied_at);
  // Pop-out: a big panel beside the sidebar with every suggestion in full.
  const [pop, setPop] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [popLeft, setPopLeft] = useState(290);
  useEffect(() => { if (pop && boxRef.current) setPopLeft(Math.round(boxRef.current.getBoundingClientRect().right + 12)); }, [pop]);
  useEffect(() => { if (!pop) return; const k = (e: KeyboardEvent) => e.key === "Escape" && setPop(false); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [pop]);
  const [dropping, setDropping] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [learned, setLearned] = useState<string | null>(null);
  async function teach(text: string) {
    setTeaching(true);
    try {
      const r = await api("/api/momo/learn", { method: "POST", json: { text } });
      setLearned(r.summary); setPop(true); await refresh(); advisorChanged();
      toast("Momo learned from it", "up");
    } catch (e: any) { toast(e.message, "down"); } finally { setTeaching(false); }
  }
  async function setOn(v: boolean) {
    try { await api("/api/advisor", { method: "POST", json: { active: v } }); if (v) await api("/api/advisor/run", { method: "POST" }).catch(() => {}); await refresh(); advisorChanged(); toast(v ? "Momo on: it keeps analysing until you turn it off" : "Momo off", "up"); }
    catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <div ref={boxRef} className={cx("rounded-xl border bg-panel/60 p-2 transition-colors", dropping ? "border-accent/70 bg-accent/10" : "border-line", className)}
      onDragOver={(e) => { if (hasDroppedLink(e)) { e.preventDefault(); setDropping(true); } }} onDragLeave={() => setDropping(false)}
      onDrop={(e) => { const l = droppedLinks(e); setDropping(false); if (l) { e.preventDefault(); void teach(l); } }}>
      <div className="flex items-center gap-1.5">
        <button onClick={toggleOpen} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-semibold" aria-expanded={open}>
          {open ? <ChevronDown className="size-3 text-faint" /> : <ChevronRight className="size-3 text-faint" />}
          <Lightbulb className={cx("size-3.5", on ? "text-accent-2" : "text-faint")} />Momo
          {on && tips.length > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] text-accent-2">{tips.length}</span>}
        </button>
        <button onClick={() => setPop((v) => !v)} title="Open Momo in a big panel (every suggestion, fully explained)" aria-label="Expand Momo"
          className={cx("rounded-md p-1 hover:bg-panel-2", pop ? "text-accent-2" : "text-faint hover:text-text")}><Maximize2 className="size-3.5" /></button>
        <button role="switch" aria-checked={on} aria-label="Momo on/off" onClick={() => setOn(!on)} title={on ? "Advisor is on: analysing markets and your trading continuously. Click to turn off." : "Turn on: Merod continuously analyses coin/stock data and your trades, bots, agents and prompts, and suggests improvements."}
          className={cx("relative h-4 w-7 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-panel-2 ring-1 ring-line")}>
          <span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-3.5" : "left-0.5")} />
        </button>
      </div>
      {open && (
        <div className="mt-1.5 space-y-1">
          <div className="px-0.5 text-[10.5px] text-faint">{on ? `Watching markets + your trading · every ${everyLabel(s.every_sec ?? (s.every_min ?? 10) * 60)}${s.last_run_at ? ` · checked ${ago(s.last_run_at)}` : ""}` : "Off. Turn on for continuous suggestions on coins, stocks, trades, bots, agents and prompts."}</div>
          {on && !tips.length && <div className="px-0.5 py-1 text-[11px] text-muted">No suggestions right now. You'll see them here as soon as there's something worth doing.</div>}
          <MomoTrain busy={teaching} onTeach={teach} />
          {tips.slice(0, 3).map((t) => <TipRow key={t.id} t={t} onDone={refresh} compact />)}
          {onOpenAll
            ? <button onClick={onOpenAll} className="block px-0.5 pt-0.5 text-left text-[11px] text-accent-2 hover:underline">{tips.length > 3 ? `See all ${tips.length} suggestions →` : "Advisor settings & history →"}</button>
            : <Link href="/advisor" className="block px-0.5 pt-0.5 text-[11px] text-accent-2 hover:underline">{tips.length > 3 ? `See all ${tips.length} suggestions →` : "Advisor settings & history →"}</Link>}
        </div>
      )}
      {pop && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[70]" onClick={() => setPop(false)}>
          <div className="absolute bottom-4 flex max-h-[min(86dvh,900px)] w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-line-2 bg-bg-2 shadow-[0_20px_70px_rgba(0,0,0,.6)]"
            style={{ left: Math.min(popLeft, (typeof window !== "undefined" ? window.innerWidth : 1200) - 532) }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Lightbulb className={cx("size-4", on ? "text-accent-2" : "text-faint")} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">Momo <span className="font-normal text-muted">· {tips.length} suggestion{tips.length === 1 ? "" : "s"}</span></div>
                <div className="text-[11px] text-faint">{on ? `Watching markets + your trading · every ${everyLabel(s.every_sec ?? (s.every_min ?? 10) * 60)}${s.last_run_at ? ` · checked ${ago(s.last_run_at)}` : ""}` : "Off: turn it on with the switch in the sidebar."}</div>
              </div>
              {onOpenAll && <button onClick={() => { setPop(false); onOpenAll(); }} className="text-[11.5px] text-accent-2 hover:underline">Settings & history</button>}
              <button onClick={() => setPop(false)} className="rounded-md p-1 text-faint hover:text-text" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              <MomoTrain busy={teaching} onTeach={teach} big />
              {learned && <pre className="whitespace-pre-wrap rounded-lg border border-accent/30 bg-accent/5 p-2.5 font-sans text-[12px] leading-relaxed text-text">{learned}</pre>}
              {tips.map((t) => <TipRow key={t.id} t={t} onDone={refresh} />)}
              {!tips.length && <p className="p-2 text-[12.5px] text-muted">{on ? "No suggestions right now. New ones appear here as markets move and you trade." : "Turn the Advisor on to get continuous suggestions."}</p>}
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}
