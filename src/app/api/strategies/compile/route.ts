import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { compile } from "@/server/lab/strategies";

/** Prompt or rule JSON → validated draft, warnings and missing fields. Never creates an order. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`compile:${u.id}`, 30, 60);
  const b = await parse(req, z.object({ text: z.string().max(2000).optional(), rules: z.unknown().optional() }));
  return ok(await compile(b));
});
