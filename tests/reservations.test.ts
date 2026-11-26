import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, ctx } from "./helpers";
import { one, q } from "@/server/db";
import { place, cancel, reservedCash } from "@/server/engine/engine";

async function paperAccount(userId: string) {
  return (await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId]))!;
}
const limitBuy = (usd: number, price: number) => ({ asset: { symbol: "ETH" }, side: "buy" as const, orderType: "limit" as const, notionalUsd: usd, limitPrice: price, timeInForce: "gtc" as const });

test("two concurrent sessions can't reserve the same buying power; cancelling releases it", async () => {
  const me = await newUser(); await freshPrices();
  const acct = await paperAccount(me);
  await q("UPDATE trading_accounts SET cash_balance=1000 WHERE id=$1", [acct.id]);
  const eth = (await one<any>("SELECT last_price FROM assets WHERE symbol='ETH' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  const far = Number(eth.last_price) * 0.5; // resting limit orders well below market

  // Two "sessions" each try to rest a $700 buy at the same moment against $1,000 of cash.
  const [a, b] = await Promise.all([
    place(limitBuy(700, far), { ...ctx(me), source: "bot", sourceRef: "session-a", idempotencyKey: "res-a" } as any),
    place(limitBuy(700, far), { ...ctx(me), source: "bot", sourceRef: "session-b", idempotencyKey: "res-b" } as any),
  ]);
  const statuses = [a.order.status, b.order.status].sort();
  assert.deepEqual(statuses, ["rejected", "submitted"], JSON.stringify(statuses));
  const rejected = a.order.status === "rejected" ? a.order : b.order;
  assert.match(rejected.status_reason, /INSUFFICIENT_BUYING_POWER/);
  assert.ok((await reservedCash(acct.id)) >= 700);

  // Cancelling the resting order releases its reservation; a new $700 order now fits.
  const resting = a.order.status === "submitted" ? a.order : b.order;
  await cancel(resting.id, me);
  assert.equal(await reservedCash(acct.id), 0);
  const c = await place(limitBuy(700, far), { ...ctx(me), idempotencyKey: "res-c" } as any);
  assert.equal(c.order.status, "submitted");
});

test("partial fills shrink a reservation exactly once", async () => {
  const me = await newUser(); await freshPrices();
  const acct = await paperAccount(me);
  await q("UPDATE trading_accounts SET cash_balance=1000 WHERE id=$1", [acct.id]);
  const eth = (await one<any>("SELECT last_price FROM assets WHERE symbol='ETH' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  const o = await place(limitBuy(400, Number(eth.last_price) * 0.5), { ...ctx(me), idempotencyKey: "res-p" } as any);
  const before = await reservedCash(acct.id);
  await q("UPDATE orders SET filled_quantity = quantity / 2, status='partially_filled' WHERE id=$1", [o.order.id]);
  const after = await reservedCash(acct.id);
  assert.ok(Math.abs(after - before / 2) < 0.01, `${before} → ${after}`);
});
