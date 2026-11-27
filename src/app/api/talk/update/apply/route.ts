import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one } from "@/server/db";
import { applyDecision } from "@/server/trade-updates";

/** The user pressed Apply on a suggestion (or Apply all, one call per suggestion). */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ id: z.number().int().positive(), index: z.number().int().min(0).max(200) }));
  const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [u.id]))?.role;
  return ok(await applyDecision(u.id, b.id, b.index, role === "super_admin"));
});
