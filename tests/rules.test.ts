import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one } from "@/server/db";
import { activeRules, skillCommand } from "@/server/skills";

test("rules: a rule for one bot / all bots / prompts only applies to those trades; 'rule:' applies to everything", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const b = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Dip buyer','dip_rebound_loop',$2,'running','{\"amount_usd\":10,\"stop_loss_pct\":2}') RETURNING id", [u, acct.id]))!;
  const other = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Momentum','dip_rebound_loop',$2,'running','{\"amount_usd\":10,\"stop_loss_pct\":2}') RETURNING id", [u, acct.id]))!;
  const r1 = await skillCommand(u, "rule for Dip buyer: never buy BONK, stop loss 7%");
  assert.match(r1!, /Rule .* is on for Dip buyer/);
  assert.equal(Number((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [b.id]))!.params.stop_loss_pct), 7, "its numbers go to that bot");
  assert.equal(Number((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [other.id]))!.params.stop_loss_pct), 2, "not to other bots");
  assert.deepEqual((await activeRules(u, { source: "bot", ref: b.id })).neverBuy, ["BONK"]);
  assert.equal((await activeRules(u, { source: "bot", ref: other.id })).neverBuy, undefined, "other bots aren't blocked");
  assert.equal((await activeRules(u, { source: "prompt" })).neverBuy, undefined, "prompts aren't blocked");
  await skillCommand(u, "rule for prompts: never buy PEPE");
  assert.deepEqual((await activeRules(u, { source: "prompt" })).neverBuy, ["PEPE"]);
  assert.equal((await activeRules(u, { source: "bot", ref: other.id })).neverBuy, undefined);
  await skillCommand(u, "rule for all bots: never buy WIF");
  assert.deepEqual((await activeRules(u, { source: "agent", ref: "x" })).neverBuy, ["WIF"]);
  await skillCommand(u, "rule: never buy DOGE");
  assert.ok((await activeRules(u, { source: "manual" })).neverBuy?.includes("DOGE"), "everything");
  assert.match((await skillCommand(u, "show my rules"))!, /Your rules:/);
});
