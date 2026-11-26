import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { q } from "@/server/db";
import { splitInstructions } from "@/server/ai/multi";
import { handlePrompt } from "@/server/ai/interpret";

test("one prompt with many instructions is split; single compound instructions are not", () => {
  assert.deepEqual(splitInstructions("buy $50 of SOL and $20 of BONK, mimic the top 20 crypto traders this week, then make a bot that buys ETH at a 3% dip and sells at 5% profit and create 5 agents that trade solana meme coins"),
    ["buy $50 of SOL", "buy $20 of BONK", "mimic the top 20 crypto traders this week", "make a bot that buys ETH at a 3% dip and sells at 5% profit", "create 5 agents that trade solana meme coins"]);
  assert.deepEqual(splitInstructions("1. buy $25 of NVDA\n2. sell 50% of TSLA\n3. alert me when BTC drops 5%"), ["buy $25 of NVDA", "sell 50% of TSLA", "alert me when BTC drops 5%"]);
  assert.deepEqual(splitInstructions("sell all my BONK and buy $200 of JUP"), ["sell all my BONK", "buy $200 of JUP"]);
  for (const one of ["buy at a 3% dip and sell at 5% increase, rinse and repeat", "buy $100 of SOL and sell it at 5% profit", "mimic the top 50 stock and crypto traders this week",
    'pick the top 20 "top gainers"/profitable solona meme coins right now and buy 10$ each and sell at 2% profit, and rinse and repeat each one'])
    assert.equal(splitInstructions(one).length, 1, one);
});

test("a multi-instruction prompt runs every instruction and returns one reply each", async () => {
  const me = await newUser(); await freshPrices();
  await q("UPDATE trading_permissions SET allow_ai_prompts=true, mode='auto_within_limits' WHERE user_id=$1", [me]);
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const r: any = await handlePrompt(me, { text: "buy $10 of SOL and $15 of BTC, then create a strategy that buys SOL on a 4% dip and takes 6% profit, $50 per trade" });
  assert.equal(r.messages.length, 3, r.messages.map((m: any) => m.content).join(" | "));
  assert.match(r.messages[0].content, /^1\/3 · buy \$10 of SOL/);
  assert.match(r.messages[1].content, /^2\/3 · buy \$15 of BTC/);
  assert.match(r.messages[2].content, /^3\/3 · create a strategy/);
  assert.ok((await q("SELECT 1 FROM strategies WHERE user_id=$1", [me])).length >= 1, r.messages[2].content);
});

test("a prompt can create agents (a paper fleet waiting for approval) alongside other instructions", async () => {
  const me = await newUser(); await freshPrices();
  await q("UPDATE trading_permissions SET allow_ai_prompts=true WHERE user_id=$1", [me]);
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const r: any = await handlePrompt(me, { text: "create 3 agents that trade solana meme coins; buy $10 of SOL" });
  assert.equal(r.messages.length, 2);
  assert.match(r.messages[0].content, /Created fleet/, r.messages[0].content);
  assert.ok((await q("SELECT 1 FROM agents WHERE user_id=$1", [me])).length >= 1);
});
