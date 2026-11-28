import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { preview } from "@/server/engine/engine";

test("never block: limits, screening, approval mode and short cash can't stop a bot or prompt (paper); manual still confirms", async () => {
  const u = await newUser({ mode: "manual" }); await freshPrices();
  const a = (await one<any>("SELECT id, risk_flags, liquidity_usd, tradability FROM assets WHERE symbol='SOL' AND last_price IS NOT NULL LIMIT 1"))!;
  await q("UPDATE assets SET risk_flags = ARRAY['new_listing','unverified'], liquidity_usd = 100, tradability='view_only', price_updated_at=now() WHERE id=$1", [a.id]);
  await q("UPDATE risk_settings SET max_order_usd=5, max_daily_spend_usd=5, block_risky_tokens=true, min_liquidity_usd=1000000 WHERE user_id=$1", [u]);
  await q("UPDATE trading_permissions SET allow_bots=false, allow_ai_prompts=false WHERE user_id=$1", [u]);
  const acct = (await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  await q("UPDATE trading_accounts SET cash_balance=50 WHERE id=$1", [acct.id]);
  try {
    const intent: any = { asset: { assetId: a.id }, side: "buy", orderType: "market", notionalUsd: 500, timeInForce: "gtc" };
    const ctx = (source: string, k: string) => ({ userId: u, source: source as any, sourceRef: "t", idempotencyKey: `${k}${Date.now()}`, actor: { type: "bot" as const, id: "t" } });
    const before = await preview(intent, ctx("bot", "a"));
    assert.equal(before.decision, "rejected", "without never-block the limits stop it");
    await q("UPDATE risk_settings SET never_block=true WHERE user_id=$1", [u]);
    for (const src of ["bot", "prompt", "agent"]) {
      const p = await preview(intent, ctx(src, src));
      assert.equal(p.decision, "execute", `${src}: ${p.decisionReason}`);
      assert.ok(p.notionalUsd > 40 && p.notionalUsd <= 50, `resized to the cash available, got ${p.notionalUsd}`);
    }
    const manual = await preview(intent, ctx("manual", "m"));
    assert.notEqual(manual.decision, "execute", "manual orders still ask you");
  } finally {
    await q("UPDATE assets SET risk_flags=$2, liquidity_usd=$3, tradability=$4 WHERE id=$1", [a.id, a.risk_flags, a.liquidity_usd, a.tradability]);
  }
});
