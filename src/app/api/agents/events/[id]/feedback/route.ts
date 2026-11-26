import { z } from "zod";
import { requireUser } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { ok, parse, rateLimit, route } from "@/server/http";
import { rateEvent } from "@/server/agents/explain";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ vote: z.union([z.literal(1), z.literal(-1)]), reasons: z.array(z.string().max(20)).max(5).optional(), note: z.string().max(280).optional() });
/** "Would you have done this?" 👍/👎 with optional reasons. Upserts (re-voting updates). Own events only. Teaches; never changes rules. */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  await rateLimit(`agent-feedback:${u.id}`, 120, 3600);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Bad event id");
  const b = await parse(req, Body);
  return ok(await rateEvent(u.id, id, b.vote, b.reasons ?? [], b.note));
});
