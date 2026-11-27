import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one } from "@/server/db";
import { runMap } from "@/server/map";

type Ctx = { params: Promise<{ id: string }> };

/** Run the whole map, or one method / bot / agent / prompt on it ({ nodeId }). */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  await rateLimit(`map-run:${u.id}`, 20, 60);
  const b = await parse(req, z.object({ nodeId: z.string().max(80).optional(), tz: z.string().max(60).optional() }));
  const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [u.id]))?.role;
  return ok(await runMap(u.id, id, { nodeId: b.nodeId, isOwner: role === "super_admin", tz: b.tz }));
});

export const maxDuration = 60;
