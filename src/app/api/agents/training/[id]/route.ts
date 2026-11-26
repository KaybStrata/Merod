import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { decideCandidate } from "@/server/agents/extras";

type Ctx = { params: Promise<{ id: string }> };
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ decision: z.enum(["approve", "reject"]) }));
  return ok(await decideCandidate(u.id, (await params).id, b.decision));
});
