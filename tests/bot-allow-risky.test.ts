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

test("new bots follow your Risk setting: flagged coins allowed → the bot never rejects them", async () => {
  const { createBot, BotConfigSchema } = await import("@/server/bots/service");
  const u = await newUser(); await freshPrices();
  const sol = (await one<any>("SELECT id FROM assets WHERE symbol='SOL' LIMIT 1"))!;
  const base: any = { name: "t", strategyId: "dip_rebound_loop", params: { amount_usd: 10, dip_pct: 3, take_profit_pct: 5 }, assetIds: [sol.id], isPaper: true };
  const mk = (c: any) => createBot(u, BotConfigSchema.parse(c) as any, "user");
  const strict = await mk(base);
  assert.equal(strict.allow_risky, false);
  await q("UPDATE risk_settings SET block_risky_tokens=false WHERE user_id=$1", [u]);
  const loose = await mk({ ...base, name: "t2" });
  assert.equal(loose.allow_risky, true);
  const pinned = await mk({ ...base, name: "t3", allowRisky: false });
  assert.equal(pinned.allow_risky, false, "an explicit choice on the card wins");
});
