import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createMapInstruction } from "@/server/map";

/** New skill or point from the map. everywhere=false (default): it only affects what it's attached to on the map. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`map-instr:${u.id}`, 60, 3600);
  const b = await parse(req, z.object({ kind: z.enum(["skill", "point"]), name: z.string().max(60).default(""), text: z.string().min(3).max(2000), everywhere: z.boolean().default(false), tz: z.string().max(60).optional() }));
  return ok({ item: await createMapInstruction(u.id, b.kind, b.name, b.text, b.everywhere, b.tz) });
});
