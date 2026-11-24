"use client";
import { useRef, useState } from "react";
import { UploadCloud, Link2, FileText, Image as ImageIcon, Film, PlayCircle, Newspaper, Loader2, CheckCircle2, AlertTriangle, Trash2, RotateCw, ChevronDown, StickyNote, Sparkles } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { Badge, Card, Toggle, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const KIND_ICON: Record<string, any> = { document: FileText, image: ImageIcon, video: Film, youtube: PlayCircle, article: Newspaper, text: StickyNote };
const ACCEPT = ".pdf,.txt,.md,.csv,.json,.html,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,image/*,video/mp4,video/webm,video/quicktime,application/pdf,text/*";
const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${Math.round(b / 1e3)} KB` : b ? `${b} B` : "");
const learnedBy = (s: string | null) => !s ? null : s.startsWith("anthropic:") ? `Claude (${s.split(":")[1]})` : s.startsWith("openai:") ? `ChatGPT (${s.split(":")[1]})` : "Merod rule reader";

/** "Teach Merod": drop files, pictures, videos or paste links; the AI turns them into trading lessons it uses from then on. */
export function TeachMerod() {
  const { data, refresh } = useApi<{ materials: any[] }>("/api/learning/materials", { refreshMs: 6000 });
  const toast = useToast();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useRealtime((e) => { if (e.type === "material") refresh(); });

  async function upload(form: FormData) {
    setBusy(true);
    try {
      const res = await fetch("/api/learning/materials", { method: "POST", body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`);
      toast(`Added ${j.ids.length} item${j.ids.length === 1 ? "" : "s"}. Merod is learning from ${j.ids.length === 1 ? "it" : "them"} now.`, "up");
      if (j.errors?.length) toast(j.errors.join(" · "), "down");
      refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const sendFiles = (files: FileList | File[]) => {
    const list = [...files]; if (!list.length) return;
    const big = list.find((f) => f.size > 20 * 1024 * 1024);
    if (big) return toast(`${big.name} is larger than 20 MB`, "down");
    const fd = new FormData(); list.slice(0, 10).forEach((f) => fd.append("files", f)); void upload(fd);
  };
  const sendLinks = (text: string) => {
    const urls = text.split(/\s+/).filter((u) => /^https?:\/\//i.test(u));
    if (!urls.length) return toast("Paste a link that starts with http:// or https://", "down");
    const fd = new FormData(); urls.forEach((u) => fd.append("url", u)); void upload(fd); setLink("");
  };
  async function act(id: string, method: "PATCH" | "DELETE", body?: unknown) {
    const res = await fetch(`/api/learning/materials/${id}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) toast((await res.json().catch(() => ({}))).error ?? "Something went wrong", "down"); else refresh();
  }

  const items = data?.materials ?? [];
  const learned = items.filter((m) => m.status === "learned").reduce((n, m) => n + (m.lessons?.length ?? 0), 0);
  return (
    <Card title={<span className="flex items-center gap-2">Teach Merod <Badge tone="accent">{learned} lessons</Badge></span>} icon={<Sparkles className="size-4 text-accent-2" />}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const t = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"); if (e.dataTransfer.files.length) sendFiles(e.dataTransfer.files); else if (t) sendLinks(t); }}
        onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); sendFiles(e.clipboardData.files); } }}
        onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        className={cx("flex aspect-[4/3] max-h-64 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-line-2 bg-bg-2/50 hover:border-accent/60")}>
        {busy ? <Loader2 className="size-8 animate-spin text-accent-2" /> : <UploadCloud className="size-8 text-accent-2" />}
        <div className="text-sm font-medium">{busy ? "Uploading…" : "Drop files, pictures or videos here"}</div>
        <div className="text-[11px] text-faint">PDF, text, CSV, chart screenshots, MP4 · up to 20 MB each · or click to browse</div>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { if (e.target.files) sendFiles(e.target.files); e.target.value = ""; }} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); sendLinks(link); }} className="mt-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube or article link"
            className="h-9 w-full rounded-lg border border-line bg-bg-2 pl-8 pr-2 text-xs outline-none focus:border-accent" />
        </div>
        <button disabled={busy || !link.trim()} className="h-9 shrink-0 rounded-lg bg-grad px-3 text-xs font-medium text-white disabled:opacity-40">Add link</button>
      </form>
      <button onClick={() => setNotes(notes === null ? "" : null)} className="mt-2 text-[11px] text-accent-2">{notes === null ? "Or paste notes / a transcript" : "Hide notes box"}</button>
      {notes !== null && (
        <div className="mt-2 space-y-2">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Paste a video transcript, your trading rules, or notes from a course…"
            className="w-full resize-y rounded-lg border border-line bg-bg-2 p-2 text-xs outline-none focus:border-accent" />
          <div className="flex justify-end"><button disabled={busy || notes.trim().length < 20} onClick={() => { const fd = new FormData(); fd.append("text", notes); void upload(fd); setNotes(null); }} className="rounded-lg bg-grad px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Teach this</button></div>
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        {items.length === 0 && <p className="text-xs text-muted">Nothing yet. Add a strategy PDF, a chart screenshot, or a link to an article or video you learned from.</p>}
        {items.map((m) => {
          const Icon = KIND_ICON[m.kind] ?? FileText;
          const working = m.status === "queued" || m.status === "processing";
          return (
            <div key={m.id} className="rounded-lg border border-line bg-panel-2/40">
              <button onClick={() => setOpen(open === m.id ? null : m.id)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
                <Icon className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{m.title}</span>
                  <span className="block truncate text-[10px] text-faint">{[fmtSize(m.size_bytes), ago(m.created_at), m.status === "learned" ? `${m.lessons.length} lesson${m.lessons.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                {working ? <Badge tone="info"><Loader2 className="size-3 animate-spin" />{m.status === "queued" ? "Queued" : "Learning"}</Badge>
                  : m.status === "learned" ? <Badge tone="up"><CheckCircle2 className="size-3" />Learned</Badge>
                  : m.status === "saved" ? <Badge tone="warn">Saved</Badge>
                  : <Badge tone="down"><AlertTriangle className="size-3" />Error</Badge>}
                <ChevronDown className={cx("size-3.5 shrink-0 text-faint transition-transform", open === m.id && "rotate-180")} />
              </button>
              {open === m.id && (
                <div className="space-y-2 border-t border-line px-2.5 py-2 text-xs">
                  {m.kind === "image" && <img src={`/api/learning/materials/${m.id}/file`} alt="" className="max-h-40 rounded-md border border-line object-contain" />}
                  {m.kind === "video" && <video src={`/api/learning/materials/${m.id}/file`} controls preload="metadata" className="max-h-48 w-full rounded-md border border-line" />}
                  {m.source_url && <a href={m.source_url} target="_blank" rel="noreferrer noopener" className="block truncate text-accent-2">{m.source_url}</a>}
                  {m.status_detail && <p className={cx("text-[11px]", m.status === "error" ? "text-down" : "text-muted")}>{m.status_detail}</p>}
                  {m.summary && <p className="text-muted">{m.summary}</p>}
                  {m.lessons?.length > 0 && (
                    <ul className="space-y-1">
                      {m.lessons.map((l: any, i: number) => (
                        <li key={i} className="rounded-md bg-bg-2/60 px-2 py-1.5">
                          <div className="flex items-center gap-1.5"><span className="font-medium">{l.title}</span><Badge>{l.kind}</Badge><Badge tone={l.confidence === "high" ? "up" : l.confidence === "medium" ? "info" : "neutral"}>{l.confidence}</Badge></div>
                          <div className="mt-0.5 text-muted">{l.rule}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.symbols?.length > 0 && <div className="flex flex-wrap gap-1">{m.symbols.slice(0, 12).map((s: string) => <Badge key={s}>{s}</Badge>)}</div>}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Toggle checked={m.active} onChange={(v) => act(m.id, "PATCH", { active: v })} label="Use in trading" />
                    <span className="flex items-center gap-2">
                      {learnedBy(m.learned_by) && <span className="text-[10px] text-faint">by {learnedBy(m.learned_by)}</span>}
                      {(m.status === "error" || m.status === "saved") && <button onClick={() => act(m.id, "PATCH", { retry: true })} className="rounded p-1 text-muted hover:text-text" title="Learn again"><RotateCw className="size-3.5" /></button>}
                      <button onClick={() => { if (confirm(`Remove “${m.title}”?`)) void act(m.id, "DELETE"); }} className="rounded p-1 text-muted hover:text-down" title="Remove"><Trash2 className="size-3.5" /></button>
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-faint">Lessons switched to “Use in trading” are given to Claude, ChatGPT and Merod as study notes on every prompt. They can shape suggestions and defaults but never place a trade by themselves; every order still needs your limits and confirmation.</p>
    </Card>
  );
}
