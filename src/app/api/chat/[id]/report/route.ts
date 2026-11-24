import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { reportMessage } from "@/server/chat/service";

type Ctx = { params: Promise<{ id: string }> };
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  await rateLimit(`chat-report:${u.id}`, 20, 3600);
  const { id } = await params;
  if (!/^\d+$/.test(id)) throw new HttpError(400, "Bad message id");
  const b = await parse(req, z.object({ reason: z.string().max(300).optional() }));
  await reportMessage(u.id, Number(id), b.reason);
  return ok({ ok: true });
});
