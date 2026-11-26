import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { act } from "@/server/lab/sessions";

type Ctx = { params: Promise<{ id: string }> };
/** start / pause / resume / stop / archive / clone / rename, with the revision the user saw (optimistic concurrency). */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  await rateLimit(`session-act:${u.id}`, 60, 60);
  const b = await parse(req, z.object({ action: z.enum(["start", "pause", "resume", "stop", "archive", "clone", "rename"]), expectedRevision: z.number().int().min(1), title: z.string().max(80).optional(), reason: z.string().max(300).optional() }));
  return ok({ session: await act(u.id, (await params).id, b.action, b.expectedRevision, { title: b.title, reason: b.reason }) });
});
