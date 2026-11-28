"use client";
import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { cx, useToast } from "@/components/ui";

/** A skill/point's name and text, with an inline Edit (saves through /api/skills PATCH; rules are re-read from the new text). */
export function SkillText({ s, onSaved, title }: { s: any; onSaved: () => void; title?: React.ReactNode }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name ?? "");
  const [text, setText] = useState(s.instructions ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api("/api/skills", { method: "PATCH", json: { kind: "skill", id: s.id, name, instructions: text } }); toast("Saved", "up"); setEditing(false); onSaved(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  if (!editing) return (
    <div className="group min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{title ?? s.name}</div>
        <button onClick={() => { setName(s.name ?? ""); setText(s.instructions ?? ""); setEditing(true); }} className="rounded p-0.5 text-faint hover:text-text" aria-label={`Edit ${s.name}`} title="Edit"><Pencil className="size-3" /></button>
      </div>
      <div className="line-clamp-2 text-[11px] text-muted">{s.instructions}</div>
    </div>
  );
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full rounded-md border border-line bg-bg-2 px-1.5 py-0.5 text-[12px] outline-none focus:border-accent/60" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} className="w-full resize-y rounded-md border border-line bg-bg-2 px-1.5 py-1 text-[11.5px] outline-none focus:border-accent/60" />
      <div className="flex gap-1">
        <button onClick={save} disabled={busy} className={cx("inline-flex items-center gap-1 rounded-md bg-grad px-2 py-0.5 text-[11px] font-semibold text-bg disabled:opacity-50")}><Check className="size-3" />Save</button>
        <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:text-text"><X className="size-3" />Cancel</button>
      </div>
    </div>
  );
}
