import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one } from "@/server/db";
import { HttpError } from "@/server/errors";
import { backtest } from "@/server/bots/runner";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({
  assetId: z.string().uuid().optional(),
  timeframe: z.enum(["1h", "1d"]).default("1h"),
  params: z.record(z.string(), z.any()).optional(),
  feeBps: z.number().min(0).max(500).default(30),
  slippageBps: z.number().min(0).max(1000).default(10),
  startCash: z.number().positive().max(10_000_000).default(10000),
});

/** Runs the bot's strategy over stored historical bars (simulated history is flagged in the result). */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  await rateLimit(`backtest:${u.id}`, 20, 60);
  const { id } = await params;
  const bot = await one<any>("SELECT * FROM trading_bots WHERE id=$1 AND user_id=$2", [id, u.id]);
  if (!bot) throw new HttpError(404, "Bot not found");
  const b = await parse(req, Body);
  const assetId = b.assetId ?? bot.asset_ids[0];
  if (!assetId) throw new HttpError(400, "This bot has no asset to backtest (monitoring strategies can't be backtested)");
  if (["watchlist_monitor", "meme_discovery", "news_monitor", "volume_liquidity_monitor", "rebalance"].includes(bot.strategy_id))
    throw new HttpError(400, "Backtesting is available for trading strategies (dip loop, DCA, triggers, SMA, stop guards)");
  try {
    const result = await backtest(bot.strategy_id, assetId, { ...bot.params, ...(b.params ?? {}) }, { timeframe: b.timeframe, feeBps: b.feeBps, slippageBps: b.slippageBps, startCash: b.startCash });
    await one("INSERT INTO bot_runs (bot_id, kind, ended_at, result) VALUES ($1,'backtest',now(),$2) RETURNING id",
      [id, JSON.stringify({ returnPct: result.returnPct, maxDrawdownPct: result.maxDrawdownPct, tradeCount: result.tradeCount, winRate: result.winRate, dataWarning: result.dataWarning })]);
    return ok({ result });
  } catch (e: any) { throw new HttpError(400, e.message); }
});

/** Vercel: allow slow AI / backtest / provider calls. */
export const maxDuration = 60;
