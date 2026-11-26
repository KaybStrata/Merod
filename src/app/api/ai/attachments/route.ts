import { requireUser } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { one } from "@/server/db";
import { addFile, processMaterial } from "@/server/learning/materials";

/**
 * Attach files to a prompt (Classic prompt bar and Talk composer): PDFs, documents, text/CSV, images and videos, up to
 * 20 MB each. Merod starts reading them right away; send the returned ids with the prompt as `attachmentIds`.
 */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`attach:${u.id}`, 60, 3600);
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, "Send the files as a form upload"); }
  const files: { id: string; name: string; kind: string; size: number }[] = [], errors: string[] = [];
  for (const f of form.getAll("files").slice(0, 10)) {
    if (typeof f === "string") continue;
    try {
      const id = await addFile(u.id, { name: f.name || "file", type: f.type, bytes: Buffer.from(await f.arrayBuffer()) }, "chat");
      const row = await one<{ kind: string }>("SELECT kind FROM training_materials WHERE id=$1", [id]);
      files.push({ id, name: f.name || "file", kind: row?.kind ?? "document", size: f.size });
      void processMaterial(id).catch(() => {});
    } catch (e: any) { errors.push(e.message); }
  }
  if (!files.length) throw new HttpError(400, errors.join(" · ") || "No files received");
  return ok({ files, errors });
});

/** Status of attachments (reading → ready), so the chip can show when Merod has read the file. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 10);
  if (!ids.length) return ok({ files: [] });
  const { q } = await import("@/server/db");
  const rows = await q<any>("SELECT id, title, kind, status, status_detail FROM training_materials WHERE user_id=$1 AND id = ANY($2::uuid[])", [u.id, ids]);
  return ok({ files: rows.map((r) => ({ id: r.id, name: r.title, kind: r.kind, status: r.status, detail: r.status_detail })) });
});

export const maxDuration = 60;
