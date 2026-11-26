import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { listEvents } from "@/server/agents/service";

/** Live agent activity (filter by agent, fleet, kind; paginate with before). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  return ok({ events: await listEvents(u.id, { agentId: sp.get("agent"), fleetId: sp.get("fleet"), kind: kind && kind !== "all" ? kind : null, before: sp.get("before") ? Number(sp.get("before")) : null, limit: Number(sp.get("limit") ?? 60) }) });
});
