import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { createStrategy, listStrategies } from "@/server/lab/strategies";

export const GET = route(async () => {
  const u = await requireUser();
  return ok({ strategies: await listStrategies(u.id) });
});

/** Save a compiled draft as version 1 of a new strategy. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ rules: z.unknown(), sourcePrompt: z.string().max(2000).optional() }));
  return ok(await createStrategy(u.id, b.rules, b.sourcePrompt));
});
