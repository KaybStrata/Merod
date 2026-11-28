import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q } from "@/server/db";
import { getAuton, setAuton, runAuton } from "@/server/auton/engine";

/** GET → Auton's settings + its bots. POST → change settings ({ active, maxCapitalUsd, maxBots, everySec, realMoney, goals, tradeUsd, runNow }). */
export const GET = route(async () => {
  const u = await requireUser();
  const s = await getAuton(u.id);
  const bots = await q<any>(`SELECT b.id, b.name, b.status, b.params, b.pnl_usd FROM auton_assets a JOIN trading_bots b ON b.id::text=a.ref_id
                              WHERE a.user_id=$1 AND a.kind='bot' AND b.status <> 'archived' ORDER BY b.created_at DESC`, [u.id]);
  const agents = await q<any>(`SELECT g.id, g.name, g.status, g.capital_usd, g.realized_pnl_usd FROM auton_assets a JOIN agents g ON g.id::text=a.ref_id
                                WHERE a.user_id=$1 AND a.kind='agent' AND g.status <> 'archived' ORDER BY g.created_at DESC`, [u.id]).catch(() => []);
  return ok({ settings: { ...s, trade_usd: Number(s.memory?.trade_usd ?? 100) }, bots, agents });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ active: z.boolean().optional(), maxCapitalUsd: z.number().min(0).max(1e9).optional(), maxBots: z.number().int().min(0).max(50).optional(),
    everySec: z.number().int().min(5).max(86_400).optional(), realMoney: z.boolean().optional(), goals: z.string().max(1000).optional(), tradeUsd: z.number().min(1).max(1e7).optional(), runNow: z.boolean().optional() }));
  if (b.tradeUsd) {
    const s = await getAuton(u.id);
    await q("INSERT INTO auton_settings (user_id, memory) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET memory = auton_settings.memory || $2::jsonb", [u.id, JSON.stringify({ ...(s.memory ?? {}), trade_usd: b.tradeUsd })]);
  }
  const { tradeUsd: _t, runNow, ...rest } = b;
  const settings = Object.keys(rest).length ? await setAuton(u.id, rest) : null;
  const r = runNow ? await runAuton(u.id) : null;
  return ok({ settings, run: r });
});
