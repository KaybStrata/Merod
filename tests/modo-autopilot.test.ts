import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices, ctx } from "./helpers";
import { one, q } from "@/server/db";
import { place } from "@/server/engine/engine";
import { setModoAutopilot, runModoAutopilotFor } from "@/server/auto/engine";

test("Modo Autopilot reads the signals, trades on its own, explains why, and stops when switched off", async () => {
  const me = await newUser(); await freshPrices();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [me]);
  const doge = (await one<any>("SELECT id, last_price, price_source, change_24h FROM assets WHERE symbol='DOGE' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  await q("UPDATE assets SET change_24h=9, price_source='coingecko', price_updated_at=now() WHERE id=$1", [doge.id]);
  try {
    for (let i = 0; i < 3; i++) await place({ asset: { assetId: doge.id }, side: "buy", orderType: "market", notionalUsd: 100, timeInForce: "gtc" }, ctx(await newUser()));
    assert.deepEqual(await runModoAutopilotFor(me), { skipped: "off" });
    await setModoAutopilot(me, true, 0.3);
    const r: any = await runModoAutopilotFor(me);
    assert.ok(r.ideas >= 1, JSON.stringify(r));
    const t = await one<any>("SELECT * FROM auto_trades WHERE user_id=$1 AND origin='modo' AND symbol='DOGE'", [me]);
    assert.ok(t, "Modo opened a DOGE trade");
    assert.equal(t.mode, "real");
    assert.match(t.explain_before, /\[Modo Autopilot\] Buying DOGE/);
    const o = await one<any>("SELECT source, status FROM orders WHERE id=$1", [t.order_id]);
    assert.equal(o.source, "auto");
    assert.equal(o.status, "filled");
    const s = await one<any>("SELECT modo_thoughts FROM auto_trading WHERE user_id=$1", [me]);
    assert.ok(s.modo_thoughts.some((x: any) => /Bought DOGE/.test(x.text)));
    await setModoAutopilot(me, false);
    assert.deepEqual(await runModoAutopilotFor(me), { skipped: "off" });
  } finally {
    await q("UPDATE assets SET price_source=$2, change_24h=$3 WHERE id=$1", [doge.id, doge.price_source, doge.change_24h]);
  }
});
