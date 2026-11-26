import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { parseEdits } from "@/server/ai/bulk-edit";

test("bulk edit parser: stop-loss, take-profit, amount and dip from plain English", () => {
  assert.deepEqual(parseEdits("create a stop loss for all bots/agents at -8%"), { stopLossPct: 8 });
  assert.deepEqual(parseEdits("set take profit to 5% on SOL Momentum"), { takeProfitPct: 5 });
  assert.deepEqual(parseEdits("all bots $20 per trade and stop loss 3%"), { stopLossPct: 3, amountUsd: 20 });
  assert.deepEqual(parseEdits("remove the stop loss from ETH Accumulation"), { stopLossPct: 0 });
  assert.deepEqual(parseEdits("every agent: buy on a 2% dip"), { dipPct: 2 });
  assert.equal(parseEdits("pause all bots"), null);
});

test("prompt box: 'create a stop loss for all bots/agents at -8%' updates every bot (live) and only named ones when named", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const mk = (name: string, strategy: string, params: object) =>
    one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,$2,$3,$4,'running',$5) RETURNING id", [u, name, strategy, acct.id, JSON.stringify(params)]);
  const a = (await mk("SOL Momentum", "dip_rebound_loop", { take_profit_pct: 20, amount_usd: 10 }))!;
  const b = (await mk("BTC Guard", "stop_loss_take_profit", { stop_loss_pct: 15, take_profit_pct: 30 }))!;
  const c = (await mk("SMA bot", "technical_indicator", { fast: 9, slow: 21, amount_usd: 50 }))!;

  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "create a stop loss for all bots/agents at -8%", provider: "merod" } as any);
  assert.match(r.message.content, /Updated 3 bots: stop-loss −8%/, r.message.content);
  assert.match(r.message.content, /SMA bot \(bot\): its strategy \(SMA crossover\) doesn't use stop-loss/);
  const p = async (id: string) => (await one<any>("SELECT params, status FROM trading_bots WHERE id=$1", [id]))!;
  assert.equal((await p(a.id)).params.stop_loss_pct, 8); assert.equal((await p(a.id)).params.take_profit_pct, 20, "other settings kept");
  assert.equal((await p(a.id)).status, "running", "edited live, no pause needed");
  assert.equal((await p(b.id)).params.stop_loss_pct, 8);
  assert.equal((await p(c.id)).params.stop_loss_pct, undefined);

  await handlePrompt(u, { text: "set take profit to 5% on SOL Momentum", provider: "merod" } as any);
  assert.equal((await p(a.id)).params.take_profit_pct, 5);
  assert.equal((await p(b.id)).params.take_profit_pct, 30, "unnamed bots untouched");
  await q("DELETE FROM trading_bots WHERE user_id=$1", [u]);
});

test("prompt box: stop-loss for all agents updates each agent's strategy", async () => {
  const u = await newUser();
  const { createAgent } = await import("@/server/agents/service");
  const created: any = await createAgent(u, { name: "Dip Hunter", role: "crypto_trading", strategy: { kind: "dip", dipPct: 3, takeProfitPct: 5, stopLossPct: 2 } as any, autonomy: 5 });
  const id = created?.id ?? created?.agent?.id;
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "create a stop loss for all bots/agents at -8%", provider: "merod" } as any);
  assert.match(r.message.content, /Dip Hunter \(agent\): stop-loss −8%/, r.message.content);
  const s = (await one<any>("SELECT strategy FROM agents WHERE id=$1", [id]))!.strategy;
  assert.equal(s.stopLossPct, 8); assert.equal(s.takeProfitPct, 5, "other settings kept");
});
