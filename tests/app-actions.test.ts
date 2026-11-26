import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { q } from "@/server/db";
import { parseAppAction } from "@/server/ai/actions";
import { handlePrompt } from "@/server/ai/interpret";

test("prompt box understands settings, switches and navigation, not just trades", () => {
  const off = parseAppAction("turn down risk flagging/factor to 0") as any;
  assert.deepEqual(off.steps.map((s: any) => s.op), ["settings", "bots_allow_risky"]);
  assert.equal(off.steps[0].values.block_risky_tokens, false); assert.equal(off.steps[0].values.min_liquidity_usd, 0); assert.equal(off.steps[1].value, true);
  assert.equal((parseAppAction("turn risk flags back on") as any).steps[0].values.block_risky_tokens, true);
  assert.equal((parseAppAction("set max slippage to 3%") as any).steps[0].values.max_slippage_bps, 300);
  assert.deepEqual((parseAppAction("turn modo autopilot on") as any).steps[0].body, { modoAutopilot: true });
  assert.deepEqual((parseAppAction("turn auto trading off") as any).steps[0].body, { enabled: false });
  assert.equal((parseAppAction("risk level 80 and per trade $50, take profit 10%, stop loss 3%") as any).steps.length, 4);
  assert.equal((parseAppAction("open purchase history") as any).link.href, "/live");
  assert.equal(parseAppAction("buy $100 of SOL"), null, "trades still go to the trade parser");
  assert.equal(parseAppAction("buy SOL take profit 8%"), null);
});

test("an app action comes back as a card to approve; the server never applies it itself", async () => {
  const me = await newUser();
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const before = await q<any>("SELECT block_risky_tokens FROM risk_settings WHERE user_id=$1", [me]);
  const r: any = await handlePrompt(me, { text: "stop rejecting trades" });
  assert.equal(r.message.plan.type, "app_action");
  assert.equal(r.message.status, "needs_approval");
  const after = await q<any>("SELECT block_risky_tokens FROM risk_settings WHERE user_id=$1", [me]);
  assert.deepEqual(after, before, "nothing changed until the user approves in their browser");
});
