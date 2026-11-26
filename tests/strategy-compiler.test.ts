import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { compile, createStrategy, newVersion, contentHash, validateVersion } from "@/server/lab/strategies";

test("compiler: prompts become typed drafts with missing fields listed (spec §19 compiler tests)", async () => {
  const a = await compile({ text: "buy $50 of SOL after a 5% dip and sell at 8% profit, repeat" });
  assert.equal(a.ok, true, a.errors.join(";"));
  assert.equal(a.draft!.template, "dip_loop");
  assert.deepEqual(a.draft!.entryRules, [{ type: "dip_pct", value: 5 }]);
  assert.equal(a.draft!.exitRules.takeProfitPct, 8);
  assert.equal(a.draft!.sizingRules.usdPerTrade, 50);
  assert.equal(a.draft!.environment, "paper");

  const b = await compile({ text: "buy SOL after a 5% dip and sell at 8% profit, repeat" });
  assert.ok(b.missing.includes("How much to spend per trade"), "ambiguous prompt asks for the amount");

  const scan = await compile({ text: "monitor the top meme coins on solana" });
  assert.equal(scan.draft!.template, "scanner");
  assert.equal(scan.draft!.approvalPolicy, "observation", "watch-only: no orders unless separately authorised");
});

test("compiler: code, injected instructions, unknown fields and bad values are rejected", async () => {
  assert.equal((await compile({ text: "buy $10 of BTC; process.exit() => eval('x')" })).ok, false);
  const ok = (await compile({ text: "buy $50 of SOL after a 5% dip and sell at 8% profit" })).draft!;
  assert.equal((await compile({ rules: { ...ok, run: "function(){ hack() }" } })).ok, false, "unknown field + code");
  assert.equal((await compile({ rules: { ...ok, exitRules: { ...ok.exitRules, stopLossPct: 500 } } })).ok, false, "out-of-range stop");
  assert.equal((await compile({ rules: { ...ok, schemaVersion: 2 } })).ok, false, "unknown schema version");
});

test("versions are immutable; editing creates a new version and never mutates the old one", async () => {
  const me = await newUser();
  const draft = (await compile({ text: "buy $50 of SOL after a 5% dip and sell at 8% profit" })).draft!;
  const { strategyId, version: v1 } = await createStrategy(me, draft, "test");
  assert.equal(v1.version, 1);
  assert.equal(v1.content_hash, contentHash(draft));
  await assert.rejects(q("UPDATE strategy_versions SET rules='{}' WHERE id=$1", [v1.id]), /immutable/);
  await assert.rejects(newVersion(me, strategyId, draft), /Nothing changed/);
  const v2 = await newVersion(me, strategyId, { ...draft, exitRules: { ...draft.exitRules, takeProfitPct: 12 } });
  assert.equal(v2.version, 2);
  assert.equal(v2.parent_version_id, v1.id);
  const still = await one<any>("SELECT rules FROM strategy_versions WHERE id=$1", [v1.id]);
  assert.equal(still.rules.exitRules.takeProfitPct, 8);
  const other = await newUser();
  await assert.rejects(newVersion(other, strategyId, draft), /not found/, "user B can't edit user A's strategy");
  const val = await validateVersion(me, v2.id);
  assert.equal(typeof val.ok, "boolean");
});
