import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { autonPnl } from "@/server/auton/pnl";

test("Auton P&L: only Auton's bots count; this period vs the previous period of the same length", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const asset = (await one<any>("SELECT id FROM assets WHERE symbol='SOL' LIMIT 1"))!;
  const mk = async (name: string) => (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,$2,'dip_rebound_loop',$3,'running','{\"amount_usd\":10}') RETURNING id", [u, name, acct.id]))!;
  const mine = await mk("Auton bot"), other = await mk("My own bot");
  await q("INSERT INTO auton_assets (user_id, kind, ref_id, label) VALUES ($1,'bot',$2,'x')", [u, String(mine.id)]);
  const order = (bot: string, side: string, px: number, pnl: number | null, minsAgo: number) => q(
    `INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl, updated_at)
     VALUES ($1,$2,$3,'paper',$4,'bot',$5,$6,'market',1,true,'filled',1,$7,$8, now() - make_interval(mins => $9::int))`, [u, acct.id, asset.id, randomUUID(), bot, side, px, pnl ?? 0, minsAgo]);
  // Previous hour: +3. This hour: +5. Someone else's bot: +100 (ignored).
  await order(String(mine.id), "buy", 10, null, 108); await order(String(mine.id), "sell", 13, 3, 90);
  await order(String(mine.id), "buy", 10, null, 30); await order(String(mine.id), "sell", 15, 5, 12);
  await order(String(other.id), "buy", 10, null, 30); await order(String(other.id), "sell", 110, 100, 12);
  const r = await autonPnl(u, 3600);
  assert.equal(r.realized, 8);
  assert.equal(r.period.realized, 5);
  assert.equal(r.previous!.pnl, 3);
  assert.equal(r.period.closed, 1); assert.equal(r.previous!.closed, 1);
  const all = await autonPnl(u, null);
  assert.equal(all.period.realized, 8); assert.equal(all.previous, null);
});
