import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { mimicTop, mimicSettings } from "@/server/copy/directory";
import { parseMimicTop } from "@/server/copy/leaders";

test("prompt box: 'mimic the top 50 stock and crypto traders this week' runs right away for the owner, is refused for others", async () => {
  const { handlePrompt } = await import("@/server/ai/interpret");
  const owner = await newUser(), other = await newUser();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [owner]);
  try {
    const r: any = await handlePrompt(owner, { text: "mimic the top 50 stock and crypto traders this week" } as any);
    const msg = JSON.stringify(r);
    assert.match(msg, /Done\./, msg.slice(0, 300));
    assert.match(msg, /Stock traders: \d+/);
    const o: any = await handlePrompt(other, { text: "mimic the top 50 stock and crypto traders this week" } as any);
    assert.match(JSON.stringify(o), /only available on the platform owner/);
  } finally { await q("UPDATE users SET role='user' WHERE id=$1", [owner]); }
});

test("prompt parser: counts, markets, window, real money and $ per trade", () => {
  assert.deepEqual(parseMimicTop("mimic the top 50 stock and crypto traders this week"), { count: 50, crypto: true, stocks: true, period: "7d", live: false, perTradeUsd: null, maxDailyUsd: null });
  const r = parseMimicTop("mimic top 10 wallets today with real money, $20 each")!;
  assert.equal(r.count, 10); assert.equal(r.live, true); assert.equal(r.perTradeUsd, 20); assert.equal(r.period, "today"); assert.equal(r.stocks, false);
  assert.equal(parseMimicTop("mimic the top ROI earner for Solana meme coins this week"), null, "single-trader requests keep the existing flow");
  assert.equal(parseMimicTop("buy 50 SOL"), null);
  assert.equal(parseMimicTop("mimic the top 500 traders")!.count, 50, "capped at 50");
});

test("mimicTop: paper stock mimics are created with a stocks-only scope; real money without a broker fails softly", async () => {
  const leader = await newUser(), me = await newUser();
  await q("UPDATE user_profiles SET allow_copy_trading=true, is_public=true WHERE user_id=$1", [leader]);
  const stock = (await one<any>("SELECT id FROM assets WHERE asset_class='stock' LIMIT 1"))!;
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [leader]))!;
  await q(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl)
           VALUES ($1,$2,$3,'paper',gen_random_uuid()::text,'manual','sell','market',1,true,'filled',1,100,25)`, [leader, acct.id, stock.id]);
  const r = await mimicTop(me, { count: 5, crypto: false, stocks: true, period: "7d", perTradeUsd: 15 });
  assert.ok(r.stocks.done >= 1, JSON.stringify(r));
  const f = await one<any>("SELECT * FROM copy_follows WHERE follower_id=$1 AND leader_user_id=$2", [me, leader]);
  assert.equal(f.sizing, "fixed"); assert.equal(Number(f.fixed_usd), 15);
  assert.deepEqual(f.scope.assetClasses, ["stock", "etf"]);
  const live = await mimicTop(me, { count: 5, crypto: true, stocks: true, period: "7d", live: true });
  assert.match(live.stocks.note, /live stock broker/, "no broker → explained, not thrown");
  assert.match(live.crypto.note, /Merod Wallet/, "no Merod Wallet → explained, not thrown");
  await assert.rejects(mimicSettings(me, "crypto", { live: true }), /Merod Wallet/);
});
