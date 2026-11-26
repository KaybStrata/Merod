import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { q } from "@/server/db";
import { parseAppAction } from "@/server/ai/actions";
import { heldForProfit } from "@/server/engine/profit-guard";

test("prompt: 'update ALL bots/agents to only sell when profitable' proposes the profit-only switch", () => {
  for (const p of ["update ALL bots/agents to only sell when profitable", "never sell at a loss", "make my bots only sell in profit", "don't sell at a loss", "bots should sell only when in profit"]) {
    const a: any = parseAppAction(p);
    assert.ok(a && a.steps?.length, p);
    assert.deepEqual(a.steps[0].values, { sell_only_in_profit: true }, p);
  }
  const pct: any = parseAppAction("only sell when profitable by at least 2%");
  assert.deepEqual(pct.steps[0].values, { sell_only_in_profit: true, min_profit_pct: 2 });
  const off: any = parseAppAction("allow bots to sell at a loss again");
  assert.deepEqual(off.steps[0].values, { sell_only_in_profit: false });
  assert.equal(parseAppAction("sell 25% of NVDA"), null, "a real sell order is still a trade, not a setting");
});

test("profit guard: holds sells below cost + minimum profit only while the switch is on", async () => {
  const u = await newUser();
  assert.equal(await heldForProfit(u, 0.9, 1, "ZERO"), null, "off by default");
  await q("UPDATE risk_settings SET sell_only_in_profit=true, min_profit_pct=0.5 WHERE user_id=$1", [u]);
  const held = await heldForProfit(u, 0.9, 1, "ZERO");
  assert.match(held!, /ZERO: sell held, only selling in profit\. Bought at \$1\.00, now \$0\.9 \(down 10\.00%\); sells once it reaches \$1\.005 \(up 0\.5%\)/, held!);
  assert.ok(await heldForProfit(u, 1.003, 1, "ZERO"), "below the fee cushion is still held");
  assert.equal(await heldForProfit(u, 1.01, 1, "ZERO"), null, "in profit → sells");
  assert.equal(await heldForProfit(u, 0.5, null, "ZERO"), null, "no cost basis → not blocked");
});
