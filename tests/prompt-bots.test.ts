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
