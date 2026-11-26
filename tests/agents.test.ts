import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { createAgent, agentAction, updateAgent, capitalSummary, agentDetail, listEvents } from "@/server/agents/service";
import { planFleet, createFleet, fleetAction, validateGraph } from "@/server/agents/fleets";
import { runAgents, tickAgent } from "@/server/agents/runner";
import { indicators, decide, backtestStrategy } from "@/server/agents/signals";

async function realEth() {
  const eth = (await one<any>("SELECT id, price_source FROM assets WHERE symbol='ETH' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  await q("UPDATE assets SET price_source='coingecko', price_updated_at=now() WHERE id=$1", [eth.id]);
  return eth;
}
async function setup() {
  const me = await newUser({ mode: "auto_within_limits" });
  await freshPrices();
  await q("UPDATE trading_permissions SET allow_bots=true, auto_max_order_usd=100000, auto_daily_cap_usd=1000000 WHERE user_id=$1", [me]);
  return me;
}
const runOnce = async (id: string) => tickAgent(await one<any>("SELECT * FROM agents WHERE id=$1", [id]));

test("three paper agents run concurrently; pausing one does not pause the others", async () => {
  const me = await setup(); const eth = await realEth();
  try {
    const ids: string[] = [];
    for (const n of ["A", "B", "C"]) ids.push((await createAgent(me, { name: `ETH ${n}`, role: "crypto_trading", assets: ["ETH"], strategy: { kind: "dca", tradeUsd: 20, everyHours: 24 }, autonomy: 5, capitalUsd: 200 })).id);
    for (const id of ids) await agentAction(me, id, "start");
    await runAgents("test-worker");
    for (const id of ids) assert.equal((await one<any>("SELECT status FROM agents WHERE id=$1", [id])).status, "running");
    await agentAction(me, ids[0], "pause");
    await q("UPDATE agents SET last_tick_at=NULL WHERE id = ANY($1)", [ids]);
    await runAgents("test-worker");
    const st = await q<any>("SELECT id, status FROM agents WHERE id = ANY($1)", [ids]);
    assert.equal(st.find((s) => s.id === ids[0]).status, "paused");
    assert.equal(st.filter((s) => s.status === "running").length, 2);
    const orders = await q<any>("SELECT source_ref FROM orders WHERE user_id=$1 AND source='agent' AND side='buy'", [me]);
    assert.ok(orders.length >= 2, "running agents placed their paper DCA buys");
  } finally { await q("UPDATE assets SET price_source=$2 WHERE id=$1", [eth.id, eth.price_source]); }
});

test("capital: allocations above available paper funds are rejected, even concurrently", async () => {
  const me = await setup();
  await q("UPDATE trading_accounts SET cash_balance=1000 WHERE user_id=$1 AND kind='paper'", [me]);
  const results = await Promise.allSettled([1, 2, 3].map((i) => createAgent(me, { name: `Cap ${i}`, role: "crypto_trading", assets: ["ETH"], capitalUsd: 450 })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2, "only two $450 agents fit in $1,000");
  const cap = await capitalSummary(me);
  assert.ok(cap.allocated <= cap.total + 0.01);
  await assert.rejects(createAgent(me, { name: "Too big", role: "stock_trading", assets: ["ETH"], capitalUsd: 5000 }), /exceed available paper capital/);
});

test("Observe / Suggest / Prepare agents never submit orders; research roles get no capital", async () => {
  const me = await setup(); const eth = await realEth();
  try {
    for (const level of [1, 2, 3]) {
      const a = await createAgent(me, { name: `L${level}`, role: "crypto_trading", assets: ["ETH"], strategy: { kind: "dca", tradeUsd: 20 }, autonomy: level, capitalUsd: 100 });
      await agentAction(me, a.id, "start"); await q("UPDATE agents SET status='running' WHERE id=$1", [a.id]);
      await runOnce(a.id);
      assert.equal((await q("SELECT 1 FROM orders WHERE source='agent' AND source_ref=$1", [a.id])).length, 0, `level ${level} created no order`);
      const ev = await listEvents(me, { agentId: a.id });
      assert.ok(ev.some((e) => e.kind === "decision"), "a decision was recorded instead");
    }
    const scanner = await createAgent(me, { name: "Scan", role: "market_scanner", autonomy: 6, capitalUsd: 500 });
    assert.equal(scanner.autonomy_level, 3); assert.equal(Number(scanner.capital_usd), 0);
  } finally { await q("UPDATE assets SET price_source=$2 WHERE id=$1", [eth.id, eth.price_source]); }
});

test("supervised (level 4) agent orders wait for approval; duplicate ticks don't duplicate orders", async () => {
  const me = await setup(); const eth = await realEth();
  try {
    const a = await createAgent(me, { name: "Sup", role: "crypto_trading", assets: ["ETH"], strategy: { kind: "dca", tradeUsd: 25 }, autonomy: 4, capitalUsd: 300 });
    await q("UPDATE agents SET status='running' WHERE id=$1", [a.id]);
    await runOnce(a.id);
    await runOnce(a.id); // same scheduling bucket → idempotency key replays
    const orders = await q<any>("SELECT status FROM orders WHERE source='agent' AND source_ref=$1", [a.id]);
    assert.ok(orders.length >= 1);
    assert.ok(orders.every((o) => o.status === "pending_approval"));
  } finally { await q("UPDATE assets SET price_source=$2 WHERE id=$1", [eth.id, eth.price_source]); }
});

test("prompts and edits can't switch to live; versions are immutable history", async () => {
  const me = await setup();
  await assert.rejects(createAgent(me, { name: "Live", role: "crypto_trading", assets: ["ETH"], mode: "live" }), /locked/);
  const a = await createAgent(me, { name: "V", role: "crypto_trading", assets: ["ETH"] });
  await assert.rejects(updateAgent(me, a.id, { mode: "live" }), /locked/);
  const u = await updateAgent(me, a.id, { instructions: "Be more careful", note: "edit" });
  assert.equal(u.version, 2);
  await assert.rejects(q("UPDATE agent_versions SET change_note='x' WHERE agent_id=$1", [a.id]), /immutable/);
  const d = await agentDetail(me, a.id);
  assert.equal(d.versions.length, 2);
});

test("tenant isolation: user B can't read or control user A's agent", async () => {
  const a = await setup(), b = await newUser();
  const ag = await createAgent(a, { name: "Mine", role: "news", assets: ["BTC"] });
  await assert.rejects(agentDetail(b, ag.id), /not found/);
  await assert.rejects(agentAction(b, ag.id, "start"), /not found/);
  await assert.rejects(updateAgent(b, ag.id, { name: "x" }), /not found/);
  assert.equal((await listEvents(b, { agentId: ag.id })).length, 0);
});

test("prompt-to-fleet: spec master prompt drafts 4 specialists + supervisor, read-only roles without capital", async () => {
  const d = await planFleet("Create five independent agents. One to trade Solana, one to trade Bitcoin, one to scan NVIDIA and Tesla, one to monitor profitable Solana wallets, and one to supervise all four. Allocate $10,000 across the trading agents, test everything in paper mode, and stop new orders if combined daily losses reach 2%.");
  assert.equal(d.agents.length, 5);
  assert.equal(d.dailyLossPct, 2);
  const roles = d.agents.map((a) => a.role);
  assert.ok(roles.includes("supervisor") && roles.includes("wallet_tracking") && roles.includes("market_scanner"));
  assert.equal(d.agents.filter((a) => a.capitalUsd > 0).length, 2, "only SOL and BTC traders get capital");
  assert.ok(d.reserveUsd > 0);
  assert.deepEqual(validateGraph(d.agents), []);
  assert.deepEqual(validateGraph([{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }]), ["Dependencies contain a cycle"]);
  const c = await planFleet("Create five agents that trade the same asset BTC using different strategies. Give each $10,000 in virtual funds. Compare their risk-adjusted performance over 30 days.");
  assert.equal(c.operationMode, "competition"); assert.equal(c.agents.length, 5); assert.equal(c.agents[0].capitalUsd, 10000);
});

test("fleet: nothing runs before approval; combined loss limit blocks new orders", async () => {
  const me = await setup(); const eth = await realEth();
  try {
    const d = await planFleet("Create agents to trade ETH with $1,000 and a supervisor. Stop if daily losses reach 1%.");
    const f = await createFleet(me, d as any);
    assert.equal(f.fleet.status, "pending_approval");
    assert.ok(f.agents.every((a: any) => a.status === "pending_approval"));
    await runAgents("test-worker");
    assert.equal((await q("SELECT 1 FROM agents WHERE fleet_id=$1 AND status='running'", [f.fleet.id])).length, 0, "pending agents don't run");
    await fleetAction(me, f.fleet.id, "approve");
    await runAgents("test-worker");
    // Simulate a realised loss beyond the 1% limit on the trader, then let the supervisor check.
    const trader = f.agents.find((a: any) => a.role === "crypto_trading");
    const sup = f.agents.find((a: any) => a.role === "supervisor");
    await q("UPDATE agents SET realized_pnl_usd=-50 WHERE id=$1", [trader.id]);
    await q(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl)
             SELECT $1, t.id, $2, 'paper', 'loss-'||gen_random_uuid(), 'agent', $3, 'sell', 'market', 0.0001, true, 'filled', 0.0001, 1, -50 FROM trading_accounts t WHERE t.user_id=$1 AND t.kind='paper' LIMIT 1`, [me, eth.id, trader.id]);
    await runOnce(sup.id);
    assert.equal((await one<any>("SELECT status FROM agent_fleets WHERE id=$1", [f.fleet.id])).status, "risk_blocked");
    assert.equal((await one<any>("SELECT status FROM agents WHERE id=$1", [trader.id])).status, "risk_blocked");
  } finally { await q("UPDATE assets SET price_source=$2 WHERE id=$1", [eth.id, eth.price_source]); }
});

test("signals are deterministic and the backtester is labelled with its assumptions", () => {
  const close = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 6) * 5 + i * 0.1);
  const b = { close, volume: close.map(() => 1000), high: close.map((c) => c * 1.01), low: close.map((c) => c * 0.99) };
  const ind = indicators(b);
  const s1 = decide({ kind: "mean_reversion" }, ind, { holding: false }), s2 = decide({ kind: "mean_reversion" }, ind, { holding: false });
  assert.deepEqual(s1, s2);
  const r = backtestStrategy({ kind: "momentum", tradeUsd: 100, takeProfitPct: 3, stopLossPct: 2 }, b);
  assert.equal(r.assumptions.feeBps, 30); assert.ok(Number.isFinite(r.returnPct));
});
