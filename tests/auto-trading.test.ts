import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, ctx } from "./helpers";
import { one, q } from "@/server/db";
import { place } from "@/server/engine/engine";
import { saveSettings, runFor, overview, scoreSignals, DEFAULT_WEIGHTS } from "@/server/auto/engine";

test("scores agree only when the data points agree", () => {
  const s = (v: number[]) => ({ merod: { value: v[0], evidence: "" }, thirdParty: { value: v[1], evidence: "" }, modo: { value: v[2], evidence: "" }, backtest: { value: v[3], evidence: "" }, momentum: { value: v[4], evidence: "" } });
  const strong = scoreSignals(s([0.8, 0.6, 0.7, 0.4, 0.5]), DEFAULT_WEIGHTS);
  const mixed = scoreSignals(s([0.8, -0.6, 0.7, -0.4, -0.5]), DEFAULT_WEIGHTS);
  assert.ok(strong.confidence > 0.8 && strong.score > 0.5);
  assert.ok(mixed.confidence < 0.5);
});

test("auto trading tests theoretically first, learns, then trades for real, and the switch stops it", async () => {
  const me = await newUser(), other = await newUser();
  await freshPrices();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [me]);
  const eth = (await one<any>("SELECT id, last_price, price_source, change_24h FROM assets WHERE symbol='ETH' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  // Treat ETH's price as a real feed for this test.
  await q("UPDATE assets SET price_source='coingecko', change_24h=5, price_updated_at=now() WHERE id=$1", [eth.id]);
  try {
    await place({ asset: { assetId: eth.id }, side: "buy", orderType: "market", notionalUsd: 200, timeInForce: "gtc" }, ctx(other));
    await q(`INSERT INTO modo_ideas (user_id, asset_id, symbol, side, thesis, signals, confidence, price_at, price_source) VALUES ($1,$2,'ETH','buy','Flows and momentum agree','{}',0.8,$3,'coingecko')`, [me, eth.id, eth.last_price]);
    await saveSettings(me, { enabled: true, minConfidence: 0.4, minTheoryTrades: 3, minTheoryWinRate: 0.5, tradeUsd: 50, takeProfitPct: 3, stopLossPct: 2 });

    // 1) First decision is theoretical: no order, but Modo explains the data points.
    await runFor(me);
    const t1 = await one<any>("SELECT * FROM auto_trades WHERE user_id=$1 AND asset_id=$2", [me, eth.id]);
    assert.equal(t1.mode, "theory");
    assert.equal(t1.order_id, null);
    assert.match(t1.explain_before, /Merod traders \+/);
    assert.match(t1.explain_before, /Modo \+0\.80/);
    assert.match(t1.explain_before, /building the theoretical record first/);

    // 2) Price rises past take-profit → graded as a theoretical win with an "after" explanation.
    await q("UPDATE assets SET last_price = last_price * 1.05, price_updated_at=now() WHERE id=$1", [eth.id]);
    await q("UPDATE auto_trading SET last_run_at=NULL WHERE user_id=$1", [me]);
    await runFor(me);
    const g = await one<any>("SELECT * FROM auto_trades WHERE id=$1", [t1.id]);
    assert.equal(g.status, "closed");
    assert.ok(Number(g.return_pct) > 3);
    assert.match(g.explain_after, /take-profit/);

    // (After closing, it may already have opened a fresh theoretical ETH trade; clear it so the next pass decides again.)
    await q("DELETE FROM auto_trades WHERE user_id=$1 AND status='open'", [me]);
    await q("UPDATE auto_trading SET last_run_at=NULL WHERE user_id=$1", [me]);
    // 3) With a proven theoretical record, the next decision is a real (paper-account) order through the engine.
    for (let i = 0; i < 3; i++)
      await q(`INSERT INTO auto_trades (user_id, asset_id, symbol, side, mode, status, signals, score, confidence, entry_price, exit_price, return_pct, explain_before, closed_at)
               VALUES ($1,$2,'ETH','buy','theory','closed','{}',0.5,0.7,1,1.04,4,'x',now())`, [me, eth.id]);
    await runFor(me);
    const t2 = await one<any>("SELECT * FROM auto_trades WHERE user_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1", [me]);
    assert.equal(t2.mode, "real", t2.explain_before);
    const o = await one<any>("SELECT source, status, notional_usd FROM orders WHERE id=$1", [t2.order_id]);
    assert.equal(o.source, "auto");
    assert.equal(o.status, "filled");
    assert.match(t2.explain_during, /Order filled/);

    // 4) The switch stops everything.
    await saveSettings(me, { enabled: false });
    assert.deepEqual(await runFor(me), { skipped: "off" });
    const ov = await overview(me);
    assert.equal(ov.settings.enabled, false);
    assert.ok(ov.trades.length >= 2);
  } finally {
    await q("UPDATE assets SET price_source=$2, change_24h=$3, last_price=$4 WHERE id=$1", [eth.id, eth.price_source, eth.change_24h, eth.last_price]);
  }
});
