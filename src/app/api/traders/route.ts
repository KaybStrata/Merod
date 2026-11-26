import { z } from "zod";
import { requireUser } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { ok, parse, rateLimit, route } from "@/server/http";
import { directory, mimicMany, mimicTokenTraders, mimicSettings } from "@/server/copy/directory";

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
  const Opts = { live: z.boolean().default(false), perTradeUsd: z.number().positive().max(1e12).nullable().optional(), maxDailyUsd: z.number().min(0).max(1e12).nullable().optional() };
  const b = await parse(req, z.union([
    z.object({ group: z.enum(["wallets", "merod", "stocks"]), on: z.boolean(), targets: z.array(z.string().min(1).max(60)).min(1).max(500), ...Opts }),
    z.object({ token: z.string().uuid(), count: z.number().int().min(1).max(100).default(3), onlyThisToken: z.boolean().default(false), ...Opts }),
  ]));
  const opts = { live: b.live, perTradeUsd: b.perTradeUsd ?? null, maxDailyUsd: b.maxDailyUsd ?? null };
  if ("token" in b) return ok(await mimicTokenTraders(u.id, b.token, b.count, b.onlyThisToken, opts));
  if (!b.on) return ok(await mimicMany(u.id, b.group, false, b.targets));
  const { settings, note } = await mimicSettings(u.id, b.group === "stocks" ? "stock" : "crypto", opts);
  return ok({ ...(await mimicMany(u.id, b.group, true, b.targets, null, settings)), account: note });
});
