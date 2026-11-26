import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeOf, tpOf, slOf } from "@/server/auto/engine";

test("custom per-trade / take-profit / stop-loss override the risk dial; empty falls back to the dial", () => {
  const base = { trade_usd: 100, take_profit_pct: 4, stop_loss_pct: 2, risk_mode: true, risk_level: 100 };
  assert.equal(sizeOf(base), 250); assert.equal(tpOf(base), 10); assert.equal(slOf(base), 5);
  const custom = { ...base, custom_trade_usd: "40", custom_take_profit_pct: 3, custom_stop_loss_pct: 1.5 };
  assert.equal(sizeOf(custom), 40); assert.equal(tpOf(custom), 3); assert.equal(slOf(custom), 1.5);
  const partial = { ...base, custom_trade_usd: 1000, custom_take_profit_pct: null, custom_stop_loss_pct: 0 };
  assert.equal(sizeOf(partial), 1000); assert.equal(tpOf(partial), 10); assert.equal(slOf(partial), 5);
  assert.equal(sizeOf({ ...base, risk_mode: false, custom_trade_usd: 75 }), 75, "custom applies with the dial off too");
});
