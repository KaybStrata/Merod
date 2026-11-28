import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { botTradingOn, setBotTrading } from "@/server/bots/master";

/** GET → { on } ; POST { on } → flip the master "Bot trading" switch. */
export const GET = route(async () => {
  const u = await requireUser();
  return ok({ on: await botTradingOn(u.id) });
});
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ on: z.boolean() }));
  return ok(await setBotTrading(u.id, b.on));
});
