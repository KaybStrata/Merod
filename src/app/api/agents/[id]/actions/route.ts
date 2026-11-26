import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { agentAction } from "@/server/agents/service";

type Ctx = { params: Promise<{ id: string }> };
/** approve / reject / start / pause / resume / stop / archive / cancel_orders / close_positions / fork. */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  await rateLimit(`agent-act:${u.id}`, 120, 60);
  const b = await parse(req, z.object({ action: z.enum(["approve", "reject", "start", "pause", "resume", "stop", "archive", "cancel_orders", "close_positions", "fork"]), expectedRevision: z.number().int().min(1).optional(), reason: z.string().max(300).optional() }));
  return ok({ agent: await agentAction(u.id, (await params).id, b.action, { expectedRevision: b.expectedRevision, reason: b.reason, isOwner: u.role === "super_admin" }) });
});
