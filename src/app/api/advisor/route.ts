import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { getAdvisor, setAdvisor, listTips } from "@/server/advisor";

/** GET → { settings, tips }. POST → change settings (on/off, how often, topics, notifications). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50);
  const [settings, tips] = await Promise.all([getAdvisor(u.id), listTips(u.id, limit)]);
  return ok({ settings, tips });
});

const T = z.boolean().optional();
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ active: z.boolean().optional(), everyMin: z.number().int().min(2).max(1440).optional(), notify: z.boolean().optional(),
    topics: z.object({ market: T, trades: T, bots: T, agents: T, prompts: T }).optional() }));
  return ok({ settings: await setAdvisor(u.id, b) });
});
