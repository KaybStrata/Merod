import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { autoModeCommand, listModes, setMode, runGainer, runAdjuster } from "@/server/auto-modes";
import { handlePrompt } from "@/server/ai/interpret";

async function botWithAsset(u: string, params: Record<string, unknown>, change24h = 10) {
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const asset = (await one<any>(`INSERT INTO assets (asset_class, symbol, name, venue, identifier, last_price, price_source, price_updated_at, change_24h, volume_24h)
     VALUES ('crypto', $1, 'Auto test', 'solana', $2, 1, 'dexscreener', now(), $3, 1000000) RETURNING id`, [`ZZA${tag}`, `test-${tag}`, change24h]))!;
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const b = (await one<any>(`INSERT INTO trading_bots (user_id, name, strategy_id, account_id, status, asset_ids, params)
     VALUES ($1, $2, 'dip_rebound_loop', $3, 'running', ARRAY[$4::uuid], $5) RETURNING *`, [u, `Bot ${tag}`, acct.id, asset.id, JSON.stringify(params)]))!;
  return { b, asset, acct };
}

test("auto switches: prompts turn them on/off (all or one bot); auto trainer mirrors the trainer setting", async () => {
  const u = await newUser();
  const r = await autoModeCommand(u, "turn on auto gainer and auto scanner");
  assert.match(r!, /Auto gainer ON/); assert.match(r!, /Auto scanner ON/);
  let m = await listModes(u);
  assert.equal(m.global.find((g) => g.mode === "gainer")!.active, true);
  assert.equal(m.global.find((g) => g.mode === "adjuster")!.active, false);
  await autoModeCommand(u, "turn off auto trainer");
  assert.equal((await one<any>("SELECT enabled FROM auto_training_settings WHERE user_id=$1", [u]))!.enabled, false);
  await autoModeCommand(u, "turn on all auto switches");
  m = await listModes(u);
  assert.ok(m.global.every((g) => g.active), JSON.stringify(m.global));
  // Through the prompt box, and "auto trading" is NOT an auto switch.
  const res: any = await handlePrompt(u, { text: "auto gainer off" });
  assert.match(res.message.content, /Auto gainer off/);
  assert.equal(await autoModeCommand(u, "turn off all auto trading"), null);
});

test("auto gainer: a winning sell grows $ per trade by part of the profit (capped); a loss shrinks it back toward the start", async () => {
  const u = await newUser();
  const { b, asset, acct } = await botWithAsset(u, { amount_usd: 100, take_profit_pct: 5, dip_pct: 3 });
  await setMode(u, "gainer", true, "bot", b.id, { share: 0.5 });
  const row = await one<any>("SELECT * FROM auto_modes WHERE user_id=$1 AND mode='gainer'", [u]);
  row.state = { since: new Date(Date.now() - 60_000).toISOString() };
  const sell = (pnl: number) => q(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl)
     VALUES ($1,$2,$3,'paper',$4,'bot',$5,'sell','market',1,true,'filled',1,1,$6)`, [u, acct.id, asset.id, randomUUID(), String(b.id), pnl]);
  await sell(40);
  await runGainer(row);
  assert.equal(Number((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [b.id]))!.params.amount_usd), 120);
  const row2 = await one<any>("SELECT * FROM auto_modes WHERE id=$1", [row.id]);
  await sell(-100);
  await runGainer(row2);
  assert.equal(Number((await one<any>("SELECT params FROM trading_bots WHERE id=$1", [b.id]))!.params.amount_usd), 100, "never below the starting amount");
});

test("auto adjuster: stop-loss / take-profit / dip follow the asset's 24h move", async () => {
  const u = await newUser();
  const { b } = await botWithAsset(u, { amount_usd: 50, take_profit_pct: 5, stop_loss_pct: 2, dip_pct: 3 }, 20);
  await setMode(u, "adjuster", true, "bot", b.id);
  const row = await one<any>("SELECT * FROM auto_modes WHERE user_id=$1 AND mode='adjuster'", [u]);
  await runAdjuster(row);
  const p = (await one<any>("SELECT params FROM trading_bots WHERE id=$1", [b.id]))!.params;
  assert.equal(Number(p.take_profit_pct), 12); assert.equal(Number(p.stop_loss_pct), 10); assert.equal(Number(p.dip_pct), 6);
});

test("map: an auto switch box attached to a bot switches on for just that bot; on its own it's for everything", async () => {
  const { getMap, saveMap, runMap } = await import("@/server/map");
  const u = await newUser();
  const { b } = await botWithAsset(u, { amount_usd: 10 });
  const m = await getMap(u);
  await saveMap(u, m.id, {
    nodes: [
      { id: "g", type: "auto", position: { x: 0, y: 0 }, data: { label: "Auto gainer", text: "gainer" } },
      { id: "b", type: "bot", position: { x: 300, y: 0 }, data: { refId: b.id, label: b.name } },
      { id: "s", type: "auto", position: { x: 0, y: 200 }, data: { label: "Auto scanner", text: "scanner" } },
    ],
    edges: [{ id: "e1", source: "g", target: "b" }],
  });
  const r1 = await runMap(u, m.id, { nodeId: "g", isOwner: false });
  assert.match(r1.lines.join("\n"), /Auto gainer: on for Bot/);
  const mm = await listModes(u);
  assert.ok(mm.scoped.some((s: any) => s.mode === "gainer" && s.scope === "bot" && s.scope_ref === b.id && s.active));
  assert.equal(mm.global.find((g) => g.mode === "gainer")!.active, false);
  const r2 = await runMap(u, m.id, { nodeId: "s", isOwner: false });
  assert.match(r2.lines.join("\n"), /Auto scanner: on for all/);
});
