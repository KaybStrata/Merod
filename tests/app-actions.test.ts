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

test("typing 'approve' approves the waiting card: settings come back marked to apply right away", async () => {
  const me = await newUser();
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const r: any = await handlePrompt(me, { text: "risk flagging/factor to 0" });
  const a: any = await handlePrompt(me, { text: "approve", conversationId: r.conversationId });
  assert.equal(a.message.plan.type, "app_action");
  assert.equal(a.message.plan.autoApply, true);
  assert.match(a.message.content, /Applying/);
});

test("Real money in the composer routes prompt trades to a real account, and explains when there is none", async () => {
  const me = await newUser();
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  await q("UPDATE trading_permissions SET allow_ai_prompts=true WHERE user_id=$1", [me]);
  const r: any = await handlePrompt(me, { text: "buy $10 of SOL", book: "live" });
  assert.match(r.message.content, /Real money is selected/, r.message.content);
});

test("'turn off all risk and confidence flagging for all bots' covers risk flags, every bot, and the confidence bar", () => {
  const a = parseAppAction("turn off all risk and confidence flagging for all bots until further notice") as any;
  const ops = a.steps.map((s: any) => s.op);
  assert.ok(ops.includes("settings") && ops.includes("bots_allow_risky") && ops.includes("auto"), JSON.stringify(ops));
  assert.equal(a.steps.find((s: any) => s.op === "auto").body.forceTrading, true);
});

test("'stop asking me to approve trades' switches to automatic and turns off per-trade approval on every bot", () => {
  const a = parseAppAction("stop asking me to approve trades") as any;
  assert.deepEqual(a.steps.map((s: any) => s.op), ["settings", "bots_approval"]);
  assert.equal(a.steps[0].values.mode, "auto_within_limits");
  assert.equal(a.steps[1].value, false);
});
