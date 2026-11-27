import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, assetId, freshPrices } from "./helpers";
import { one, q } from "@/server/db";

test("advisor: on/off, market + bot + prompt tips, no repeats, apply and dismiss", async () => {
  const { setAdvisor, getAdvisor, runAdvisor, runDueAdvisors, listTips, actOnTip } = await import("@/server/advisor");
  await freshPrices();
  const u = await newUser();
  assert.equal((await getAdvisor(u)).active, false, "off until the user turns it on");
  await setAdvisor(u, { active: true, everyMin: 5 });
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  // A position 30% in profit → take-profit tip.
  const eth = await assetId("ETH");
  const px = Number((await one<any>("SELECT last_price FROM assets WHERE id=$1", [eth]))!.last_price);
  await q("INSERT INTO positions (account_id, asset_id, user_id, quantity, avg_cost) VALUES ($1,$2,$3,1,$4)", [acct.id, eth, u, px / 1.3]);
  // A bot in error → bot tip.
  const bot = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status) VALUES ($1,'Broken Bot','dip_rebound_loop',$2,'error') RETURNING id", [u, acct.id]))!;
  // The same prompt typed 3 times → schedule tip.
  for (let i = 0; i < 3; i++) await q("INSERT INTO trading_prompts (user_id, role, content) VALUES ($1,'user','buy $20 of btc')", [u]);

  const due = await runDueAdvisors();
  assert.ok(due >= 1, "the worker picks up users whose advisor is on and due");
  const tips = await listTips(u);
  const titles = tips.map((t) => t.title).join(" | ");
  assert.match(titles, /ETH is \+30\.0% above your entry/, titles);
  assert.match(titles, /Broken Bot is error/, titles);
  assert.match(titles, /You've typed “buy \$20 of btc” 3 times/, titles);

  const again = await runAdvisor(u);
  assert.equal(again.length, 0, "the same tips aren't repeated");

  const sched = tips.find((t) => /typed/.test(t.title))!;
  assert.equal(sched.action.type, "prompt");
  const err = tips.find((t) => /Broken Bot/.test(t.title))!;
  assert.equal(err.link, `/bots/${bot.id}`);
  await actOnTip(u, err.id, "dismiss", { isOwner: false });
  assert.ok(!(await listTips(u)).some((t) => t.id === err.id), "dismissed tips disappear");

  await setAdvisor(u, { active: false });
  await q("UPDATE advisor_settings SET next_run_at=now() - interval '1 minute' WHERE user_id=$1", [u]);
  const before = (await listTips(u, 200)).length;
  await runDueAdvisors();
  assert.equal((await listTips(u, 200)).length, before, "nothing runs while it's off");
});
