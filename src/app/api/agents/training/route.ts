import { z } from "zod";
import { requireUser } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { one } from "@/server/db";
import { ok, parse, rateLimit, route } from "@/server/http";
import { listCandidates } from "@/server/agents/extras";
import { proposeImprovement } from "@/server/agents/runner";

export const GET = route(async () => {
  const u = await requireUser();
  return ok({ candidates: await listCandidates(u.id) });
});
/** Run a review now for one agent: evaluate → propose → validate on in/out-of-sample history. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`train:${u.id}`, 10, 60);
  const b = await parse(req, z.object({ agentId: z.string().uuid() }));
  const a = await one<any>("SELECT * FROM agents WHERE id=$1 AND user_id=$2", [b.agentId, u.id]);
  if (!a) throw new HttpError(404, "Agent not found");
  if (a.locked_strategy) throw new HttpError(409, "Strategy is locked");
  const c = await proposeImprovement(u.id, a);
  return ok({ candidate: c, message: c ? "Improvement proposed" : "No change suggested from current evidence" });
});
