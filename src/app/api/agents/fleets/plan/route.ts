import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { planFleet, validateGraph } from "@/server/agents/fleets";

/** Prompt-to-Fleet step 1–3: parse and draft (no side effects). */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`fleet-plan:${u.id}`, 30, 60);
  const b = await parse(req, z.object({ prompt: z.string().min(1).max(4000) }));
  const draft = await planFleet(b.prompt);
  return ok({ draft, errors: validateGraph(draft.agents) });
});
