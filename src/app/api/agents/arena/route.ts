import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createCompetition, listCompetitions } from "@/server/agents/extras";

export const GET = route(async () => {
  const u = await requireUser();
  return ok({ competitions: await listCompetitions(u.id) });
});
/** New paper competition: same asset, same capital, different strategies. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`arena:${u.id}`, 10, 60);
  const b = await parse(req, z.object({ name: z.string().min(1).max(80), asset: z.string().min(1).max(24), strategies: z.array(z.string()).min(2).max(8), capitalEach: z.number().positive().max(1_000_000), days: z.number().int().min(1).max(365) }));
  return ok(await createCompetition(u.id, b, u.role === "super_admin"));
});
