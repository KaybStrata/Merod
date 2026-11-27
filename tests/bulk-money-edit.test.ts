import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one } from "@/server/db";
import { parseEdits } from "@/server/ai/bulk-edit";

test("money edits in any wording", () => {
  assert.deepEqual(parseEdits("update all my bots/agent by increasing their budget of 10$ to 35$ each"), { amountUsd: 35 });
  assert.deepEqual(parseEdits("increase all bots budget by $5"), { amountAdd: 5 });
  assert.deepEqual(parseEdits("raise every agent's trade size by 20%"), { amountMult: 1.2 });
  assert.deepEqual(parseEdits("double the budget of all my bots"), { amountMult: 2 });
  assert.deepEqual(parseEdits("give all agents $5,000 capital"), { capitalUsd: 5000 });
  assert.deepEqual(parseEdits("increase capital of all agents by 1k"), { capitalAdd: 1000 });
  assert.deepEqual(parseEdits("lower all bots budget by 50%"), { amountMult: 0.5 });
  assert.deepEqual(parseEdits("create a stop loss for all bots/agents at -8%"), { stopLossPct: 8 });
});

test("prompt box: 'update all my bots/agent by increasing their budget of 10$ to 35$ each' updates every bot and agent without an AI", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const mk = (name: string) => one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,$2,'dip_rebound_loop',$3,'running',$4) RETURNING id", [u, name, acct.id, JSON.stringify({ amount_usd: 10, take_profit_pct: 5 })]);
  const a = (await mk("Bot One"))!, b = (await mk("Bot Two"))!;
  const { createAgent } = await import("@/server/agents/service");
  const ag = await createAgent(u, { name: "ETH Agent", role: "crypto_trading", assets: ["ETH"], strategy: { kind: "dca", tradeUsd: 10, everyHours: 24 }, autonomy: 5, capitalUsd: 200 } as any);
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "update all my bots/agent by increasing their budget of 10$ to 35$ each", provider: "merod" } as any);
  assert.match(r.message.content, /Updated 2 bots and 1 agent/, r.message.content);
  for (const id of [a.id, b.id]) assert.equal(Number((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [id]))!.params.amount_usd), 35);
  assert.equal(Number((await one<any>("SELECT strategy FROM agents WHERE id=$1", [ag.id]))!.strategy.tradeUsd), 35);
  assert.match(r.message.content, /\$10 → \$35/);

  const r2: any = await handlePrompt(u, { text: "increase all bots budget by 20%", provider: "merod" } as any);
  assert.match(r2.message.content, /Updated 2 bots/, r2.message.content);
  assert.equal(Number((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [a.id]))!.params.amount_usd), 42);

  const r3: any = await handlePrompt(u, { text: "give all agents $300 capital", provider: "merod" } as any);
  assert.match(r3.message.content, /capital \$200 → \$300/, r3.message.content);

  const r4: any = await handlePrompt(u, { text: "flibber the jabberwock gently", provider: "merod" } as any);
  assert.match(r4.message.content, /Modo|Update many bots/, r4.message.content);
});
