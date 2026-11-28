import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one } from "@/server/db";
import { isMapCommand } from "@/server/map-prompt";

test("map commands are recognised; normal prompts are not", () => {
  assert.ok(isMapCommand("create a map method called Safe with stop loss 5%, take profit 10% for all bots"));
  assert.ok(isMapCommand("add all my agents to the map"));
  assert.ok(isMapCommand("show my map"));
  assert.ok(!isMapCommand("buy $50 of SOL"));
  assert.ok(!isMapCommand("all bots $35 per trade"));
});

test("prompt box builds a map method, wires it to all bots and runs it", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const mk = (n: string) => one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,$2,'dip_rebound_loop',$3,'running','{\"amount_usd\":10}') RETURNING id", [u, n, acct.id]);
  const a = (await mk("Alpha Dip"))!, b = (await mk("Beta Dip"))!;
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "create a map method called Safe with stop loss 5%, take profit 10% for all bots and run it", provider: "merod" } as any);
  assert.match(r.message.content, /method “Safe”/, r.message.content);
  assert.match(r.message.content, /Ran it/);
  const m = (await one<any>("SELECT nodes, edges FROM strategy_maps WHERE user_id=$1", [u]))!;
  assert.equal(m.nodes.filter((n: any) => n.type === "method").length, 1);
  assert.equal(m.nodes.filter((n: any) => n.type === "bot").length, 2);
  assert.ok(m.edges.length >= 3);
  for (const id of [a.id, b.id]) {
    const p = (await one<any>("SELECT params FROM trading_bots WHERE id=$1", [id]))!.params;
    assert.equal(Number(p.stop_loss_pct), 5); assert.equal(Number(p.take_profit_pct), 10);
  }
  const s: any = await handlePrompt(u, { text: "show my map", provider: "merod" } as any);
  assert.match(s.message.content, /2 bots, 0 agents, 1 methods/);
});
