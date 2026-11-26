import "@/lib/server-only-shim";
import { z } from "zod";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { getStrategy } from "./strategies";

export const BotConfigSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  strategyId: z.string(),
  params: z.record(z.string(), z.any()).default({}),
  assetIds: z.array(z.string().uuid()).max(1000).default([]),
  markets: z.array(z.string()).max(1000).default([]),
  accountId: z.string().uuid().optional(),
  isPaper: z.boolean().default(true),
  budgetUsd: z.number().min(0).max(1e12).default(0), // 0 = no limit
  maxPositionUsd: z.number().min(0).default(0),
  maxDailySpendUsd: z.number().min(0).default(0),
  maxDailyLossUsd: z.number().min(0).default(0),
  maxTradesPerDay: z.number().int().positive().nullable().default(null), // no daily trade-count limit by default
  minLiquidityUsd: z.number().min(0).default(50000),
  maxSlippageBps: z.number().int().min(1).max(5000).default(100),
  maxPriceDeviationPct: z.number().positive().default(5),
  profitTargetPct: z.number().positive().nullable().optional(),
  stopLossPct: z.number().positive().nullable().optional(),
  schedule: z.enum(["every_15s", "every_1m", "every_5m", "every_15m", "every_1h"]).default("every_1m"),
  approvalRequired: z.boolean().default(false),
  /** Never reject trades for risk flags / liquidity / slippage. Unset = follow your Risk setting (flagged coins blocked or not). */
  allowRisky: z.boolean().optional(),
  notify: z.object({ trades: z.boolean(), errors: z.boolean() }).default({ trades: true, errors: true }),
  createdFromPrompt: z.string().max(2000).optional(),
  start: z.boolean().default(false),
});
export type BotConfig = z.infer<typeof BotConfigSchema>;

export async function createBot(userId: string, cfg: BotConfig, actor: "user" | "ai" = "user") {
  const strat = getStrategy(cfg.strategyId);
  if (!strat) throw new HttpError(400, "Unknown strategy");
  const needsAssets = !["watchlist_monitor", "meme_discovery", "news_monitor"].includes(cfg.strategyId);
  if (needsAssets && !cfg.assetIds.length) throw new HttpError(400, "Select at least one asset");
  const account = cfg.accountId
    ? await one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [cfg.accountId, userId])
    : await one<any>("SELECT * FROM trading_accounts WHERE user_id=$1 AND kind=$2 ORDER BY created_at LIMIT 1", [userId, cfg.isPaper ? "paper" : "wallet"]);
  if (!account) throw new HttpError(400, cfg.isPaper ? "No paper account" : "Connect a live account first");
  const isPaper = account.kind === "paper" || account.metadata?.environment === "sandbox";
  const params = Object.fromEntries(strat.params.map((p) => [p.key, cfg.params[p.key] ?? p.default ?? null]));
  const allowRisky = cfg.allowRisky ?? ((await one<{ b: boolean }>("SELECT block_risky_tokens AS b FROM risk_settings WHERE user_id=$1", [userId]))?.b === false);
  const bot = await one<any>(
    `INSERT INTO trading_bots (user_id, name, description, strategy_id, params, asset_ids, markets, account_id, is_paper, status, budget_usd, max_position_usd,
       max_daily_spend_usd, max_daily_loss_usd, max_trades_per_day, min_liquidity_usd, max_slippage_bps, max_price_deviation_pct, profit_target_pct, stop_loss_pct,
       schedule, approval_required, notify, created_from_prompt, allow_risky)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
    [userId, cfg.name, cfg.description, cfg.strategyId, JSON.stringify(params), cfg.assetIds, cfg.markets, account.id, isPaper, cfg.budgetUsd, cfg.maxPositionUsd,
     cfg.maxDailySpendUsd, cfg.maxDailyLossUsd, cfg.maxTradesPerDay, cfg.minLiquidityUsd, cfg.maxSlippageBps, cfg.maxPriceDeviationPct, cfg.profitTargetPct ?? null,
     cfg.stopLossPct ?? null, cfg.schedule, cfg.approvalRequired, JSON.stringify(cfg.notify), cfg.createdFromPrompt ?? null, allowRisky]);
  await q("INSERT INTO bot_activity_logs (bot_id, level, message, data) VALUES ($1,'control',$2,$3)", [bot.id, `Created by ${actor}${isPaper ? " (paper)" : ""}`, JSON.stringify({ params })]);
  await audit({ actorType: actor, actorId: userId, userId, action: "bot.create", target: bot.id, data: { strategy: cfg.strategyId, paper: isPaper } });
  if (cfg.start) {
    const { setBotStatus } = await import("./runner");
    await setBotStatus(userId, bot.id, "start", actor);
  }
  await (await import("../skills")).applySkillsToNew(userId, "bot", bot.id, cfg.name ?? "bot").catch(() => {});
  return one<any>("SELECT * FROM trading_bots WHERE id=$1", [bot.id]);
}
