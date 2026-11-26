import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createFleet, FleetDraftSchema, listFleets } from "@/server/agents/fleets";

export const GET = route(async (req) => {
  const u = await requireUser();
  return ok({ fleets: await listFleets(u.id, new URL(req.url).searchParams.get("archived") === "1") });
});
/** Create a fleet from a reviewed draft. Everything starts pending approval: nothing runs until you approve. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`fleets:${u.id}`, 20, 60);
  const b = await parse(req, FleetDraftSchema);
  return ok(await createFleet(u.id, b, { isOwner: u.role === "super_admin" }));
});
