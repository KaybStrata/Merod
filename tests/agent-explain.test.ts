import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { explainEvent, rateEvent, agreement } from "@/server/agents/explain";

async function setup() {
  const u = await newUser();
  const { createAgent } = await import("@/server/agents/service");
  const a: any = await createAgent(u, { name: "Vega", role: "crypto_trading", strategy: { kind: "momentum", minChangePct: 1.5, rsiMax: 75, takeProfitPct: 5, stopLossPct: 4, tradeUsd: 100 } as any, autonomy: 5 });
  const agentId = a.id ?? a.agent?.id;
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const sol = (await one<any>("SELECT id FROM assets WHERE symbol='SOL' LIMIT 1"))!;
  await q("UPDATE assets SET last_price=150, price_updated_at=now() WHERE id=$1", [sol.id]);
  const o = (await one<any>(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, checks)
     VALUES ($1,$2,$3,'paper',gen_random_uuid()::text,'agent',$4,'buy','market',2,true,'filled',2,139.1,$5) RETURNING id`,
    [u, acct.id, sol.id, agentId, JSON.stringify([{ name: "max_order", ok: true, message: "ok" }, { name: "daily_spend", ok: true, message: "ok" }])]))!;
  const inputs = { price: 139.1, rsi14: 64, macd: 0.8, change24hPct: 3.2, volumeRise: 3.1, sma20: 130, high20: 138.42, low20: 120, bars: 200 };
  const ev = (await one<any>(`INSERT INTO agent_events (user_id, agent_id, version, kind, title, body, data) VALUES ($1,$2,7,'execution','Buy order filled','Momentum',$3) RETURNING id`,
    [u, agentId, JSON.stringify({ orderId: o.id, status: "filled", side: "buy", assetId: sol.id, price: 139.1, inputs, signal: { action: "buy", reason: "Momentum: 24h 3.20% ≥ 1.5%, MACD positive, RSI 64 < 75" } })]))!;
  const bare = (await one<any>("INSERT INTO agent_events (user_id, agent_id, kind, title, data) VALUES ($1,$2,'decision','Suggests: Buy SOL','{}') RETURNING id", [u, agentId]))!;
  return { u, agentId, ev: Number(ev.id), bare: Number(bare.id) };
}

test("explain: built only from recorded inputs; no-input events say so; cached", async () => {
  const { u, ev, bare } = await setup();
  const w: any = await explainEvent(u, ev);
  assert.match(w.text, /Vega bought 2 SOL at \$139\.10 because 24h change was 3\.20% \(needs ≥ 1\.5%\), MACD was positive and RSI\(14\) was 64 \(needs < 75, not overbought\)/, w.text);
  assert.match(w.text, /stop at \$133\.54/, "stop from the recorded fill price and the strategy's 4%");
  // Every number in the explanation comes from the recorded inputs, fill or strategy.
  const allowed = new Set(["24", "2", "139.10", "3.20", "1.5", "14", "64", "75", "133.54", "146.06"]);
  for (const n of w.text.match(/\d+(?:\.\d+)?/g) ?? []) assert.ok(allowed.has(n), `unexpected number ${n} in: ${w.text}`);
  assert.equal(w.rows.find((r: any) => r.input === "RSI(14)").ok, true);
  assert.equal(w.checks.length, 2); assert.equal(w.result.kind, "unrealized");
  assert.equal((await one<any>("SELECT data->>'explanation' AS x FROM agent_events WHERE id=$1", [ev]))!.x, w.text, "cached in data.explanation");
  const b: any = await explainEvent(u, bare);
  assert.equal(b.text, "No recorded inputs for this decision."); assert.equal(b.hasInputs, false);
  const other = await newUser();
  await assert.rejects(explainEvent(other, ev), /not found/i, "own events only");
});

test("feedback: upsert one vote per event, own events only, valid reasons, agreement %", async () => {
  const { u, agentId, ev, bare } = await setup();
  await rateEvent(u, ev, 1, ["good_call"]);
  await rateEvent(u, ev, -1, ["too_big"]); // re-vote updates
  assert.equal((await one<any>("SELECT count(*)::int AS n FROM agent_trade_feedback WHERE event_id=$1", [ev]))!.n, 1);
  await rateEvent(u, bare, 1);
  const ag = await agreement(u, agentId);
  assert.equal(ag.rated, 2); assert.equal(ag.agreedPct, 50);
  await assert.rejects(rateEvent(u, ev, 1, ["because"]), /Unknown reason/);
  const other = await newUser();
  await assert.rejects(rateEvent(other, ev, 1), /not found/i);
  const mem = (await one<any>("SELECT memory FROM agents WHERE id=$1", [agentId]))!.memory;
  assert.ok((mem.lessons ?? []).some((l: any) => /Too big/.test(l.text)), "👎 with a reason becomes a lesson");
});

test("feedback: 5 matching 👎 reasons create exactly one training candidate; the agent's rules don't change", async () => {
  const { u, agentId } = await setup();
  const before = (await one<any>("SELECT strategy, version FROM agents WHERE id=$1", [agentId]))!;
  for (let i = 0; i < 6; i++) {
    const e = (await one<any>("INSERT INTO agent_events (user_id, agent_id, kind, title, data) VALUES ($1,$2,'execution','x','{\"side\":\"buy\",\"inputs\":{\"price\":1}}') RETURNING id", [u, agentId]))!;
    await rateEvent(u, Number(e.id), -1, ["too_big"]);
  }
  const c = await q<any>("SELECT * FROM agent_training_candidates WHERE agent_id=$1 AND diagnosis->>'source'='feedback'", [agentId]);
  assert.equal(c.length, 1, "exactly one proposal");
  assert.equal(c[0].status, "proposed"); assert.equal(c[0].proposed.tradeUsd, 75);
  const after = (await one<any>("SELECT strategy, version FROM agents WHERE id=$1", [agentId]))!;
  assert.deepEqual(after.strategy, before.strategy, "rules unchanged until you approve"); assert.equal(after.version, before.version);
});
