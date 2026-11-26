import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { AgentPatch, agentDetail, updateAgent } from "@/server/agents/service";

type Ctx = { params: Promise<{ id: string }> };
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return ok(await agentDetail(u.id, (await params).id));
});
/** Live prompt editing / settings: validated, versioned update. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  await rateLimit(`agent-edit:${u.id}`, 60, 60);
  const b = await parse(req, AgentPatch);
  return ok({ agent: await updateAgent(u.id, (await params).id, b, { isOwner: u.role === "super_admin" }) });
});
