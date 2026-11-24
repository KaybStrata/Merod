import { z } from "zod";
import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { materialFile } from "@/server/learning/materials";

type Ctx = { params: Promise<{ id: string }> };
/** Owner-only preview of an uploaded file. Served with nosniff + a locked-down CSP so it can never run as a page. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const f = await materialFile(u.id, z.string().uuid().parse((await params).id));
  if (!f) throw new HttpError(404, "Not found");
  const inline = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime)|application\/pdf|text\/plain)$/.test(f.mime);
  return new Response(new Uint8Array(f.content), { headers: {
    "Content-Type": inline ? f.mime : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(f.title)}"`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox", "Cache-Control": "private, max-age=300",
  } });
});
