import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { parseControl } from "@/server/ai/control";

test("prompt box: '@SOL Momentum turn off' pauses that bot (even right after a 'what to do with SOL?' question), 'turn on' resumes it", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const bot = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status) VALUES ($1,'SOL Momentum','dip_rebound_loop',$2,'running') RETURNING id", [u, acct.id]))!;
  await q("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status) VALUES ($1,'SOL Momentum 2','dip_rebound_loop',$2,'running')", [u, acct.id]);

  const p = await parseControl(u, "@SOL Momentum turn off");
  assert.equal(p?.verb, "pause"); assert.deepEqual(p?.targets.map((x) => x.name), ["SOL Momentum"], "exact name, not the longer 'SOL Momentum 2'");
  assert.equal(await parseControl(u, "buy SOL on a dip with SOL Momentum"), null, "a trade is not a control command");
  assert.equal(await parseControl(u, "how is SOL Momentum doing?"), null, "a question is not a control command");
  assert.equal(await parseControl(u, "turn off the lights"), null, "no bot named → not a control command");

  const { handlePrompt } = await import("@/server/ai/interpret");
  const first: any = await handlePrompt(u, { text: "SOL", provider: "merod" } as any); // Modo asks what to do with SOL
  const r: any = await handlePrompt(u, { text: "@SOL Momentum turn off", conversationId: first.conversationId, provider: "merod" } as any);
  assert.match(r.message.content, /SOL Momentum \(bot\): turned off/, r.message.content);
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [bot.id]))!.status, "paused");
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE name='SOL Momentum 2' AND user_id=$1", [u]))!.status, "running", "the other bot is untouched");

  const on: any = await handlePrompt(u, { text: "turn on @SOL Momentum", provider: "merod" } as any);
  assert.match(on.message.content, /turned on/);
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [bot.id]))!.status, "running");
});
