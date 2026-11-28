import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one } from "@/server/db";
import { mapCommand } from "@/server/map-prompt";

/** The Map's own prompt bar: create, change, connect, remove, rename, run or clear things on the map by typing. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`map-cmd:${u.id}`, 60, 60);
  const b = await parse(req, z.object({ text: z.string().min(2).max(2000), tz: z.string().max(60).optional() }));
  const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [u.id]))?.role;
  const msg = await mapCommand(u.id, b.text, { isOwner: role === "super_admin", tz: b.tz, force: true });
  return ok({ message: msg ?? "Try: “create a method called Safe with stop loss 5% for all bots”, “rename Safe to Careful”, “change Safe to take profit 12%”, “remove SOL Momentum”, “run Safe”." });
});
