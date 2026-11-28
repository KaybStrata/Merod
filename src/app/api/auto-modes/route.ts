import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { listModes, setMode, topMovers } from "@/server/auto-modes";

/** GET → the four auto switches (global + per bot/agent) and current top movers. POST → { mode, active, scope?, scopeRef?, settings? }. */
export const GET = route(async () => {
  const u = await requireUser();
  const [m, movers] = await Promise.all([listModes(u.id), topMovers(5)]);
  return ok({ ...m, movers: movers.map((x: any) => ({ symbol: x.symbol, change: Math.round(Number(x.change_24h) * 100) / 100 })) });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({
    mode: z.enum(["trainer", "gainer", "adjuster", "scanner"]),
    active: z.boolean(),
    scope: z.enum(["all", "bot", "agent"]).default("all"),
    scopeRef: z.string().uuid().optional(),
    settings: z.object({ share: z.number().min(0.01).max(1).optional(), max_mult: z.number().min(1).max(100).optional(), max_usd: z.number().min(0).max(1e7).optional() }).optional(),
  }));
  return ok(await setMode(u.id, b.mode, b.active, b.scope, b.scopeRef ?? "", b.settings));
});
