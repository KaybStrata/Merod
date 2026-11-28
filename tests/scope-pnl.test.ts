import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { scopePnl } from "@/server/pnl-scope";

test("P&L per group: bots, Mimic and all trades each count only their own trades; one bot alone; empty still draws a line", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const asset = (await one<any>("SELECT id FROM assets WHERE symbol='SOL' LIMIT 1"))!;
  const empty = await scopePnl(u, "bot", 3600);
  assert.equal(empty.orders, 0);
  assert.ok(empty.points.length >= 2, "a flat line from $0 even with no trades");
  const order = (source: string, ref: string, side: string, px: number, pnl: number, mins: number) => q(
    `INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl, updated_at)
     VALUES ($1,$2,$3,'paper',$4,$5,$6,$7,'market',1,true,'filled',1,$8,$9, now() - make_interval(mins => $10::int))`, [u, acct.id, asset.id, randomUUID(), source, ref, side, px, pnl, mins]);
  const b1 = randomUUID(), b2 = randomUUID();
  await order("bot", b1, "buy", 10, 0, 30); await order("bot", b1, "sell", 14, 4, 20);
  await order("bot", b2, "buy", 10, 0, 30); await order("bot", b2, "sell", 11, 1, 20);
  await order("copy", "m", "buy", 10, 0, 30); await order("copy", "m", "sell", 20, 10, 20);
  assert.equal((await scopePnl(u, "bot", 3600)).period.realized, 5);
  assert.equal((await scopePnl(u, "copy", 3600)).period.realized, 10);
  assert.equal((await scopePnl(u, "trades", 3600)).period.realized, 15);
  assert.equal((await scopePnl(u, "bot", 3600, null, b1)).period.realized, 4, "one bot alone");
});
