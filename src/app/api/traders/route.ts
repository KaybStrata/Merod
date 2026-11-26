import { z } from "zod";
import { requireUser } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { ok, parse, rateLimit, route } from "@/server/http";
import { directory, mimicMany } from "@/server/copy/directory";

/**
 * Trader directory. GET: public wallets, Merod traders and stock traders with stats (anyone signed in).
 * POST: Mimic switch for one or many targets (owner only, like all copy/mimic trading).
 */
const PERIODS = ["today", "1h", "4h", "12h", "24h", "7d"] as const;
export const GET = route(async (req) => {
  const u = await requireUser();
  const p = new URL(req.url).searchParams.get("period") as (typeof PERIODS)[number] | null;
  return ok({ ...(await directory(u.id, p && PERIODS.includes(p) ? p : "today")), canMimic: u.role === "super_admin" });
});
export const POST = route(async (req) => {
  const u = await requireUser();
  if (u.role !== "super_admin") throw new HttpError(403, "Mimic trading is available to the owner account only");
  await rateLimit(`mimic-many:${u.id}`, 20, 60);
  const b = await parse(req, z.object({ group: z.enum(["wallets", "merod", "stocks"]), on: z.boolean(), targets: z.array(z.string().min(1).max(60)).min(1).max(60) }));
  return ok(await mimicMany(u.id, b.group, b.on, b.targets));
});
