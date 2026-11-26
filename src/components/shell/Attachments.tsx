"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Film, Paperclip, X, Loader2, AlertTriangle, Check } from "lucide-react";
import { api } from "@/lib/api";
import { cx } from "@/components/ui";

/** What the prompt box accepts: PDFs, documents/text/CSV, images and videos (Merod's file reader handles all of these). */
export const ATTACH_ACCEPT = ".pdf,.txt,.md,.csv,.json,.html,.htm,.rtf,application/pdf,text/*,image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-matroska";
const MAX_BYTES = 20 * 1024 * 1024, MAX_FILES = 10;

export type Attachment = { key: string; id?: string; name: string; kind: string; size: number; status: "uploading" | "reading" | "ready" | "error"; detail?: string; preview?: string };
const kindOf = (f: File) => f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "document";

/** Files attached to the next prompt: uploads right away, shows when Merod has read each one, and hands back their ids. */
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const patch = (key: string, p: Partial<Attachment>) => setItems((cur) => cur.map((a) => (a.key === key ? { ...a, ...p } : a)));

  async function add(list: FileList | File[]) {
    const files = Array.from(list).slice(0, Math.max(0, MAX_FILES - items.length));
    for (const f of files) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined;
      if (f.size > MAX_BYTES) { setItems((c) => [...c, { key, name: f.name, kind: kindOf(f), size: f.size, status: "error", detail: "Larger than 20 MB", preview }]); continue; }
      setItems((c) => [...c, { key, name: f.name, kind: kindOf(f), size: f.size, status: "uploading", preview }]);
      const fd = new FormData(); fd.append("files", f);
      api<any>("/api/ai/attachments", { method: "POST", body: fd })
        .then((r) => { const x = r.files?.[0]; x ? patch(key, { id: x.id, kind: x.kind, status: "reading" }) : patch(key, { status: "error", detail: r.errors?.[0] ?? "Upload failed" }); })
        .catch((e) => patch(key, { status: "error", detail: e.message }));
    }
  }
  // While Merod reads the files, check their status every 2s (the prompt waits for unread files anyway).
  const reading = items.filter((a) => a.status === "reading" && a.id).map((a) => a.id!).join(",");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(async () => {
      try {
        const r: any = await api(`/api/ai/attachments?ids=${reading}`);
        for (const f of r.files ?? []) if (!["queued", "processing"].includes(f.status))
          setItems((cur) => cur.map((a) => (a.id === f.id ? { ...a, status: f.status === "error" ? "error" : "ready", detail: f.detail ?? undefined } : a)));
      } catch { /* try again next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [reading]);
  const remove = (key: string) => setItems((cur) => { const a = cur.find((x) => x.key === key); if (a?.preview) URL.revokeObjectURL(a.preview); return cur.filter((x) => x.key !== key); });
  const clear = () => setItems((cur) => { cur.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); return []; });
  const ids = items.filter((a) => a.id && a.status !== "error").map((a) => a.id!);
  const uploading = items.some((a) => a.status === "uploading");
  return { items, add, remove, clear, ids, uploading };
}

/** Paperclip button with a hidden file picker (several files at once). */
export function AttachButton({ onFiles, label = "Attach", className, disabled }: { onFiles: (f: FileList) => void; label?: string | null; className?: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple accept={ATTACH_ACCEPT} className="hidden" aria-hidden tabIndex={-1}
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} title="Attach files: PDFs, documents, CSV, photos/images and videos (up to 20 MB each). You can also paste or drop them."
        className={cx("flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-muted hover:text-text disabled:opacity-40", className)}>
        <Paperclip className="size-3.5" />{label && <span>{label}</span>}
      </button>
    </>
  );
}

/** Chips for attached files: thumbnail or icon, name, size, and reading/ready/error state, with remove. */
export function AttachmentChips({ items, onRemove, className }: { items: Attachment[]; onRemove: (key: string) => void; className?: string }) {
  if (!items.length) return null;
  const size = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  return (
    <div className={cx("flex flex-wrap gap-1.5", className)}>
      {items.map((a) => {
        const Icon = a.kind === "image" ? ImageIcon : a.kind === "video" ? Film : FileText;
        return (
          <div key={a.key} title={a.detail ?? a.name}
            className={cx("flex max-w-[240px] items-center gap-1.5 rounded-lg border bg-bg-2/80 py-1 pl-1 pr-1.5 text-[11.5px]", a.status === "error" ? "border-down/50" : "border-line")}>
            {a.preview ? <img src={a.preview} alt="" className="size-7 shrink-0 rounded object-cover" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded bg-panel-2 text-muted"><Icon className="size-3.5" /></span>}
            <span className="min-w-0">
              <span className="block truncate font-medium text-text">{a.name}</span>
              <span className={cx("flex items-center gap-1 text-[10px]", a.status === "error" ? "text-down" : a.status === "ready" ? "text-up" : "text-faint")}>
                {a.status === "uploading" ? <><Loader2 className="size-2.5 animate-spin" /> Uploading…</>
                  : a.status === "reading" ? <><Loader2 className="size-2.5 animate-spin" /> Merod is reading it…</>
                  : a.status === "ready" ? <><Check className="size-2.5" /> Ready · {size(a.size)}</>
                  : <><AlertTriangle className="size-2.5" /> <span className="truncate">{a.detail ?? "Failed"}</span></>}
              </span>
            </span>
            <button type="button" onClick={() => onRemove(a.key)} aria-label={`Remove ${a.name}`} className="ml-0.5 rounded p-0.5 text-faint hover:text-text"><X className="size-3" /></button>
          </div>
        );
      })}
    </div>
  );
}

/** Files pasted (e.g. a screenshot) or dropped into the prompt box. */
export const filesFrom = (dt: DataTransfer | null) => Array.from(dt?.files ?? []);
