import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, assetId, ctx, closePool } from "./helpers";
import { one, q } from "@/server/db";
import { place } from "@/server/engine/engine";
import { computeFee, getFeeConfig } from "@/server/fees";
import { isReservedSuperAdminEmail, checkSuperAdminSetupCode } from "@/server/auth";
import { tuneBotParams } from "@/server/training/trainer";
import { paperCash, addAddress } from "@/server/wallet/funding";

test("default platform fee is a 7% performance fee", async () => {
  const cfg = await getFeeConfig();
  assert.deepEqual(cfg, { mode: "performance", pct: 7 });
  assert.equal(computeFee(cfg, { side: "sell", notional: 1100, realizedGross: 100 }), 7);
  assert.equal(computeFee(cfg, { side: "sell", notional: 900, realizedGross: -100 }), 0);
  assert.equal(computeFee(cfg, { side: "buy", notional: 1000, realizedGross: 0 }), 0);
  assert.equal(computeFee({ mode: "commission", pct: 7 }, { side: "buy", notional: 1000, realizedGross: 0 }), 70);
});

test("performance fee is charged only on a profitable close and recorded", async () => {
  const u = await newUser(); await freshPrices();
  const id = await assetId("META");
  const px = (await one<any>("SELECT last_price FROM assets WHERE id=$1", [id])).last_price;
  await place({ asset: { assetId: id }, side: "buy", orderType: "market", notionalUsd: 500, timeInForce: "gtc" }, ctx(u));
  await q("UPDATE assets SET last_price=$2, price_updated_at=now() WHERE id=$1", [id, px * 1.2]);
  const { order } = await place({ asset: { assetId: id }, side: "sell", orderType: "market", percentOfPosition: 100, timeInForce: "gtc" }, ctx(u));
  const o = await one<any>("SELECT platform_fee_usd, realized_pnl FROM orders WHERE id=$1", [order.id]);
  assert.ok(o.platform_fee_usd > 0);
  const gross = o.realized_pnl + o.platform_fee_usd;
  assert.ok(Math.abs(o.platform_fee_usd - gross * 0.07) < 0.02, `fee ${o.platform_fee_usd} vs 7% of ${gross}`);
  const feeTx = await one<any>("SELECT amount FROM transactions WHERE reference=$1 AND kind='fee'", [order.id]);
  assert.ok(feeTx && feeTx.amount < 0);
  await q("UPDATE assets SET last_price=$2 WHERE id=$1", [id, px]);
});

test("reserved super-admin email requires the server setup code", () => {
  process.env.SUPER_ADMIN_EMAILS = "owner@example.com";
  process.env.SUPER_ADMIN_SETUP_CODE = "correct-setup-code-123";
  assert.equal(isReservedSuperAdminEmail("Owner@Example.com"), true);
  assert.equal(isReservedSuperAdminEmail("someone@example.com"), false);
  assert.equal(checkSuperAdminSetupCode(undefined), false);
  assert.equal(checkSuperAdminSetupCode("wrong"), false);
  assert.equal(checkSuperAdminSetupCode("correct-setup-code-123"), true);
  process.env.SUPER_ADMIN_SETUP_CODE = "short";
  assert.equal(checkSuperAdminSetupCode("short"), false); // weak codes are never accepted
});

test("auto-training only reduces risk", () => {
  const original = { amount_usd: 100, dip_pct: 3, take_profit_pct: 5, stop_loss_pct: null, repeat: true };
  const t = tuneBotParams("dip_rebound_loop", original, original, { losses: [{ orderId: "x", pnl: -6, pct: -6 }], wins: 0, rejections: [], streak: 1 })!;
  assert.ok(t.params.dip_pct > 3, "waits for a deeper dip");
  assert.ok(t.params.stop_loss_pct > 0 && t.params.stop_loss_pct <= 15, "adds a stop-loss");
  assert.ok(t.params.amount_usd < 100 && t.params.amount_usd >= 25, "shrinks size within bounds");
  // repeated losses never push size below 25% of original or dip beyond 2.5×
  let p: any = original;
  for (let i = 0; i < 30; i++) p = tuneBotParams("dip_rebound_loop", p, original, { losses: [{ orderId: "x", pnl: -6, pct: -6 }], wins: 0, rejections: [], streak: 1 })?.params ?? p;
  assert.ok(p.amount_usd >= 25 && p.dip_pct <= 7.5);
  assert.equal(tuneBotParams("dip_rebound_loop", original, original, { losses: [], wins: 3, rejections: [], streak: 0 }), null, "no change after wins");
});

test("paper deposits/withdrawals work; external transfers need 2FA", async () => {
  const u = await newUser();
  const acct = await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]);
  await paperCash(u, acct.id, "deposit", 5000, "k1");
  await paperCash(u, acct.id, "deposit", 5000, "k1"); // idempotent replay
  await paperCash(u, acct.id, "withdrawal", 2000, "k2");
  const after = await one<any>("SELECT cash_balance FROM trading_accounts WHERE id=$1", [acct.id]);
  assert.equal(Number(after.cash_balance), Number(acct.cash_balance) + 3000);
  await assert.rejects(paperCash(u, acct.id, "withdrawal", 1e9, "k3"));
  await assert.rejects(addAddress(u, { label: "x", network: "ethereum", address: "0x0000000000000000000000000000000000000001" }), /2FA/);
  await assert.rejects(addAddress(u, { label: "x", network: "ethereum", address: "not-an-address" }), /valid/);
});

test.after(closePool);
