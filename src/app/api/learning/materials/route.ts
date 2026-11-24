import { requireUser } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { addFile, addLink, addText, listMaterials, processMaterial } from "@/server/learning/materials";

/** The user's Teach Merod materials (file bytes are never included). */
export const GET = route(async () => {
  const u = await requireUser();
  return ok({ materials: await listMaterials(u.id) });
});

/** multipart/form-data with any of: files (repeatable), url (repeatable, one per line ok), text + title. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`teach:${u.id}`, 40, 3600);
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, "Send the files as a form upload"); }
  const ids: string[] = [], errors: string[] = [];
  for (const f of form.getAll("files")) {
    if (typeof f === "string") continue;
    try { ids.push(await addFile(u.id, { name: f.name || "file", type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })); }
    catch (e: any) { errors.push(e.message); }
  }
  const urls = form.getAll("url").flatMap((v) => String(v).split(/\s+/)).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  for (const url of urls) { try { ids.push(await addLink(u.id, url)); } catch (e: any) { errors.push(`${url.slice(0, 60)}: ${e.message}`); } }
  const text = String(form.get("text") ?? "").trim();
  if (text) { try { ids.push(await addText(u.id, String(form.get("title") ?? ""), text)); } catch (e: any) { errors.push(e.message); } }
  if (!ids.length && errors.length) throw new HttpError(400, errors.join(" · "));
  // Start learning right away for the first couple; the worker picks up the rest within seconds.
  for (const id of ids.slice(0, 2)) void processMaterial(id).catch(() => {});
  return ok({ ids, errors });
});

/** Uploads up to 20 MB per file. */
export const maxDuration = 60;
