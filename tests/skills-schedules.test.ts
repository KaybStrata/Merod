import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { nextRun, parseSchedule } from "@/server/schedules";
import { extractRules } from "@/server/skills";

test("schedules: 'every morning at 2 am los angelas time, buy … solona …' becomes a daily 2am Los Angeles schedule", async () => {
  const p = parseSchedule("every morning at 2 am los angeles time, buy the top 10 most profitable solana meme coins and sell on a 1% loop")!;
  assert.deepEqual(p.spec, { kind: "daily", hour: 2, minute: 0, tz: "America/Los_Angeles" });
  assert.equal(p.prompt, "buy the top 10 most profitable solana meme coins and sell on a 1% loop");
  // 2am in Los Angeles = 10:00 UTC in winter (PST), 09:00 UTC in summer (PDT).
  assert.equal(nextRun(p.spec, new Date("2026-11-26T12:00:00Z")).toISOString(), "2026-11-27T10:00:00.000Z");
  assert.equal(nextRun(p.spec, new Date("2026-07-01T12:00:00Z")).toISOString(), "2026-07-02T09:00:00.000Z");
  assert.deepEqual(parseSchedule("every weekday at 9:30am new york time buy $100 of NVDA")!.spec, { kind: "weekly", hour: 9, minute: 30, weekdays: [1, 2, 3, 4, 5], tz: "America/New_York" });
  assert.deepEqual(parseSchedule("every 15 minutes check my bots", "UTC")!.spec, { kind: "interval", everyMin: 15, tz: "UTC" });
  assert.equal(parseSchedule("buy $10 of SOL"), null);
  assert.equal(parseSchedule("buy every solana meme coin and sell at 2% profit, repeat"), null, "'at 2%' is a price, not 2am");
  assert.equal(parseSchedule("buy every meme coin at 5 dollars"), null);
  assert.deepEqual(parseSchedule("every day at 14:30 utc pause all bots")!.spec, { kind: "daily", hour: 14, minute: 30, tz: "UTC" });
  assert.deepEqual(parseSchedule("every day at 2 buy $5 of BTC", "UTC")!.spec, { kind: "daily", hour: 2, minute: 0, tz: "UTC" });

  const u = await newUser();
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "every morning at 2 am los angelas time, buy the top 10 most profitable solona meme coins and sell on a 1% loop", provider: "merod" } as any);
  assert.match(r.message.content, /Scheduled\. Every day at 2:00 AM \(Los Angeles time\)/, r.message.content);
  assert.match(r.message.content, /solana meme coins/, "typo fixed");
  const s = (await one<any>("SELECT * FROM prompt_schedules WHERE user_id=$1", [u]))!;
  assert.equal(s.spec.tz, "America/Los_Angeles");
  const list: any = await handlePrompt(u, { text: "show my schedules", provider: "merod" } as any);
  assert.match(list.message.content, /1\. Every day at 2:00 AM/);

  // When due, the worker runs it as if typed, and moves it to the next 2am.
  await q("UPDATE prompt_schedules SET prompt='how are my bots doing?', next_run_at=now() - interval '1 minute' WHERE id=$1", [s.id]);
  const { runDueSchedules } = await import("@/server/schedules");
  assert.ok((await runDueSchedules()) >= 1);
  const after = (await one<any>("SELECT * FROM prompt_schedules WHERE id=$1", [s.id]))!;
  assert.equal(after.runs, 1); assert.ok(after.last_result); assert.ok(new Date(after.next_run_at) > new Date());
  const del: any = await handlePrompt(u, { text: "cancel schedule 1", provider: "merod" } as any);
  assert.match(del.message.content, /Deleted 1 schedule/);
});

test("skills: rules are extracted and enforced; the AI gets the text", async () => {
  assert.deepEqual(extractRules("always use a 5% stop loss, only sell when profitable, never buy BONK or WIF, max $25 per trade"),
    { edits: { stopLossPct: 5, amountUsd: 25 }, profitOnly: true, neverBuy: ["BONK", "WIF"], maxTradeUsd: 25 });

  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const bot = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Loop','dip_rebound_loop',$2,'running','{\"take_profit_pct\":5}') RETURNING id", [u, acct.id]))!;
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "create a skill called Safe: always use a 4% stop loss and never buy BTC", provider: "merod" } as any);
  assert.match(r.message.content, /Skill “Safe” is on/, r.message.content);
  assert.match(r.message.content, /blocks buying BTC/);
  assert.equal((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [bot.id]))!.params.stop_loss_pct, 4, "applied to existing bots");
  const { skillNotes } = await import("@/server/skills");
  assert.match((await skillNotes(u))!, /Safe: always use a 4% stop loss/);

  // The engine blocks a BTC buy because of the skill.
  const { freshPrices } = await import("./helpers"); await freshPrices();
  const btc = (await one<any>("SELECT id FROM assets WHERE symbol='BTC' AND last_price IS NOT NULL LIMIT 1"))!;
  const { preview } = await import("@/server/engine/engine");
  const plan: any = await preview({ asset: { assetId: btc.id }, side: "buy", orderType: "market", notionalUsd: 10, timeInForce: "gtc" } as any,
    { userId: u, source: "manual", idempotencyKey: `sk${Date.now()}`, actor: { type: "user", id: u } } as any);
  const chk = plan.checks.find((c: any) => c.name === "skill_never_buy");
  assert.ok(chk && !chk.ok, JSON.stringify(plan.checks.map((c: any) => c.name)));
  assert.match(chk.message, /blocks buying BTC/);
  const off: any = await handlePrompt(u, { text: "turn off skill Safe", provider: "merod" } as any);
  assert.match(off.message.content, /Turned off “Safe”/);
  assert.equal(await skillNotes(u), null);
});

test("points: specific instructions that can expire; listed apart from skills; reach the AI while live", async () => {
  const { parseExpiry, skillNotes } = await import("@/server/skills");
  const now = new Date("2026-11-26T20:00:00Z"); // 12:00 in Los Angeles
  assert.equal(parseExpiry("focus on SOL for 2 hours", "UTC", now)!.toISOString(), "2026-11-26T22:00:00.000Z");
  assert.equal(parseExpiry("only memes today", "America/Los_Angeles", now)!.toISOString(), "2026-11-27T08:00:00.000Z", "end of the day in Los Angeles");
  assert.equal(parseExpiry("always be careful"), null);

  const u = await newUser();
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "create a point: focus on Solana meme coins with rising volume for 3 hours", provider: "merod" } as any);
  assert.match(r.message.content, /Point set: “focus on Solana meme coins with rising volume for 3 hours”\. Applies until/, r.message.content);
  assert.match((await skillNotes(u))!, /user_points[\s\S]*focus on Solana meme coins/);
  const list: any = await handlePrompt(u, { text: "show my points", provider: "merod" } as any);
  assert.match(list.message.content, /Your points:\n1\. focus on Solana/);
  await q("UPDATE skills SET expires_at = now() - interval '1 minute' WHERE user_id=$1", [u]);
  assert.equal(await skillNotes(u), null, "expired points no longer apply");
});
