import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";
import { setBotStatus } from "@/server/bots/runner";
import { getStrategy } from "@/server/bots/strategies";

type Ctx = { params: Promise<{ id: string }> };

async function own(userId: string, id: string) {
  const b = await one<any>(
    `SELECT b.*, s.name AS strategy_name, t.label AS account_label, t.kind AS account_kind FROM trading_bots b JOIN bot_strategies s ON s.id=b.strategy_id
       JOIN trading_accounts t ON t.id=b.account_id WHERE b.id=$1 AND b.user_id=$2`, [id, userId]);
  if (!b) throw new HttpError(404, "Bot not found");
  return b;
}

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const bot = await own(u.id, id);
  const [assets, orders, stats] = await Promise.all([
    q("SELECT id, symbol, name, venue, last_price, change_24h, price_source FROM assets WHERE id = ANY($1)", [bot.asset_ids]),
    q(`SELECT o.id, o.side, o.order_type, o.quantity, o.notional_usd, o.status, o.status_reason, o.filled_quantity, o.avg_fill_price, o.fees_usd, o.realized_pnl,
              o.is_paper, o.created_at, a.symbol FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.source='bot' AND o.source_ref=$1 ORDER BY o.created_at DESC LIMIT 100`, [id]),
    one<any>(`SELECT count(*) FILTER (WHERE status='filled')::int AS filled, count(*) FILTER (WHERE status IN ('rejected','failed'))::int AS rejected,
                     count(*) FILTER (WHERE status='pending_approval')::int AS pending, COALESCE(SUM(fees_usd),0) AS fees,
                     count(*) FILTER (WHERE side='sell' AND status='filled' AND realized_pnl > 0)::int AS wins,
                     count(*) FILTER (WHERE side='sell' AND status='filled' AND realized_pnl <= 0)::int AS losses
                FROM orders WHERE source='bot' AND source_ref=$1`, [id]),
  ]);
  // Unrealized P&L attributed to THIS bot only (its own fills), not the whole account position.
  const unreal = await one<any>(
    `WITH f AS (
       SELECT o.asset_id,
              SUM(CASE WHEN o.side='buy' THEN e.quantity ELSE 0 END) AS bq,
              SUM(CASE WHEN o.side='buy' THEN e.quantity*e.price + e.fee_usd ELSE 0 END) AS bcost,
              SUM(CASE WHEN o.side='sell' THEN e.quantity ELSE 0 END) AS sq
         FROM executions e JOIN orders o ON o.id=e.order_id
        WHERE o.source='bot' AND o.source_ref=$1 GROUP BY o.asset_id)
     SELECT COALESCE(SUM(GREATEST(f.bq - f.sq, 0) * (a.last_price - f.bcost / NULLIF(f.bq,0))),0) AS u
       FROM f JOIN assets a ON a.id=f.asset_id`, [id]);
  return ok({ bot, strategy: getStrategy(bot.strategy_id) && { ...getStrategy(bot.strategy_id), decide: undefined }, assets, orders, stats: { ...stats, unrealized: unreal?.u ?? 0 } });
});

/** POST {action} — start/pause/resume/stop. */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const { action } = await parse(req, z.object({ action: z.enum(["start", "pause", "resume", "stop"]) }));
  try { await setBotStatus(u.id, id, action); }
  catch (e: any) { throw new HttpError(400, e.message); }
  return ok({ bot: await own(u.id, id) });
});

const Patch = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  params: z.record(z.string(), z.any()).optional(),
  budgetUsd: z.number().positive().optional(),
  maxPositionUsd: z.number().positive().optional(),
  maxDailySpendUsd: z.number().positive().optional(),
  maxDailyLossUsd: z.number().positive().optional(),
  maxTradesPerDay: z.number().int().positive().nullable().optional(),
  minLiquidityUsd: z.number().min(0).optional(),
  maxSlippageBps: z.number().int().min(1).max(5000).optional(),
  schedule: z.enum(["every_15s", "every_1m", "every_5m", "every_15m", "every_1h"]).optional(),
  approvalRequired: z.boolean().optional(),
});
const COLS: Record<string, string> = { name: "name", description: "description", budgetUsd: "budget_usd", maxPositionUsd: "max_position_usd", maxDailySpendUsd: "max_daily_spend_usd",
  maxDailyLossUsd: "max_daily_loss_usd", maxTradesPerDay: "max_trades_per_day", minLiquidityUsd: "min_liquidity_usd", maxSlippageBps: "max_slippage_bps", schedule: "schedule", approvalRequired: "approval_required" };

/** PATCH — edit configuration; only while the bot is not running. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const bot = await own(u.id, id);
  if (bot.status === "running") throw new HttpError(409, "Pause the bot before editing its configuration");
  const b = await parse(req, Patch);
  const sets: string[] = []; const vals: unknown[] = [id];
  for (const [k, col] of Object.entries(COLS)) if ((b as any)[k] !== undefined) { vals.push((b as any)[k]); sets.push(`${col}=$${vals.length}`); }
  if (b.params) {
    const strat = getStrategy(bot.strategy_id)!;
    const allowed = new Set(strat.params.map((p) => p.key));
    const clean = Object.fromEntries(Object.entries(b.params).filter(([k]) => allowed.has(k)));
    vals.push(JSON.stringify({ ...bot.params, ...clean })); sets.push(`params=$${vals.length}`);
  }
  if (!sets.length) return ok({ bot });
  await q(`UPDATE trading_bots SET ${sets.join(", ")}, updated_at=now() WHERE id=$1`, vals);
  await q("INSERT INTO bot_activity_logs (bot_id, level, message, data) VALUES ($1,'control','Configuration updated',$2)", [id, JSON.stringify(b)]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "bot.update", target: id, data: b });
  return ok({ bot: await own(u.id, id) });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const bot = await own(u.id, id);
  if (bot.status === "running") throw new HttpError(409, "Stop the bot before deleting it");
  await q("DELETE FROM trading_bots WHERE id=$1 AND user_id=$2", [id, u.id]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "bot.delete", target: id });
  return ok({ ok: true });
});
