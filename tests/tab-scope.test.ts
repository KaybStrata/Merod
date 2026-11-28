import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one } from "@/server/db";

test("each Talk tab has its own activity and P&L: trades and bots started in tab A don't show in tab B", async () => {
  await freshPrices();
  const u = await newUser();
  const { handlePrompt, approvePlan } = await import("@/server/ai/interpret");
  const { tabPnl, tabScope } = await import("@/server/talk/tab-scope");
  // Tab A: a buy (approved) and a bot (approved). Tab B: just a question.
  const a1: any = await handlePrompt(u, { text: "buy $50 of BTC", provider: "merod" } as any);
  const A = a1.conversationId;
  if (a1.message.status === "needs_approval") await approvePlan(u, a1.message.id);
  const a2: any = await handlePrompt(u, { text: "buy BTC on a 3% dip and sell at 5%, rinse and repeat, $20", conversationId: A, provider: "merod" } as any);
  if (a2.message.status === "needs_approval") await approvePlan(u, a2.message.id);
  const b1: any = await handlePrompt(u, { text: "how is my portfolio doing?", provider: "merod" } as any);
  const B = b1.conversationId;
  assert.notEqual(A, B);

  const pa = await tabPnl(u, A), pb = await tabPnl(u, B);
  assert.ok(pa.orders >= 1, `tab A has its buy: ${JSON.stringify(pa)}`);
  assert.equal(pa.bots, 1, "tab A's bot is linked to tab A");
  assert.equal(pb.orders, 0, "tab B has none of tab A's trades");
  assert.equal(pb.bots, 0);
  const sA = await tabScope(u, A);
  const bot = await one<any>("SELECT id FROM trading_bots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [u]);
  assert.ok(sA.botIds.includes(bot.id));
});
