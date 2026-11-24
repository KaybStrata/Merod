import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newUser, freshPrices, assetId, ctx, closePool } from "./helpers";
import { one, q } from "@/server/db";
import { preview, place, processPaperTriggers, cancel } from "@/server/engine/engine";
import { invalidateFlags } from "@/server/flags";

test("manual paper buy: preview requires confirmation, place fills and updates cash/position", async () => {
  const u = await newUser(); await freshPrices();
  const sol = await assetId("SOL", "solana");
  const intent = { asset: { assetId: sol }, side: "buy" as const, orderType: "market" as const, notionalUsd: 100, timeInForce: "gtc" as const };
  const plan = await preview(intent, ctx(u, { userConfirmed: false }));
  assert.equal(plan.decision, "pending_approval");
  assert.ok(plan.isPaper);
  assert.ok(plan.quote && plan.quote.simulated);
  const before = await one<any>("SELECT cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]);
  const { order } = await place(intent, ctx(u));
  assert.equal(order.status, "filled");
  const after = await one<any>("SELECT cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]);
  assert.ok(before.cash_balance - after.cash_balance > 99 && before.cash_balance - after.cash_balance < 102);
  const pos = await one<any>("SELECT quantity FROM positions WHERE user_id=$1 AND asset_id=$2", [u, sol]);
  assert.ok(pos.quantity > 0);
  const audits = await q("SELECT action FROM audit_logs WHERE user_id=$1 AND target=$2", [u, order.id]);
  assert.ok(audits.some((a: any) => a.action === "order.fill"));
});

test("idempotency: replaying a key never double-executes", async () => {
  const u = await newUser(); await freshPrices();
  const c = ctx(u);
  const intent = { asset: { symbol: "ETH" }, side: "buy" as const, orderType: "market" as const, notionalUsd: 50, timeInForce: "gtc" as const };
  const a = await place(intent, c);
  const b = await place(intent, c);
  assert.equal(a.order.id, b.order.id);
  assert.equal(b.replayed, true);
  const n = await one<any>("SELECT count(*)::int AS n FROM executions e JOIN orders o ON o.id=e.order_id WHERE o.user_id=$1", [u]);
  assert.equal(n.n, 1);
});

test("risk limits: max order size and selling more than held are rejected", async () => {
  const u = await newUser(); await freshPrices();
  const big = await place({ asset: { symbol: "AAPL" }, side: "buy", orderType: "market", notionalUsd: 5000, timeInForce: "gtc" }, ctx(u));
  assert.equal(big.order.status, "rejected");
  assert.match(big.order.status_reason, /limit/i);
  const oversell = await place({ asset: { symbol: "AAPL" }, side: "sell", orderType: "market", quantity: 10, timeInForce: "gtc" }, ctx(u));
  assert.equal(oversell.order.status, "rejected");
});

test("stale prices are rejected", async () => {
  const u = await newUser(); await freshPrices();
  const id = await assetId("MSFT");
  await q("UPDATE assets SET price_updated_at = now() - interval '10 minutes' WHERE id=$1", [id]);
  const r = await place({ asset: { assetId: id }, side: "buy", orderType: "market", notionalUsd: 20, timeInForce: "gtc" }, ctx(u));
  assert.equal(r.order.status, "rejected");
  assert.match(r.order.status_reason, /stale/i);
  await freshPrices();
});

test("ambiguous tickers require disambiguation; demo tokens never match by symbol", async () => {
  const u = await newUser(); await freshPrices();
  await assert.rejects(preview({ asset: { symbol: "DEMOCAT" }, side: "buy", orderType: "market", notionalUsd: 5, timeInForce: "gtc" }, ctx(u)), /No asset/);
});

test("real money stays disabled: live mode without approvals cannot trade", async () => {
  const u = await newUser(); await freshPrices();
  await q("UPDATE users SET trading_mode='live' WHERE id=$1", [u]);
  await assert.rejects(preview({ asset: { symbol: "SOL" }, side: "buy", orderType: "market", notionalUsd: 10, timeInForce: "gtc" }, ctx(u)), /Connect a solana wallet/);
  // even with a wallet account, the live flag + provider checks block execution
  await q("INSERT INTO trading_accounts (user_id, kind, provider_id, label, network, external_ref) VALUES ($1,'wallet','privy','Test wallet','solana','11111111111111111111111111111111')", [u]);
  const p = await preview({ asset: { symbol: "SOL" }, side: "buy", orderType: "market", notionalUsd: 10, timeInForce: "gtc" }, ctx(u));
  assert.equal(p.decision, "rejected");
  assert.ok(p.checks.some((c) => c.name === "live_flag" && !c.ok));
  assert.ok(p.checks.some((c) => c.name === "price_real" && !c.ok)); // simulated price can't drive real money
});

test("global trading halt blocks all orders", async () => {
  const u = await newUser(); await freshPrices();
  await q("UPDATE feature_flags SET enabled=true WHERE key='global_trading_halt'"); invalidateFlags();
  try {
    const r = await place({ asset: { symbol: "SOL" }, side: "buy", orderType: "market", notionalUsd: 10, timeInForce: "gtc" }, ctx(u));
    assert.equal(r.order.status, "rejected");
  } finally { await q("UPDATE feature_flags SET enabled=false WHERE key='global_trading_halt'"); invalidateFlags(); }
});

test("paper limit order rests, then fills when price crosses; cancel works", async () => {
  const u = await newUser(); await freshPrices();
  const id = await assetId("NVDA");
  const px = (await one<any>("SELECT last_price FROM assets WHERE id=$1", [id])).last_price;
  const { order } = await place({ asset: { assetId: id }, side: "buy", orderType: "limit", limitPrice: +(px * 0.98).toFixed(2), notionalUsd: 100, timeInForce: "gtc" }, ctx(u));
  assert.equal(order.status, "submitted");
  await q("UPDATE assets SET last_price=$2, price_updated_at=now() WHERE id=$1", [id, px * 0.97]);
  await processPaperTriggers();
  assert.equal((await one<any>("SELECT status FROM orders WHERE id=$1", [order.id])).status, "filled");
  const { order: o2 } = await place({ asset: { assetId: id }, side: "buy", orderType: "limit", limitPrice: +(px * 0.5).toFixed(2), notionalUsd: 50, timeInForce: "gtc" }, ctx(u));
  await cancel(o2.id, u);
  assert.equal((await one<any>("SELECT status FROM orders WHERE id=$1", [o2.id])).status, "cancelled");
  await q("UPDATE assets SET last_price=$2 WHERE id=$1", [id, px]);
});

test("bracket: take-profit / stop-loss legs are created after entry fills (OCO)", async () => {
  const u = await newUser(); await freshPrices();
  const id = await assetId("AMD");
  const px = (await one<any>("SELECT last_price FROM assets WHERE id=$1", [id])).last_price;
  const { order } = await place({ asset: { assetId: id }, side: "buy", orderType: "market", notionalUsd: 100, takeProfit: px * 1.1, stopLoss: px * 0.9, timeInForce: "gtc" }, ctx(u));
  const legs = await q<any>("SELECT order_type, status FROM orders WHERE parent_order_id=$1", [order.id]);
  assert.equal(legs.length, 2);
  await q("UPDATE assets SET last_price=$2, price_updated_at=now() WHERE id=$1", [id, px * 1.12]);
  await processPaperTriggers();
  const after = await q<any>("SELECT order_type, status FROM orders WHERE parent_order_id=$1 ORDER BY order_type", [order.id]);
  assert.deepEqual(after.map((l) => l.status).sort(), ["cancelled", "filled"]);
  await q("UPDATE assets SET last_price=$2 WHERE id=$1", [id, px]);
});

test("percent-of-position sell", async () => {
  const u = await newUser(); await freshPrices();
  await place({ asset: { symbol: "TSLA" }, side: "buy", orderType: "market", notionalUsd: 400, timeInForce: "gtc" }, ctx(u));
  const before = (await one<any>("SELECT quantity FROM positions WHERE user_id=$1", [u])).quantity;
  const r = await place({ asset: { symbol: "TSLA" }, side: "sell", orderType: "market", percentOfPosition: 25, timeInForce: "gtc" }, ctx(u));
  assert.equal(r.order.status, "filled");
  const after = (await one<any>("SELECT quantity FROM positions WHERE user_id=$1", [u])).quantity;
  assert.ok(Math.abs(after - before * 0.75) < 1e-9);
  void randomUUID;
});

test.after(closePool);
