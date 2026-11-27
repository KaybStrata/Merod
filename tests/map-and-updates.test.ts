import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, assetId } from "./helpers";
import { one, q } from "@/server/db";

const bot = async (u: string, name: string, params: object, status = "running") => {
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  return (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,$2,'dip_rebound_loop',$3,$4,$5) RETURNING id", [u, name, acct.id, status, JSON.stringify(params)]))!.id as string;
};

test("map: a method with a prompt and a map-only skill applies to the bots attached to it, and only those", async () => {
  const { getMap, saveMap, runMap, createMapInstruction } = await import("@/server/map");
  const u = await newUser();
  const a = await bot(u, "Alpha Dip", { take_profit_pct: 20, amount_usd: 10 });
  const b = await bot(u, "Beta Dip", { take_profit_pct: 20, amount_usd: 10 });
  const other = await bot(u, "Gamma Untouched", { take_profit_pct: 20, amount_usd: 10 });
  const sk = await createMapInstruction(u, "skill", "Tight", "always use a 4% stop-loss", false);
  assert.equal(sk.active, false, "a map-only skill isn't switched on everywhere");
  const m = await getMap(u);
  const N = (id: string, type: string, data: any) => ({ id, type, position: { x: 0, y: 0 }, data });
  await saveMap(u, m.id, {
    nodes: [N("p1", "prompt", { text: "take profit 7%, $25 per trade" }), N("s1", "skill", { refId: sk.id, label: "Tight" }), N("m1", "method", { label: "Safe dip" }),
            N("b1", "bot", { refId: a, label: "Alpha Dip" }), N("b2", "bot", { refId: b, label: "Beta Dip" }), N("b3", "bot", { refId: other, label: "Gamma Untouched" })] as any,
    edges: [{ id: "e1", source: "p1", target: "m1" }, { id: "e2", source: "s1", target: "m1" }, { id: "e3", source: "m1", target: "b1" }, { id: "e4", source: "b2", target: "m1" }],
  });
  const r = await runMap(u, m.id, { nodeId: "m1", isOwner: false });
  assert.ok(r.ran >= 2, r.lines.join("\n"));
  for (const id of [a, b]) {
    const p = (await one<any>("SELECT params FROM trading_bots WHERE id=$1", [id]))!.params;
    assert.equal(Number(p.take_profit_pct), 7); assert.equal(Number(p.amount_usd), 25); assert.equal(Number(p.stop_loss_pct), 4);
  }
  const g = (await one<any>("SELECT params FROM trading_bots WHERE id=$1", [other]))!.params;
  assert.equal(Number(g.take_profit_pct), 20, "a bot not attached to the method is unchanged");
  assert.equal(g.stop_loss_pct, undefined);

  // A prompt attached directly to one bot that says "turn off" pauses just that bot.
  await saveMap(u, m.id, { nodes: [N("p2", "prompt", { text: "turn off" }), N("b1", "bot", { refId: a, label: "Alpha Dip" })] as any, edges: [{ id: "e5", source: "p2", target: "b1" }] });
  await runMap(u, m.id, { isOwner: false });
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [a]))!.status, "paused");
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [b]))!.status, "running");
});

test("trade update: finds the losing bot, the big-loss pattern, the losing coin and the winner, and applies a suggestion", async () => {
  const { analyze, createUpdate, applyDecision } = await import("@/server/trade-updates");
  const u = await newUser();
  const loser = await bot(u, "Loser Bot", { amount_usd: 20 });
  const winner = await bot(u, "Winner Bot", { amount_usd: 20 });
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const sol = await assetId("SOL"), btc = await assetId("BTC");
  let k = 0;
  const fill = (ref: string, asset: string, side: string, pnl: number, value = 100) =>
    q(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl)
       VALUES ($1,$2,$3,'paper',$4,'bot',$5,$6,'market',1,true,'filled',1,$7,$8)`, [u, acct.id, asset, `t-${u}-${k++}`, ref, side, value, pnl]);
  for (const pnl of [-9, -8, -10, 1]) { await fill(loser, sol, "buy", 0); await fill(loser, sol, "sell", pnl, 100 + pnl); }
  for (const pnl of [3, 4, 2, -1]) { await fill(winner, btc, "buy", 0); await fill(winner, btc, "sell", pnl, 100 + pnl); }
  const a = await analyze(u, 24);
  assert.equal(a.stats.closed, 8);
  const titles = a.decisions.map((d) => d.title).join(" | ");
  assert.match(titles, /Turn off Loser Bot/, titles);
  assert.match(titles, /Avoid SOL for 7 days/, titles);
  assert.match(titles, /Give Winner Bot more per trade: \$20 → \$25/, titles);
  assert.ok(a.decisions.find((d) => /more per trade/.test(d.title))!.safe === false, "bigger sizes are never 'safe'");
  const up = await createUpdate(u, 24);
  const i = up.decisions.findIndex((d: any) => /Turn off Loser Bot/.test(d.title));
  const res = await applyDecision(u, up.id, i, false);
  assert.match(res.line, /paused/);
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [loser]))!.status, "paused");
  const again = await applyDecision(u, up.id, i, false);
  assert.equal(again.already, true, "applying twice does nothing the second time");
});
