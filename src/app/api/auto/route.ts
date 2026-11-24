import { z } from "zod";
import { requireSuperAdmin } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { overview, saveSettings, runFor } from "@/server/auto/engine";

/** Auto trading (owner only). GET: settings, theoretical + real record, recent trades with Modo's explanations. */
export const GET = route(async () => {
  const u = await requireSuperAdmin();
  return ok(await overview(u.id));
});

// No defaults: only the fields sent are changed (zod 4 .partial() would apply defaults).
const Patch = z.object({
  enabled: z.boolean().optional(),
  accountId: z.string().uuid().nullable().optional(),
  markets: z.enum(["crypto", "stocks", "both"]).optional(),
  tradeUsd: z.number().min(1).max(1_000_000).optional(),
  maxDailyUsd: z.number().min(1).max(10_000_000).optional(),
  maxOpen: z.number().int().min(1).max(50).optional(),
  minConfidence: z.number().min(0.3).max(0.95).optional(),
  minTheoryTrades: z.number().int().min(0).max(500).optional(),
  minTheoryWinRate: z.number().min(0).max(1).optional(),
  takeProfitPct: z.number().min(0.1).max(500).optional(),
  stopLossPct: z.number().min(0.1).max(100).optional(),
}).strict();

/** Change settings or flip the on/off switch. Turning it on runs a first pass right away. */
export const PATCH = route(async (req) => {
  const u = await requireSuperAdmin();
  const b = await parse(req, Patch);
  await saveSettings(u.id, b);
  if (b.enabled) await runFor(u.id).catch(() => {});
  return ok(await overview(u.id));
});
