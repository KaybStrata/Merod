import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { setRecording } from "@/server/trade-updates";

/** Record on/off: keep analysing trades every N minutes until turned off; optionally auto-apply safe (risk-reducing) changes. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ active: z.boolean(), everyMin: z.number().int().min(5).max(1440).optional(), autoApply: z.boolean().optional() }));
  return ok({ recording: await setRecording(u.id, b) });
});
