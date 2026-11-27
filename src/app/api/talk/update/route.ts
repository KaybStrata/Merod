import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createUpdate, listUpdates, getRecording } from "@/server/trade-updates";

/** GET → recent updates + record status. POST { hours } → analyse recent trading now and propose changes. */
export const GET = route(async () => {
  const u = await requireUser();
  const [updates, recording] = await Promise.all([listUpdates(u.id, 10), getRecording(u.id)]);
  return ok({ updates, recording });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`trade-update:${u.id}`, 30, 3600);
  const b = await parse(req, z.object({ hours: z.number().min(1).max(24 * 90).default(24) }));
  return ok({ update: await createUpdate(u.id, b.hours, "manual") });
});
