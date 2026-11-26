import { requireUser } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { ok, route } from "@/server/http";
import { one } from "@/server/db";
import { agreement } from "@/server/agents/explain";

type Ctx = { params: Promise<{ id: string }> };
/** Agreement with an agent's trades: % you'd have made, how many rated, top reasons, last 20 ratings. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const id = (await params).id;
  if (!(await one("SELECT 1 FROM agents WHERE id=$1 AND user_id=$2", [id, u.id]))) throw new HttpError(404, "Agent not found");
  return ok(await agreement(u.id, id));
});
