import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, assetId, closePool } from "./helpers";
import { one, q } from "@/server/db";
import { handlePrompt, approvePlan } from "@/server/ai/interpret";
import { tickDueBots, emergencyStop, backtest } from "@/server/bots/runner";

test("prompt in manual mode produces an approval card, approval executes through the engine", async () => {
  const u = await newUser(); await freshPrices();
  const r = await handlePrompt(u, { text: "Buy $100 worth of Solana", provider: "merod" });
  assert.equal(r.message.status, "needs_approval");
  assert.equal(r.message.plan.type, "order");
  const res = await approvePlan(u, r.message.id);
  assert.equal(res.status, "filled");
  await assert.rejects(approvePlan(u, r.message.id), /already/); // can't approve twice
});

test("prompt auto-executes within permissions (auto_within_limits) and rejects above limits", async () => {
  const u = await newUser({ mode: "auto_within_limits" }); await freshPrices();
  const ok = await handlePrompt(u, { text: "Buy $50 of ETH", provider: "merod" });
  assert.equal(ok.message.status, "executed");
  const over = await handlePrompt(u, { text: "Buy $500 of ETH", provider: "merod" });
  assert.equal(over.message.status, "rejected");
});

test("rinse-and-repeat prompt: no amount → default $100 (no question), creates a running paper dip-loop bot, bot ticks and logs", async () => {
  const u = await newUser(); await freshPrices();
  const sol = await assetId("SOL", "solana");
  const second = await handlePrompt(u, { text: "buy at 3% dip and sell at 5% increase, and then rinse and repeat", screenAssetId: sol, provider: "merod" });
  assert.equal(second.message.plan.type, "bot", second.message.content);
  assert.equal(Number(second.message.plan.config.params.amount_usd), 100);
  assert.equal(second.message.plan.config.strategyId, "dip_rebound_loop");
  assert.equal(second.message.plan.config.params.repeat, true);
  const { botId } = await approvePlan(u, second.message.id);
  const bot = await one<any>("SELECT * FROM trading_bots WHERE id=$1", [botId]);
  assert.equal(bot.status, "running"); assert.equal(bot.is_paper, true);
  await tickDueBots("test-worker");
  const logs = await q<any>("SELECT level, message FROM bot_activity_logs WHERE bot_id=$1", [botId]);
  assert.ok(logs.some((l) => l.level === "observation"));
  // force a 3%+ dip from the tracked high → the bot should submit a buy through the engine
  const px = (await one<any>("SELECT last_price FROM assets WHERE id=$1", [sol])).last_price;
  await q("UPDATE assets SET last_price=$2, price_updated_at=now() WHERE id=$1", [sol, px * 0.96]);
  await q("UPDATE trading_bots SET last_tick_at=NULL WHERE id=$1", [botId]);
  await tickDueBots("test-worker");
  const orders = await q<any>("SELECT status, side FROM orders WHERE source='bot' AND source_ref=$1", [botId]);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, "buy");
  assert.equal(orders[0].status, "pending_approval"); // manual mode → bot orders wait for approval
  await q("UPDATE assets SET last_price=$2 WHERE id=$1", [sol, px]);
  const res = await emergencyStop(u);
  assert.ok(res.cancelled >= 1);
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [botId])).status, "halted");
});

test("pause all bots is immediate; cancel all needs confirmation", async () => {
  const u = await newUser(); await freshPrices();
  const r = await handlePrompt(u, { text: "Pause all my active trading bots", provider: "merod" });
  assert.equal(r.message.status, "executed");
  await handlePrompt(u, { text: "Buy $10 of SOL at limit 1", provider: "merod" }).then((m) => approvePlan(u, m.message.id)).catch(() => {});
  const c = await handlePrompt(u, { text: "Cancel all my open orders", provider: "merod" });
  assert.ok(["needs_approval", "info"].includes(c.message.status));
});

test("backtest runs on stored history and flags simulated data", async () => {
  const sol = await assetId("SOL", "solana");
  const r = await backtest("dip_rebound_loop", sol, { amount_usd: 1000, dip_pct: 3, take_profit_pct: 5, repeat: true }, { timeframe: "1h" });
  assert.ok(r.bars > 100);
  assert.ok(r.dataWarning);
  assert.ok(Number.isFinite(r.returnPct));
});

test.after(closePool);
