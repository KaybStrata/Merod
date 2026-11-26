import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { capitalSummary } from "@/server/agents/service";

export const GET = route(async () => {
  const u = await requireUser();
  return ok(await capitalSummary(u.id));
});
