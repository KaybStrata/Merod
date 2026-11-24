import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, ctx } from "./helpers";
import { one, q } from "@/server/db";
import { place } from "@/server/engine/engine";
import { think, learn, modoState } from "@/server/modo/engine";

test("Modo thinks in visible steps, turns agreeing signals into an idea, then grades and learns from it", async () => {
  const me = await newUser(); await freshPrices();
  // Other traders pile into DOGE while it's up 9% → trader-flow and momentum agree.
  await q("UPDATE assets SET change_24h=9 WHERE symbol='DOGE'");
  for (let i = 0; i < 3; i++) await place({ asset: { symbol: "DOGE" }, side: "buy", orderType: "market", notionalUsd: 100, timeInForce: "gtc" }, ctx(await newUser()));
  const steps: string[] = [];
  const ideas = await think(me, (t) => { steps.push(t); });
  assert.ok(steps.length >= 5, "streams several steps");
  assert.ok(steps.some((s) => /traders?/.test(s) && /DOGE/.test(s)), steps.join("\n"));
  const doge = ideas.find((i: any) => i.symbol === "DOGE");
  assert.ok(doge, "proposes DOGE");
  assert.equal(doge.side, "buy");
  assert.ok(Number(doge.confidence) <= 0.85);
  // Pretend 25h passed and DOGE rose 10%: the idea is graded a win.
  await q("UPDATE modo_ideas SET created_at = now() - interval '25 hours' WHERE user_id=$1", [me]);
  await q("UPDATE assets SET last_price = last_price * 1.10 WHERE symbol='DOGE'");
  await learn(); await learn(); // 1h grade, then 24h grade
  const graded = await one<any>("SELECT ret_1h, ret_24h FROM modo_ideas WHERE id=$1", [doge.id]);
  assert.ok(Number(graded.ret_24h) > 0.09);
  const st = await modoState(me);
  assert.ok(st.stats.graded >= 1);
  await q("UPDATE assets SET change_24h=0 WHERE symbol='DOGE'"); await freshPrices();
});
