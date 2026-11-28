import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { extractLinks, lessonEdits, linkCommand } from "@/server/link-learn";
import { handlePrompt } from "@/server/ai/interpret";

/** A link Merod already read (the safe fetcher refuses local test servers, so the material is stored directly). */
async function learned(u: string) {
  const url = `https://example.com/sol-strategy-${randomUUID().slice(0, 6)}`;
  await q(`INSERT INTO training_materials (user_id, kind, title, source_url, status, summary, lessons, symbols, learned_by, processed_at)
           VALUES ($1,'article','SOL dip strategy',$2,'learned','Buy SOL on dips, take profit quickly.',$3,'{SOL}','merod:rules',now())`,
    [u, url, JSON.stringify([
      { title: "Entry", rule: "Buy SOL after a 4% dip on rising volume.", kind: "entry", confidence: "medium", applies_to: ["all"] },
      { title: "Exit", rule: "Always set a stop loss of 6% and take profit at 12%.", kind: "exit", confidence: "high", applies_to: ["all"] },
    ])]);
  return url;
}

test("links: found when pasted with or without https, trailing punctuation dropped", () => {
  assert.deepEqual(extractLinks("learn this https://youtu.be/abcdefghijk, then trade"), ["https://youtu.be/abcdefghijk"]);
  assert.deepEqual(extractLinks("www.youtube.com/watch?v=abcdefghijk"), ["https://www.youtube.com/watch?v=abcdefghijk"]);
  assert.deepEqual(extractLinks("no links here"), []);
  assert.deepEqual(lessonEdits(["Always set a stop loss of 6% and take profit at 12%."]), { stopLossPct: 6, takeProfitPct: 12 });
});

test("link: learn → summary + lessons; train my bots on it → its numbers are applied; momo tag set", async () => {
  const u = await newUser();
  const url = await learned(u);
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const b = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Dip Z','dip_rebound_loop',$2,'running','{\"amount_usd\":10,\"stop_loss_pct\":2,\"take_profit_pct\":3}') RETURNING id", [u, acct.id]))!;
  const r1 = await linkCommand(u, url);
  assert.match(r1!.summary, /Learned from “SOL dip strategy”/);
  assert.match(r1!.summary, /stop loss of 6%/);
  assert.equal(r1!.followUp, undefined);
  const r2 = await linkCommand(u, `${url} train my bots on it`);
  assert.match(r2!.summary, /Trained 1 bot/);
  const p = (await one<any>("SELECT params FROM trading_bots WHERE id=$1", [b.id]))!.params;
  assert.equal(Number(p.stop_loss_pct), 6); assert.equal(Number(p.take_profit_pct), 12);
  assert.ok((await one<any>("SELECT tags FROM training_materials WHERE user_id=$1 AND source_url=$2", [u, url]))!.tags.includes("momo"));
});

test("link: make it a skill, train Auton, and copy → a bot prompt through the normal pipeline", async () => {
  const u = await newUser();
  const url = await learned(u);
  const r = await linkCommand(u, `${url} make it a skill and train auton`);
  assert.match(r!.summary, /Made a skill/);
  assert.match(r!.summary, /Auton trained/);
  assert.ok(await one("SELECT 1 FROM skills WHERE user_id=$1 AND name LIKE 'Learned:%'", [u]));
  assert.match((await one<any>("SELECT goals FROM auton_settings WHERE user_id=$1", [u]))!.goals, /SOL/);
  const c = await linkCommand(u, `copy this ${url} with $50`);
  assert.match(c!.followUp!, /buy \$50 of SOL at a 4% dip and sell at a 12% increase, stop loss 6%/);
  // Through the prompt box: two replies (what it learned, then the bot plan).
  const res: any = await handlePrompt(u, { text: `copy this ${url}` });
  assert.ok(res.messages.length >= 2, JSON.stringify(res.messages.map((m: any) => m.content)));
  assert.match(res.messages[0].content, /Learned from/);
});
