import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { analytics } from "@/server/agents/extras";

export const GET = route(async () => {
  const u = await requireUser();
  return ok(await analytics(u.id));
});
