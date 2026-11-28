import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { handlePrompt } from "@/server/ai/interpret";
import { preview } from "@/server/engine/engine";

test("master 'Bot trading' switch: off stops bot orders (even with never-block) but keeps each bot's own on/off; prompts still trade", async () => {
  const u = await newUser({ mode: "auto_within_limits" }); await freshPrices();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const sol = (await one<any>("SELECT id FROM assets WHERE symbol='SOL' AND last_price IS NOT NULL LIMIT 1"))!;
  const b = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Keeper','dip_rebound_loop',$2,'running','{\"amount_usd\":10}') RETURNING id", [u, acct.id]))!;
  await q("UPDATE risk_settings SET never_block=true WHERE user_id=$1", [u]);
  const r: any = await handlePrompt(u, { text: "turn off bot trading" });
  assert.match(String(r.message.content), /Bot trading is OFF/);
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [b.id]))!.status, "running", "the bot keeps its own switch");
  const intent: any = { asset: { assetId: sol.id }, side: "buy", orderType: "market", notionalUsd: 5, timeInForce: "gtc" };
  const ctx = (source: string) => ({ userId: u, source: source as any, sourceRef: "t", idempotencyKey: `${source}${Date.now()}${Math.random()}`, actor: { type: "bot" as const, id: "t" } });
  const blocked = await preview(intent, ctx("bot"));
  assert.equal(blocked.decision, "rejected"); assert.match(blocked.decisionReason, /Bot trading is turned off/);
  assert.notEqual((await preview(intent, ctx("prompt"))).decision, "rejected", "prompts aren't affected");
  const due = await q<any>(`SELECT id FROM trading_bots WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM risk_settings r WHERE r.user_id=trading_bots.user_id AND r.bot_trading=false)`, [b.id]);
  assert.equal(due.length, 0, "the runner skips it");
  const on: any = await handlePrompt(u, { text: "turn bot trading back on" });
  assert.match(String(on.message.content), /Bot trading is ON: the 1 bot/);
  assert.equal((await preview(intent, ctx("bot"))).decision, "execute");
});

test("prompts: 'delete bot <name>' deletes just that bot (even while running); others stay", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const mk = async (name: string) => (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,$2,'dip_rebound_loop',$3,'running','{\"amount_usd\":10}') RETURNING id", [u, name, acct.id]))!;
  const a = await mk("Dip buyer"), b = await mk("Momentum");
  const r: any = await handlePrompt(u, { text: "delete bot Dip buyer" });
  assert.match(String(r.message.content), /Deleted 1 of 1/, String(r.message.content));
  assert.equal(await one("SELECT 1 FROM trading_bots WHERE id=$1", [a.id]), null);
  assert.ok(await one("SELECT 1 FROM trading_bots WHERE id=$1", [b.id]));
});
