import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { compile, createStrategy } from "@/server/lab/strategies";
import { createSession, act, listSessions, sessionDetail } from "@/server/lab/sessions";

async function setup(me: string, text: string) {
  await q("UPDATE trading_permissions SET allow_bots=true WHERE user_id=$1", [me]);
  const c = await compile({ text });
  assert.equal(c.ok, true, c.errors.join(";"));
  const { version } = await createStrategy(me, { ...c.draft!, approvalPolicy: "auto" });
  return version;
}

test("session lifecycle: DRAFT → RUNNING → PAUSED → RUNNING → STOPPED → ARCHIVED, with revisions and history", async () => {
  const me = await newUser(); await freshPrices();
  const eth = (await one<any>("SELECT id, price_source FROM assets WHERE symbol='ETH' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  await q("UPDATE assets SET price_source='coingecko', price_updated_at=now() WHERE id=$1", [eth.id]);
  try {
    const v = await setup(me, "buy $50 of ETH after a 3% dip and sell at 5% profit, repeat");
    let s: any = await createSession(me, { title: "ETH swing", strategyVersionId: v.id, allocationUsd: 500 });
    assert.equal(s.state, "DRAFT");
    await assert.rejects(act(me, s.id, "start", s.revision + 5), /changed in the meantime/, "stale revision is refused");
    s = await act(me, s.id, "start", s.revision);
    assert.equal(s.state, "RUNNING", s.last_error);
    assert.ok(s.bot_id, "an executor bot is attached");
    assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [s.bot_id])).status, "running");
    s = await act(me, s.id, "pause", s.revision);
    assert.equal(s.state, "PAUSED");
    assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [s.bot_id])).status, "paused");
    s = await act(me, s.id, "resume", s.revision);
    assert.equal(s.state, "RUNNING");
    await assert.rejects(act(me, s.id, "archive", s.revision), /Stop the session/);
    s = await act(me, s.id, "stop", s.revision);
    assert.equal(s.state, "STOPPED");
    s = await act(me, s.id, "archive", s.revision);
    assert.equal(s.state, "ARCHIVED");
    const d = await sessionDetail(me, s.id);
    assert.ok(d.events.length >= 8, "every transition is recorded");
    assert.equal((await listSessions(me)).length, 0, "archived sessions are hidden by default");
  } finally {
    await q("UPDATE assets SET price_source=$2 WHERE id=$1", [eth.id, eth.price_source]);
  }
});

test("sessions can't over-allocate the account, and user B can't control user A's session", async () => {
  const me = await newUser(); await freshPrices();
  const eth = (await one<any>("SELECT id, price_source FROM assets WHERE symbol='ETH' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  await q("UPDATE assets SET price_source='coingecko', price_updated_at=now() WHERE id=$1", [eth.id]);
  await q("UPDATE trading_accounts SET cash_balance=1000 WHERE user_id=$1 AND kind='paper'", [me]);
  try {
    const v = await setup(me, "buy $50 of ETH after a 3% dip and sell at 5% profit, repeat");
    let a: any = await createSession(me, { title: "A", strategyVersionId: v.id, allocationUsd: 700 });
    let b: any = await createSession(me, { title: "B", strategyVersionId: v.id, allocationUsd: 700 });
    a = await act(me, a.id, "start", a.revision);
    assert.equal(a.state, "RUNNING", a.last_error);
    b = await act(me, b.id, "start", b.revision);
    assert.equal(b.state, "BLOCKED");
    assert.match(b.last_error, /Not enough unallocated capital/);
    const other = await newUser();
    await assert.rejects(act(other, a.id, "pause", a.revision), /not found/);
    await assert.rejects(sessionDetail(other, a.id), /not found/);
    // Clone makes a new DRAFT with the same version.
    const c = await act(me, a.id, "clone", a.revision);
    assert.equal(c.state, "DRAFT");
    assert.equal(c.strategy_version_id, v.id);
  } finally {
    await q("UPDATE assets SET price_source=$2 WHERE id=$1", [eth.id, eth.price_source]);
  }
});
