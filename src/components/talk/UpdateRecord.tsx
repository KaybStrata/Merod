"use client";
import { usePopSide } from "@/lib/usePopSide";
import { useEffect, useState } from "react";
import { RefreshCw, Circle, Check, Loader2, ShieldCheck, TrendingUp, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const WINDOWS: [string, number][] = [["1H", 1], ["6H", 6], ["24H", 24], ["3D", 72], ["7D", 168], ["30D", 720]];
const EVERY: [string, number][] = [["15 min", 15], ["30 min", 30], ["1 hour", 60], ["4 hours", 240], ["Daily", 1440]];

/**
 * Talk composer: "Update" analyses recent trading and proposes changes for bots/agents (Apply each, or Apply all);
 * "Record" keeps doing it on a schedule until turned off, optionally auto-applying only the safe (risk-reducing) ones.
 */
export function UpdateRecord() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const pop = usePopSide(open, 460);
  const { data, refresh } = useApi<any>("/api/talk/update", { refreshMs: 30_000 });
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);
  const rec = data?.recording, recording = !!rec?.active;
  const latest = data?.updates?.[0];

  // Opened from a "Recording" notification (/talk?update=1).
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("update")) setOpen(true); }, []);

  async function analyze() {
    setBusy("analyze");
    try { await api("/api/talk/update", { method: "POST", json: { hours } }); await refresh(); } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function apply(id: number, index: number) {
    setBusy(`a${index}`);
    try { const r = await api("/api/talk/update/apply", { method: "POST", json: { id, index } }); toast(r.line, "up"); await refresh(); } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function applyAll(u: any) {
    setBusy("all");
    try { for (const [i] of (u.decisions ?? []).entries()) if (!u.applied?.[i]) await api("/api/talk/update/apply", { method: "POST", json: { id: u.id, index: i } }); toast("All suggestions applied", "up"); await refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function setRec(patch: { active: boolean; everyMin?: number; autoApply?: boolean }) {
    setBusy("rec");
    try { await api("/api/talk/record", { method: "POST", json: { everyMin: rec?.every_min ?? 60, autoApply: rec?.auto_apply ?? false, ...patch } }); await refresh(); toast(patch.active ? "Recording: Merod will keep analysing your trades" : "Recording stopped", "up"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  return (
    <div className="relative" ref={pop.ref}>
      <div className="flex items-center">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Update: analyse recent trades and get changes that help your bots and agents"
          className={cx("flex h-8 items-center gap-1.5 rounded-l-lg border px-2.5 text-[12.5px]", open ? "border-accent/50 text-accent-2" : "border-line text-muted hover:text-text")}>
          <RefreshCw className="size-3.5" /> Update
        </button>
        <button onClick={() => setRec({ active: !recording })} disabled={busy === "rec"} title={recording ? "Recording: Merod is analysing your trades on a schedule. Click to stop." : "Record: keep analysing trades until you stop it"}
          className={cx("-ml-px flex h-8 items-center gap-1.5 rounded-r-lg border px-2.5 text-[12.5px]", recording ? "border-down/50 bg-down-soft text-down" : "border-line text-muted hover:text-text")}>
          <Circle className={cx("size-3", recording && "fill-current pulse-dot")} /> {recording ? "Recording" : "Record"}
        </button>
      </div>
      {open && (
        <div className={cx("absolute bottom-10 z-30 max-h-[min(78vh,720px)] w-[min(460px,90vw)] overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-2xl", pop.cls)}>
          <div className="flex items-center gap-2 text-[13px] font-semibold"><TrendingUp className="size-4 text-accent-2" />Trading update<button onClick={() => setOpen(false)} className="ml-auto text-faint hover:text-text"><X className="size-4" /></button></div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {WINDOWS.map(([l, h]) => <button key={l} onClick={() => setHours(h)} className={cx("rounded-md px-2 py-0.5 text-[11.5px]", hours === h ? "bg-accent/20 text-accent-2" : "text-muted hover:text-text")}>{l}</button>)}
            <button onClick={analyze} disabled={!!busy} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-grad px-2.5 py-1 text-[12px] font-semibold text-bg disabled:opacity-60">{busy === "analyze" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Analyze now</button>
          </div>

          {latest ? (
            <div className="mt-2.5">
              <div className="text-[10.5px] text-faint">{latest.source === "record" ? "Recorded" : "Analyzed"} {ago(latest.created_at)} · last {Number(latest.hours) >= 48 ? `${Math.round(Number(latest.hours) / 24)} days` : `${Number(latest.hours)}h`}</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed">{latest.stats?.summary}</p>
              {latest.stats?.actors?.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-line text-[11.5px]">
                  {latest.stats.actors.slice(0, 8).map((a: any) => (
                    <div key={a.name} className="flex items-center gap-2 border-b border-line/60 px-2 py-1 last:border-0">
                      <span className="truncate">{a.name}</span><span className="text-faint">{a.closed} closed{a.winRate != null ? ` · ${a.winRate}% won` : ""}</span>
                      <span className={cx("num ml-auto", a.net > 0 ? "text-up" : a.net < 0 ? "text-down" : "text-muted")}>{a.net >= 0 ? "+" : "-"}${Math.abs(a.net).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              {(latest.decisions ?? []).length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center text-[11px] font-semibold uppercase tracking-wide text-faint">Suggested changes
                    {(latest.decisions ?? []).some((_: any, i: number) => !latest.applied?.[i]) && <button onClick={() => applyAll(latest)} disabled={!!busy} className="ml-auto rounded-md border border-accent/50 px-2 py-0.5 text-[11px] normal-case tracking-normal text-accent-2 hover:bg-accent/10">{busy === "all" ? "Applying…" : "Apply all"}</button>}
                  </div>
                  {latest.decisions.map((d: any, i: number) => {
                    const raw = latest.applied?.[i], done = raw ? (typeof raw === "string" ? raw : raw.line) : null;
                    return (
                      <div key={i} className="rounded-lg border border-line p-2">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-semibold">{d.title}{d.safe && <ShieldCheck className="ml-1 inline size-3.5 text-up" aria-label="Lowers risk" />}</div>
                            <div className="text-[11.5px] text-muted">{d.why}</div>
                          </div>
                          {done ? <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-up"><Check className="size-3.5" />Done</span>
                            : <button onClick={() => apply(latest.id, i)} disabled={!!busy} className="shrink-0 rounded-md bg-grad px-2 py-1 text-[11.5px] font-semibold text-bg disabled:opacity-60">{busy === `a${i}` ? "…" : "Apply"}</button>}
                        </div>
                        {done && <div className="mt-1 text-[11px] text-faint">{done}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : <p className="mt-2.5 text-[12.5px] text-muted">Press Analyze now to review your recent trades. Merod looks at every bot, agent, prompt, mimic and manual trade and suggests changes that help them.</p>}

          <div className="mt-3 border-t border-line pt-2.5 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Record</span>
              <span className="text-muted">{recording ? `on since ${ago(rec.started_at)}${rec.last_run_at ? ` · last ${ago(rec.last_run_at)}` : ""}` : "off"}</span>
              <select value={rec?.every_min ?? 60} onChange={(e) => setRec({ active: recording || true, everyMin: Number(e.target.value) })} className="ml-auto rounded-md border border-line bg-bg-2 px-1.5 py-0.5 text-[11.5px]">
                {EVERY.map(([l, m]) => <option key={m} value={m}>every {l}</option>)}
              </select>
              <button onClick={() => setRec({ active: !recording })} className={cx("rounded-md px-2 py-0.5 text-[11.5px] font-semibold", recording ? "border border-down/50 text-down" : "bg-grad text-bg")}>{recording ? "Stop" : "Start"}</button>
            </div>
            <label className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-muted">
              <input type="checkbox" checked={!!rec?.auto_apply} onChange={(e) => setRec({ active: recording || e.target.checked, autoApply: e.target.checked })} className="mt-0.5" />
              Auto-apply safe changes while recording (turning off a losing bot, tighter stop-losses, avoiding a losing coin). Bigger trade sizes always wait for you.
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
