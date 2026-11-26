"use client";
import { useState } from "react";
import { Wand2, Trash2, CalendarClock, Plus } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";

/**
 * Skills button for the prompt box. Skills are standing instructions that change how Modo, OpenAI, Claude, bots and
 * agents think, decide and execute (the text guides every AI answer and plan; stop-loss / take-profit / amounts /
 * never-buy / only-trade / max-per-trade / sell-in-profit are enforced by Merod itself). Also lists your schedules.
 */
export function SkillsMenu({ onInsert, compact }: { onInsert?: (text: string) => void; compact?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"skills" | "schedules">("skills");
  const [name, setName] = useState(""), [text, setText] = useState(""), [busy, setBusy] = useState(false);
  const data = useApi<any>(open ? "/api/skills" : null);
  const skills: any[] = data.data?.skills ?? [], schedules: any[] = data.data?.schedules ?? [];
  const activeCount = skills.filter((s) => s.active).length;

  async function save() {
    if (text.trim().length < 3) return toast("Describe the skill first", "down");
    setBusy(true);
    try {
      const r: any = await api("/api/skills", { method: "POST", json: { name: name || undefined, instructions: text } });
      toast(`Skill “${r.skill.name}” is on${r.enforced?.length ? `. Merod enforces: ${r.enforced.join("; ")}` : ""}`, "up");
      setName(""); setText(""); data.refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const toggle = (kind: "skill" | "schedule", id: string, active: boolean) => api("/api/skills", { method: "PATCH", json: { kind, id, active } }).then(() => data.refresh()).catch((e) => toast(e.message, "down"));
  const remove = (kind: "skill" | "schedule", id: string) => confirm(`Delete this ${kind}?`) && api(`/api/skills?kind=${kind}&id=${id}`, { method: "DELETE" }).then(() => data.refresh()).catch((e) => toast(e.message, "down"));
  const Switch = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button onClick={onClick} aria-pressed={on} className={cx("relative h-4 w-7 shrink-0 rounded-full transition", on ? "bg-accent-2" : "bg-line-2")}><span className={cx("absolute top-0.5 size-3 rounded-full bg-bg transition", on ? "left-3.5" : "left-0.5")} /></button>
  );

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Skills: standing instructions that change how Modo, OpenAI, Claude, bots and agents think, decide and trade"
        className={cx("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]", open ? "border-accent/50 text-accent-2" : "border-line text-muted hover:text-text", compact && "size-9 justify-center rounded-xl border-transparent px-0")}>
        <Wand2 className="size-3.5" />{!compact && <span>Skills</span>}{!compact && activeCount > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] text-accent-2">{activeCount}</span>}
      </button>
      {open && (
        <div className="absolute bottom-10 left-0 z-40 w-[360px] max-w-[90vw] rounded-xl border border-line bg-panel p-2 shadow-2xl">
          <div className="mb-2 flex gap-1 text-[12px]">
            {(["skills", "schedules"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx("flex items-center gap-1 rounded-md px-2 py-1 capitalize", tab === t ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>
                {t === "skills" ? <Wand2 className="size-3" /> : <CalendarClock className="size-3" />}{t}{t === "schedules" && schedules.length ? ` ${schedules.length}` : ""}
              </button>
            ))}
            <button onClick={() => setOpen(false)} className="ml-auto px-1 text-faint hover:text-text" aria-label="Close">✕</button>
          </div>
          {tab === "skills" ? (
            <>
              <p className="mb-2 text-[11px] text-muted">Skills shape how Modo, OpenAI and Claude think and plan, and Merod enforces stop-loss, take-profit, $ per trade, never-buy / only-trade lists, max per trade and sell-in-profit on every bot, agent and buy. You can also type “create a skill: …”.</p>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {!data.data && <p className="text-[12px] text-faint">Loading…</p>}
                {data.data && !skills.length && <p className="text-[12px] text-faint">No skills yet.</p>}
                {skills.map((s) => (
                  <div key={s.id} className="flex items-start gap-2 rounded-lg border border-line/60 px-2 py-1.5">
                    <Switch on={s.active} onClick={() => toggle("skill", s.id, !s.active)} />
                    <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium">{s.name}</div><div className="line-clamp-2 text-[11px] text-muted">{s.instructions}</div></div>
                    <button onClick={() => remove("skill", s.id)} className="text-faint hover:text-down" aria-label="Delete skill"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-1.5 border-t border-line pt-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional), e.g. Safe meme trading" className="w-full rounded-md border border-line bg-bg-2 px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. Always use a 5% stop loss, only sell in profit, never buy BONK, max $25 per trade, prefer coins with rising volume"
                  className="w-full resize-none rounded-md border border-line bg-bg-2 px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
                <button onClick={save} disabled={busy} className="flex w-full items-center justify-center gap-1 rounded-md bg-grad py-1.5 text-[12px] font-semibold text-bg disabled:opacity-50"><Plus className="size-3.5" />{busy ? "Saving…" : "Add skill"}</button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-[11px] text-muted">Schedules run a prompt on their own, e.g. “every morning at 2am Los Angeles time, buy the top 10 most profitable Solana meme coins and sell on a 1% loop”.</p>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {data.data && !schedules.length && <p className="text-[12px] text-faint">No schedules yet.</p>}
                {schedules.map((s) => (
                  <div key={s.id} className="flex items-start gap-2 rounded-lg border border-line/60 px-2 py-1.5">
                    <Switch on={s.active} onClick={() => toggle("schedule", s.id, !s.active)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-accent-2">{s.label}</div>
                      <div className="line-clamp-2 text-[12px]">{s.prompt}</div>
                      <div className="text-[10.5px] text-faint">{s.active ? `Next: ${new Date(s.next_run_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Paused"}{s.runs ? ` · ran ${s.runs}×` : ""}{s.last_result ? ` · last: ${String(s.last_result).slice(0, 80)}` : ""}</div>
                    </div>
                    <button onClick={() => remove("schedule", s.id)} className="text-faint hover:text-down" aria-label="Delete schedule"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
              </div>
              {onInsert && <button onClick={() => { onInsert("every day at 9am "); setOpen(false); }} className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-line py-1.5 text-[12px] text-muted hover:text-text"><Plus className="size-3.5" />New schedule (type it in the prompt box)</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
