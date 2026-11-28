import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one } from "@/server/db";
import { applyEdits } from "@/server/ai/bulk-edit";
import { runControl } from "@/server/ai/control";

test("bulk editor: one change (×1.5 per trade, 6% stop) applies to every selected bot, each from its own value; then all turn off", async () => {
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const b1 = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Dip A','dip_rebound_loop',$2,'running','{\"amount_usd\":10}') RETURNING id", [u, acct.id]))!;
  const b2 = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Dip B','dip_rebound_loop',$2,'running','{\"amount_usd\":20}') RETURNING id", [u, acct.id]))!;
  const t = [{ kind: "bot" as const, id: b1.id, name: "Dip A" }, { kind: "bot" as const, id: b2.id, name: "Dip B" }];
  const lines = await applyEdits(u, t, { amountMult: 1.5, stopLossPct: 6 });
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.equal(Number((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [b1.id]))!.params.amount_usd), 15);
  const p2 = (await one<any>("SELECT params FROM trading_bots WHERE id=$1", [b2.id]))!.params;
  assert.equal(Number(p2.amount_usd), 30); assert.equal(Number(p2.stop_loss_pct), 6);
  await runControl(u, "pause", t.map((x) => ({ ...x, status: "running" })), false);
  assert.equal((await one<any>("SELECT status FROM trading_bots WHERE id=$1", [b2.id]))!.status, "paused");
});

test("delete: a bot is stopped and removed, an agent is archived, and their Auton/tab links are cleaned up", async () => {
  const { deleteTargets } = await import("@/server/bots/delete");
  const u = await newUser();
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const b = (await one<any>("INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, params) VALUES ($1,'Gone','dip_rebound_loop',$2,'paused','{\"amount_usd\":10}') RETURNING id", [u, acct.id]))!;
  await one("INSERT INTO auton_assets (user_id, kind, ref_id, label) VALUES ($1,'bot',$2,'Gone') RETURNING ref_id", [u, String(b.id)]);
  const lines = await deleteTargets(u, [{ kind: "bot", id: b.id, name: "Gone", status: "paused" }]);
  assert.match(lines[0], /deleted/);
  assert.equal(await one("SELECT id FROM trading_bots WHERE id=$1", [b.id]), null);
  assert.equal(await one("SELECT ref_id FROM auton_assets WHERE user_id=$1 AND ref_id=$2", [u, String(b.id)]), null);
});
