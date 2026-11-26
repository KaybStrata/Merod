import { requireUser } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { ok, route } from "@/server/http";
import { explainEvent } from "@/server/agents/explain";

type Ctx = { params: Promise<{ id: string }> };
/** Why card payload for one of your agent's decisions: text, inputs table, rule + version, checks, result, your vote. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Bad event id");
  return ok(await explainEvent(u.id, id));
});
