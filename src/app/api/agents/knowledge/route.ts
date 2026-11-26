import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { listKnowledge } from "@/server/agents/service";

export const GET = route(async () => {
  const u = await requireUser();
  return ok({ knowledge: await listKnowledge(u.id) });
});
