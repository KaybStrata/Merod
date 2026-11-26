import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { DIAL_MAX_S, DIAL_MIN_S, dialToSec, secLabel, secToDial } from "@/lib/timeDial";
import { buildReview, runScheduledReviews } from "@/server/review/build";
import { investedPaper } from "@/server/review/invested";

test("time dial: round-trips, bounds 60s and 5y, labels", () => {
  assert.equal(dialToSec(0), DIAL_MIN_S); assert.equal(dialToSec(100), DIAL_MAX_S);
  for (const s of [60, 3600, 86_400, 1_555_200, 31_536_000, DIAL_MAX_S]) assert.ok(Math.abs(dialToSec(secToDial(s)) - s) / s < 0.001, `round-trip ${s}`);
  assert.equal(secLabel(2700), "45m"); assert.equal(secLabel(21_600), "6h"); assert.equal(secLabel(1_555_200), "18d"); assert.equal(secLabel(4.5 * 30 * 86_400), "4.5mo"); assert.equal(secLabel(2.1 * 365 * 86_400), "2.1y");
});

async function seed() {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const sol = (await one<any>("SELECT id FROM assets WHERE symbol='SOL' LIMIT 1"))!;
  const btc = (await one<any>("SELECT id FROM assets WHERE symbol='BTC' LIMIT 1"))!;
  const order = (asset: string, side: string, source: string, pnl: number, fee: number, ago: string, status = "filled") =>
    q(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl, fees_usd, updated_at, created_at, checks)
       VALUES ($1,$2,$3,'paper',gen_random_uuid()::text,$4,$5,'market',1,true,$6,$7,100,$8,$9, now() - $10::interval, now() - $10::interval, $11)`,
      [u, acct.id, asset, source, side, status, status === "filled" ? 1 : 0, pnl, fee, ago, JSON.stringify(status === "rejected" ? [{ name: "liquidity", ok: false, message: "Liquidity $9,000 vs min $50,000" }] : [])]);
  await order(sol.id, "buy", "prompt", 0, 0.5, "3 days");
  await order(sol.id, "sell", "prompt", 40, 0.5, "2 days");
  await order(btc.id, "buy", "manual", 0, 1, "2 days");
  await order(btc.id, "sell", "manual", -15, 1, "1 day");
  await order(sol.id, "sell", "prompt", 10, 0.5, "1 day");
  await order(btc.id, "sell", "manual", -5, 1, "40 days"); // outside a 1W window
  await order(sol.id, "buy", "bot", 0, 0, "5 hours", "rejected");
  return { u, acct };
}

test("buildReview: worked/didn't ordering, by-source sums, win rate, fees, saved, Break even = investedPaper", async () => {
  const { u } = await seed();
  const r = await buildReview(u, { seconds: 7 * 86_400 });
  assert.deepEqual(r.worked.map((w) => [w.label, w.pnl]), [["Ask Merod · SOL", 50]]);
  assert.deepEqual(r.didnt.map((w) => [w.label, w.pnl]), [["You · BTC (manual)", -15]]);
  const by = Object.fromEntries(r.bySource.map((s) => [s.source, s]));
  assert.equal(by.prompt.pnl, 50); assert.equal(by.prompt.trades, 3); assert.equal(by.manual.pnl, -15); assert.equal(by.manual.trades, 2);
  assert.equal(r.pnl.realized, 35, "realized in the window only (the 40-day-old sell is outside)");
  assert.equal(r.habits.closed, 3); assert.ok(Math.abs(r.habits.winRate! - (2 / 3) * 100) < 1e-9);
  assert.equal(r.habits.feesUsd, 3.5);
  assert.ok(r.habits.avgHoldSec! > 0);
  assert.equal(r.saved.length, 1); assert.match(r.saved[0].detail, /Buy SOL blocked: Liquidity \$9,000 vs min \$50,000/);
  assert.equal(r.saved[0].estAvoided, undefined, "no bars → no loss-avoided estimate");
  assert.equal(r.pnl.invested, await investedPaper(u));
  // Totals reconcile: with no snapshot, change = realized in window + current unrealized (labelled estimated).
  assert.equal(r.estimated, true); assert.ok(Math.abs(r.pnl.change - (r.pnl.realized + r.pnl.unrealized)) < 0.01);
  await assert.rejects(buildReview(u, { seconds: 30 }), /between 1 minute and 5 years/);
  await assert.rejects(buildReview(u, { seconds: 6 * 365 * 86_400 }), /between 1 minute and 5 years/);
  const c = await buildReview(u, { seconds: 7 * 86_400, compare: true });
  assert.equal(typeof c.pnl.previous, "number", "compare returns the previous window");
});

test("scheduled review: when due, the worker sends one notification and advances next_at", async () => {
  const { u } = await seed();
  await q("INSERT INTO review_schedules (user_id, every_sec, next_at) VALUES ($1, 86400, now() - interval '1 minute')", [u]);
  const before = (await one<any>("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1", [u]))!.n;
  assert.ok((await runScheduledReviews()) >= 1);
  const after = (await one<any>("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1", [u]))!.n;
  assert.equal(after - before, 1);
  const s = (await one<any>("SELECT next_at FROM review_schedules WHERE user_id=$1", [u]))!;
  assert.ok(new Date(s.next_at).getTime() > Date.now() + 86_000_000, "next_at advanced by every_sec");
  assert.equal(await runScheduledReviews().then(async () => (await one<any>("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1", [u]))!.n), after, "not sent twice");
});
