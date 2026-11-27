import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one } from "@/server/db";
import { actOnTip } from "@/server/advisor";

type Ctx = { params: Promise<{ id: string }> };
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const b = await parse(req, z.object({ action: z.enum(["apply", "dismiss"]), tz: z.string().max(60).optional() }));
  const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [u.id]))?.role;
  return ok(await actOnTip(u.id, Number(id), b.action, { isOwner: role === "super_admin", tz: b.tz }));
});
