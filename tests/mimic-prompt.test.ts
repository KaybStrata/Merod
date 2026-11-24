import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, ctx } from "./helpers";
import { one, q } from "@/server/db";
import { place } from "@/server/engine/engine";
import { handlePrompt, approvePlan } from "@/server/ai/interpret";
import { parseMimicRequest } from "@/server/copy/leaders";
import { assetInScope } from "@/server/copy/service";

test("mimic prompts are understood, typos included", () => {
  const a = parseMimicRequest("mimic trade the top roi earner for solona meme coins this week")!;
  assert.equal(a.windowDays, 7);
  assert.deepEqual({ venue: a.scope.venue, meme: a.scope.meme, label: a.scope.label }, { venue: "solana", meme: true, label: "Solana meme coins" });
  assert.equal(parseMimicRequest("Copy the best trader in stocks today")!.windowDays, 1);
  assert.deepEqual(parseMimicRequest("Copy the best trader in stocks today")!.scope.assetClasses, ["stock", "etf"]);
  assert.equal(parseMimicRequest("MIMIK the #1 performer on $BONK this month")!.scope.symbol, "BONK");
  assert.equal(parseMimicRequest("buy $100 of SOL"), null);
  assert.equal(parseMimicRequest("copy my last trade"), null);
  assert.ok(assetInScope({ symbol: "BONK", asset_class: "crypto", venue: "solana", categories: ["meme"] }, a.scope));
  assert.ok(!assetInScope({ symbol: "JUP", asset_class: "crypto", venue: "solana", categories: ["defi"] }, a.scope));
});

async function roundTrip(user: string, symbol: string, gain: number) {
  const before = await one<{ last_price: string }>("SELECT last_price FROM assets WHERE symbol=$1 ORDER BY market_cap DESC NULLS LAST LIMIT 1", [symbol]);
  await place({ asset: { symbol }, side: "buy", orderType: "market", notionalUsd: 100, timeInForce: "gtc" }, ctx(user));
  await q("UPDATE assets SET last_price = last_price * $2, price_updated_at=now() WHERE symbol=$1", [symbol, 1 + gain]);
  await place({ asset: { symbol }, side: "sell", orderType: "market", percentOfPosition: 100, timeInForce: "gtc" }, ctx(user));
  await q("UPDATE assets SET last_price = $2 WHERE symbol=$1", [symbol, before!.last_price]);
}

test("'mimic the top ROI earner for Solana meme coins' finds that trader and starts a scoped mimic bot", async () => {
  const memeWinner = await newUser(), ethWinner = await newUser(), me = await newUser(), other = await newUser();
  await freshPrices();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [me]);
  await q("UPDATE user_profiles SET allow_copy_trading=true WHERE user_id = ANY($1::uuid[])", [[memeWinner, ethWinner]]);
  try {
    await roundTrip(memeWinner, "BONK", 0.3);
    await roundTrip(ethWinner, "ETH", 0.9); // better ROI, but not a Solana meme coin

    const r = await handlePrompt(me, { text: "mimic trade the top roi earner for solona meme coins this week" } as any);
    const card = r.message.plan;
    assert.equal(card.type, "mimic", r.message.content);
    const handle = (await one<{ handle: string }>("SELECT handle FROM user_profiles WHERE user_id=$1", [memeWinner]))!.handle;
    assert.equal(card.handle, handle);
    assert.ok(card.roi > 0.2 && card.roi < 0.4, String(card.roi));

    const res = await approvePlan(me, r.message.id, { mimic: { maxDailyUsd: 300 } });
    const f = await one<any>("SELECT * FROM copy_follows WHERE id=$1", [res.followId]);
    assert.equal(f.follower_id, me);
    assert.equal(f.sizing, "percent");
    assert.equal(Number(f.percent), 100);
    assert.equal(Number(f.max_daily_usd), 300);
    assert.equal(f.scope.meme, true);
    assert.equal(f.scope.venue, "solana");

    // Not available to anyone but the owner.
    const denied = await handlePrompt(other, { text: "mimic the top roi earner for solana meme coins this week" } as any);
    assert.equal(denied.message.plan, null);
    assert.match(denied.message.content, /only available on the platform owner's account/);
  } finally {
    await q("UPDATE user_profiles SET allow_copy_trading=false WHERE user_id = ANY($1::uuid[])", [[memeWinner, ethWinner]]);
  }
});
