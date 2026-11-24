import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, assetId, ctx, closePool } from "./helpers";
import { one, q } from "@/server/db";
import { place } from "@/server/engine/engine";
import { refreshLearnings, applyLearning } from "@/server/learning/engine";
import { revertAdjustment } from "@/server/training/trainer";

test("losing prompt trades produce a learning; Update applies it revertibly", async () => {
  const u = await newUser(); await freshPrices();
  const id = await assetId("AMZN");
  const px = (await one<any>("SELECT last_price FROM assets WHERE id=$1", [id])).last_price;
  for (let i = 0; i < 3; i++) {
    await q("UPDATE assets SET last_price=$2, price_updated_at=now() WHERE id=$1", [id, px]);
    await place({ asset: { assetId: id }, side: "buy", orderType: "market", notionalUsd: 100, timeInForce: "gtc" }, ctx(u, { source: "prompt" }));
    await q("UPDATE assets SET last_price=$2, price_updated_at=now() WHERE id=$1", [id, px * 0.9]);
    await place({ asset: { assetId: id }, side: "sell", orderType: "market", percentOfPosition: 100, timeInForce: "gtc" }, ctx(u, { source: "prompt" }));
  }
  await q("UPDATE assets SET last_price=$2, price_updated_at=now() WHERE id=$1", [id, px]);
  const fresh = await refreshLearnings(u);
  assert.ok(fresh >= 1);
  const l = await one<any>("SELECT * FROM ai_learnings WHERE user_id=$1 AND key='source:prompt' AND status='new'", [u]);
  assert.ok(l, "prompt-source learning exists");
  assert.equal(l.proposed_update.type, "prompt_defaults");
  const { adjustmentId } = await applyLearning(u, l.id);
  const d = await one<any>("SELECT default_stop_loss_pct FROM prompt_trading_defaults WHERE user_id=$1", [u]);
  assert.ok(Number(d.default_stop_loss_pct) >= 2);
  assert.equal((await one<any>("SELECT status FROM ai_learnings WHERE id=$1", [l.id])).status, "applied");
  await assert.rejects(applyLearning(u, l.id), /Already/);
  await revertAdjustment(u, adjustmentId!);
  const after = await one<any>("SELECT default_stop_loss_pct FROM prompt_trading_defaults WHERE user_id=$1", [u]);
  assert.equal(after.default_stop_loss_pct, null);
  // Asset learning proposes tightening (never loosening) the max order size
  const asset = await one<any>("SELECT proposed_update FROM ai_learnings WHERE user_id=$1 AND key LIKE 'asset:%' AND status='new'", [u]);
  if (asset?.proposed_update) assert.ok(asset.proposed_update.changes.max_order_usd < 1000);
});

test.after(closePool);
