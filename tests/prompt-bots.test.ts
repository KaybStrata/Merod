import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { q } from "@/server/db";
import { parsePrompt } from "@/server/ai/parser";
import { handlePrompt } from "@/server/ai/interpret";

test("'make a bot … buys at a 6% dip … 3% profit' is a bot, not a one-off order", () => {
  const i = parsePrompt("make a bot that hovers and watches every solona meme coin and buys at a 6% dip and sells at 3% profit");
  assert.equal(i.kind, "swing_loop");
  assert.equal(i.swing!.dip_pct, 6);
  assert.equal(i.swing!.take_profit_pct, 3);
  assert.equal(i.swing!.repeat, true);
  assert.deepEqual(i.swing!.scope, { meme: true, venue: "solana" });
  assert.equal(i.trades[0].symbol, null, "doesn't mistake 'solona' for buying SOL");
  // Without the word "sell", but it's a bot with a profit target.
  const j = parsePrompt("make a bot for ETH that buys a 4% dip and takes 2% profit");
  assert.equal(j.kind, "swing_loop");
  assert.equal(j.swing!.scope, null);
});

test("the prompt box builds a bot that watches every Solana meme coin", async () => {
  const me = await newUser(); await freshPrices();
  await q("UPDATE trading_permissions SET allow_ai_prompts=true WHERE user_id=$1", [me]);
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const prev = await q<any>("SELECT id, price_source FROM assets WHERE venue='solana' AND 'meme' = ANY(categories) AND NOT ('demo_data' = ANY(risk_flags))");
  await q("UPDATE assets SET price_source='coingecko' WHERE id = ANY($1::uuid[])", [prev.map((p) => p.id)]);
  try {
    const r1 = await handlePrompt(me, { text: "make a bot that watches every solana meme coin and buys at a 6% dip and sells at 3% profit" } as any);
    assert.equal(r1.message.plan?.type, "clarify", r1.message.content);
    const r2 = await handlePrompt(me, { text: "$50", conversationId: r1.conversationId } as any);
    const card = r2.message.plan;
    assert.equal(card?.type, "bot", r2.message.content);
    assert.equal(card.config.strategyId, "dip_rebound_loop");
    assert.equal(card.config.assetIds.length, prev.length);
    assert.equal(card.config.params.amount_usd, 50);
    assert.equal(card.config.maxTradesPerDay, null);
    assert.match(card.config.name, /Solana meme coins dip 6% → \+3% loop/);
  } finally {
    for (const p of prev) await q("UPDATE assets SET price_source=$2 WHERE id=$1", [p.id, p.price_source]);
  }
});

test("'top 20 gainers … buy 10$ each, sell at 2% profit, rinse and repeat' → one bot, buy-now loop on every coin", async () => {
  const text = 'pick the top 20 "top gainers"/profitable solona meme coins right now and buy 10$ each and sell at 2% profit, and rinse and repeat each one';
  const i = parsePrompt(text);
  assert.equal(i.kind, "swing_loop");
  assert.equal(i.swing!.dip_pct, 0);
  assert.equal(i.swing!.take_profit_pct, 2);
  assert.equal(i.swing!.repeat, true);
  assert.deepEqual(i.swing!.scope, { meme: true, venue: "solana", rank: "gainers", top: 20 });
  assert.equal(i.trades[0].amount, 10);
  assert.equal(i.trades[0].symbol, null);

  const me = await newUser(); await freshPrices();
  await q("UPDATE trading_permissions SET allow_ai_prompts=true, allow_bots=true WHERE user_id=$1", [me]);
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const coins = await q<any>("SELECT id, price_source, change_24h FROM assets WHERE venue='solana' AND 'meme' = ANY(categories) AND NOT ('demo_data' = ANY(risk_flags))");
  await q("UPDATE assets SET price_source='coingecko', change_24h=10, price_updated_at=now() WHERE id = ANY($1::uuid[])", [coins.map((p) => p.id)]);
  try {
    const r = await handlePrompt(me, { text } as any);
    const card = r.message.plan;
    assert.equal(card?.type, "bot", r.message.content);
    assert.equal(card.config.params.dip_pct, 0);
    assert.equal(card.config.params.amount_usd, 10);
    assert.equal(card.config.budgetUsd, 0, "no budget cap");
    assert.ok(card.config.assetIds.length >= 2 && card.config.assetIds.length <= 20);
    // "try now" re-runs the same request.
    const again = await handlePrompt(me, { text: "try now", conversationId: r.conversationId } as any);
    assert.equal(again.message.plan?.type, "bot", again.message.content);
  } finally {
    for (const p of coins) await q("UPDATE assets SET price_source=$2, change_24h=$3 WHERE id=$1", [p.id, p.price_source, p.change_24h]);
  }
});

test("a multi-coin buy-now loop buys every coin, and each coin keeps its own cycle", async () => {
  const { approvePlan } = await import("@/server/ai/interpret");
  const { tickDueBots } = await import("@/server/bots/runner");
  const me = await newUser(); await freshPrices();
  await q("UPDATE trading_permissions SET allow_ai_prompts=true, allow_bots=true, mode='auto_within_limits' WHERE user_id=$1", [me]);
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const coins = await q<any>("SELECT id, price_source, change_24h FROM assets WHERE venue='solana' AND 'meme' = ANY(categories) AND NOT ('demo_data' = ANY(risk_flags))");
  await q("UPDATE assets SET price_source='coingecko', change_24h=10, price_updated_at=now() WHERE id = ANY($1::uuid[])", [coins.map((p) => p.id)]);
  try {
    const r = await handlePrompt(me, { text: "buy the top 3 solana meme coin gainers $10 each and sell at 2% profit, repeat" } as any);
    assert.equal(r.message.plan?.type, "bot", r.message.content);
    const { botId } = await approvePlan(me, r.message.id);
    await q("UPDATE assets SET price_updated_at=now() WHERE id = ANY($1::uuid[])", [coins.map((p) => p.id)]);
    await tickDueBots("test-worker");
    const orders = await q<any>("SELECT asset_id, side, status FROM orders WHERE source='bot' AND source_ref=$1", [botId]);
    const n = r.message.plan.config.assetIds.length;
    assert.equal(orders.filter((o) => o.side === "buy").length, n, JSON.stringify(orders));
    const bot = await q<any>("SELECT state FROM trading_bots WHERE id=$1", [botId]);
    for (const id of r.message.plan.config.assetIds) assert.ok(bot[0].state[id]?.pendingOrderId, `coin ${id} tracks its own order`);
    // Next tick reconciles each fill → holding (per coin), no duplicate buys.
    await q("UPDATE trading_bots SET last_tick_at=NULL WHERE id=$1", [botId]);
    await q("UPDATE assets SET price_updated_at=now() WHERE id = ANY($1::uuid[])", [coins.map((p) => p.id)]);
    await tickDueBots("test-worker");
    const after = await q<any>("SELECT state FROM trading_bots WHERE id=$1", [botId]);
    const filled = orders.filter((o) => o.status === "filled").map((o) => o.asset_id);
    for (const id of filled) assert.equal(after[0].state[id].phase, "holding");
    assert.equal((await q<any>("SELECT 1 FROM orders WHERE source='bot' AND source_ref=$1 AND side='buy'", [botId])).length, n);
  } finally {
    for (const p of coins) await q("UPDATE assets SET price_source=$2, change_24h=$3 WHERE id=$1", [p.id, p.price_source, p.change_24h]);
  }
});
