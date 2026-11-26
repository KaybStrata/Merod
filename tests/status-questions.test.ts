import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { isStatusQuestion, statusAnswer, statusSnapshot, statusPacket } from "@/server/ai/status";

test("status questions are recognised; commands and market questions are not", () => {
  for (const s of ["how are my bots doing?", "why hasn't ZERO sold yet?", "what did I buy today", "why was my order cancelled?", "status of my agents",
    "show my open orders", "what's my P&L this week?", "which coins is the meme bot holding?", "is auto trading on?", "recap my activity"])
    assert.ok(isStatusQuestion(s), s);
  for (const s of ["buy $100 of SOL", "pause all bots", "sell 25% of NVDA", "create 3 agents that trade memes", "open the bots page", "show me the bots page", "what is the price of BTC?", "why is SOL moving?"])
    assert.ok(!isStatusQuestion(s), s);
});

test("status answers name the bot's coins, buy price, move and sell target, plus order reasons", async () => {
  const u = await newUser();
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const sym = `Z${tag}`;
  const asset = (await one<any>(`INSERT INTO assets (asset_class, symbol, name, venue, identifier, last_price, price_source, price_updated_at)
     VALUES ('crypto', $1, 'Zero test', 'solana', $2, 0.0002701, 'dexscreener', now()) RETURNING id`, [sym, `test-${tag}`]))!;
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  await q(`INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, asset_ids, params, state)
           VALUES ($1, 'Meme loop', 'dip_rebound_loop', $2, 'running', ARRAY[$3::uuid], '{"take_profit_pct":20,"amount_usd":10}', $4)`,
    [u, acct.id, asset.id, JSON.stringify({ phase: "holding", entry: 0.000272, qty: 1000 })]);
  await q(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, side, order_type, quantity, is_paper, status, status_reason)
           VALUES ($1,$2,$3,'paper',gen_random_uuid()::text,'bot','buy','market',10,true,'cancelled','Auto-approve turned on: the bot re-places this order at the current price')`, [u, acct.id, asset.id]);

  const snap = await statusSnapshot(u);
  const coin = snap.bots[0].coins[0];
  assert.equal(coin.symbol, sym); assert.equal(coin.phase, "holding");
  assert.ok(Math.abs(coin.move! - (-0.7)) < 0.01, `move ${coin.move}`);
  assert.ok(Math.abs(coin.target! - 0.0003264) < 1e-9);

  const a = statusAnswer(`why hasn't ${sym} sold yet?`, snap);
  assert.match(a, /Bought at \$0\.000272, now \$0\.0002701 \(down 0\.70%\)/, a);
  assert.match(a, /Sells at \$0\.0003264/);
  assert.match(a, /no stop-loss/);
  assert.match(statusAnswer("why was my order cancelled?", snap), /Auto-approve turned on/);
  assert.match(statusAnswer("how are my bots doing?", snap), /"Meme loop" is running/);
  assert.match(statusPacket(snap), /Meme loop/);

  // Through the prompt box (no AI key in tests → answered straight from the data).
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: `how is my ${sym} trade doing?`, provider: "merod" } as any);
  assert.match(r.message.content, new RegExp(`${sym}[\\s\\S]*down 0\\.70%`), r.message.content);
});
