import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { fleetAction, fleetDetail } from "@/server/agents/fleets";

type Ctx = { params: Promise<{ id: string }> };
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return ok(await fleetDetail(u.id, (await params).id));
});
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  await rateLimit(`fleet-act:${u.id}`, 60, 60);
  const b = await parse(req, z.object({ action: z.enum(["approve", "pause", "resume", "stop", "emergency_stop", "close_positions", "archive", "unblock", "save_collection", "deploy_collection"]) }));
  return ok(await fleetAction(u.id, (await params).id, b.action, { isOwner: u.role === "super_admin" }));
});
