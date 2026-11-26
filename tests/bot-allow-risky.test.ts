import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { preview } from "@/server/engine/engine";

test("a bot set to 'never reject' passes risk-flag and liquidity checks; without it they block", async () => {
  const u = await newUser({ mode: "auto_within_limits" }); await freshPrices();
  const a = (await one<any>("SELECT id, risk_flags, liquidity_usd FROM assets WHERE venue='solana' AND last_price IS NOT NULL AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY symbol LIMIT 1"))!;
  await q("UPDATE assets SET risk_flags = ARRAY['new_listing','unverified','low_liquidity'], liquidity_usd = 20000, price_updated_at=now() WHERE id=$1", [a.id]);
  try {
    const intent: any = { asset: { assetId: a.id }, side: "buy", orderType: "market", notionalUsd: 10, timeInForce: "gtc" };
    const base = { userId: u, source: "bot" as const, sourceRef: "t", idempotencyKey: `t${Date.now()}`, actor: { type: "bot" as const, id: "t" } };
    const lim = { approvalRequired: false, maxSlippageBps: 100, minLiquidityUsd: 50000, maxPositionUsd: 0 };
    const blocked = await preview(intent, { ...base, botLimits: lim });
    assert.equal(blocked.decision, "rejected", blocked.decisionReason);
    assert.match(blocked.decisionReason, /Risk flags|Liquidity/);
    const allowed = await preview(intent, { ...base, idempotencyKey: `t2${Date.now()}`, botLimits: { ...lim, allowRisky: true } });
    assert.notEqual(allowed.decision, "rejected", allowed.decisionReason);
    assert.ok(allowed.checks.some((c: any) => /allowed: bot set to never reject/.test(c.message)), "findings stay visible as allowed");
    // Only bots: the same flag from a manual order changes nothing.
    const manual = await preview(intent, { ...base, source: "manual" as any, idempotencyKey: `t3${Date.now()}`, botLimits: { ...lim, allowRisky: true } });
    assert.ok(!manual.checks.some((c: any) => /allowed: bot/.test(c.message)));
  } finally {
    await q("UPDATE assets SET risk_flags=$2, liquidity_usd=$3 WHERE id=$1", [a.id, a.risk_flags, a.liquidity_usd]);
  }
});
