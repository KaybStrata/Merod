import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, ctx } from "./helpers";
import { one, q } from "@/server/db";
import { place } from "@/server/engine/engine";
import { createFollow, processCopyTrading } from "@/server/copy/service";

const SETTINGS = { sizing: "fixed" as const, fixedUsd: 25, percent: 10, maxTradeUsd: 100, maxDailyUsd: 60, copySells: true, includeExternal: false, includePaper: true };

test("copy bot mirrors a consenting trader's buys and sells into the follower's paper account", async () => {
  const leader = await newUser(), me = await newUser(); await freshPrices();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [me]);
  const handle = (await one<{ handle: string }>("SELECT handle FROM user_profiles WHERE user_id=$1", [leader]))!.handle;
  await assert.rejects(createFollow(me, { kind: "user", handle }, SETTINGS), /hasn't allowed copy trading/);
  await q("UPDATE user_profiles SET allow_copy_trading=true WHERE user_id=$1", [leader]);
  const followId = await createFollow(me, { kind: "user", handle }, SETTINGS);
  await q("UPDATE copy_follows SET created_at = now() - interval '1 minute' WHERE id=$1", [followId]);

  await place({ asset: { symbol: "ETH" }, side: "buy", orderType: "market", notionalUsd: 90, timeInForce: "gtc" }, ctx(leader));
  await processCopyTrading();
  const ev = await one<any>("SELECT * FROM copy_trade_events WHERE follow_id=$1 AND side='buy'", [followId]);
  assert.equal(ev.status, "copied", ev.reason);
  assert.equal(Number(ev.copy_notional), 25);
  const mine = await one<any>("SELECT o.source, o.status, o.notional_usd FROM orders o WHERE o.user_id=$1 AND o.source='copy'", [me]);
  assert.equal(mine.status, "filled");

  // Leader sells everything → follower closes the copied position.
  await q("UPDATE copy_follows SET last_checked_at=NULL WHERE id=$1", [followId]);
  await place({ asset: { symbol: "ETH" }, side: "sell", orderType: "market", percentOfPosition: 100, timeInForce: "gtc" }, ctx(leader));
  await processCopyTrading();
  const sell = await one<any>("SELECT * FROM copy_trade_events WHERE follow_id=$1 AND side='sell'", [followId]);
  assert.equal(sell.status, "copied", sell.reason);
  const pos = await one<any>("SELECT COALESCE(sum(quantity),0) AS q FROM positions WHERE user_id=$1", [me]);
  assert.ok(Number(pos.q) < 1e-9);
});

test("copy bots respect the daily limit and stop when the trader withdraws consent", async () => {
  const leader = await newUser(), me = await newUser(); await freshPrices();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [me]);
  await q("UPDATE user_profiles SET allow_copy_trading=true WHERE user_id=$1", [leader]);
  const handle = (await one<{ handle: string }>("SELECT handle FROM user_profiles WHERE user_id=$1", [leader]))!.handle;
  const followId = await createFollow(me, { kind: "user", handle }, SETTINGS);
  await q("UPDATE copy_follows SET created_at = now() - interval '1 minute' WHERE id=$1", [followId]);
  for (const sym of ["SOL", "BTC", "ETH"]) {
    await place({ asset: { symbol: sym }, side: "buy", orderType: "market", notionalUsd: 20, timeInForce: "gtc" }, ctx(leader));
  }
  await processCopyTrading();
  const rows = await q<any>("SELECT status, reason FROM copy_trade_events WHERE follow_id=$1 ORDER BY id", [followId]);
  assert.deepEqual(rows.map((r) => r.status), ["copied", "copied", "skipped"]); // 25 + 25 = 50; a third would pass the $60 daily cap
  assert.match(rows[2].reason, /Daily copy limit/);
  await q("UPDATE user_profiles SET allow_copy_trading=false WHERE user_id=$1", [leader]);
  await q("UPDATE copy_follows SET last_checked_at=NULL WHERE id=$1", [followId]);
  await place({ asset: { symbol: "SOL" }, side: "buy", orderType: "market", notionalUsd: 20, timeInForce: "gtc" }, ctx(leader));
  await processCopyTrading();
  assert.equal((await q("SELECT 1 FROM copy_trade_events WHERE follow_id=$1", [followId])).length, 3);
});

test("copy & mimic trading only run for the super admin", async () => {
  const leader = await newUser(), someone = await newUser(); await freshPrices();
  await q("UPDATE user_profiles SET allow_copy_trading=true WHERE user_id=$1", [leader]);
  const handle = (await one<{ handle: string }>("SELECT handle FROM user_profiles WHERE user_id=$1", [leader]))!.handle;
  const followId = await createFollow(someone, { kind: "user", handle }, SETTINGS);
  await q("UPDATE copy_follows SET created_at = now() - interval '1 minute' WHERE id=$1", [followId]);
  await place({ asset: { symbol: "SOL" }, side: "buy", orderType: "market", notionalUsd: 20, timeInForce: "gtc" }, ctx(leader));
  await processCopyTrading();
  assert.equal((await q("SELECT 1 FROM copy_trade_events WHERE follow_id=$1", [followId])).length, 0);
});
