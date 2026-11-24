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

test("Modo's news facts quote real headlines and rank the ones about your holdings first", async () => {
  const { newsFacts } = await import("@/server/modo/engine");
  const { newUser: nu, freshPrices: fp, ctx: c } = await import("./helpers");
  const { place: pl } = await import("@/server/engine/engine");
  const me = await nu(); await fp();
  await pl({ asset: { symbol: "ETH" }, side: "buy", orderType: "market", notionalUsd: 50, timeInForce: "gtc" }, c(me));
  const now = new Date().toISOString();
  const items = [
    { title: "Fed holds rates steady", url: "https://news.example/fed", source: "Wire", publishedAt: now, summary: "Rates unchanged.", symbols: [] },
    { title: "Ethereum ETF inflows surge to a record", url: "https://news.example/eth", source: "Wire", publishedAt: now, summary: "Inflows rose.", symbols: ["ETH"] },
    { title: "Old story", url: "https://news.example/old", source: "Wire", publishedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), summary: "", symbols: ["BTC"] },
  ];
  const facts = await newsFacts(me, 5, items);
  assert.equal(facts[0].title, "Ethereum ETF inflows surge to a record");
  assert.equal(facts[0].why, "You hold ETH");
  assert.equal(facts[0].tone, "positive");
  assert.equal(facts[0].url, "https://news.example/eth");
  assert.ok(!facts.some((f) => f.title === "Old story"), "stale headlines are dropped");
});
