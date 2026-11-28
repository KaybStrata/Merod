import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { goalFilter } from "@/server/auton/engine";

test("auton goal text → market filter", () => {
  const f = goalFilter("focus on safe large caps, maybe NVDA and TSLA stocks");
  assert.equal(f.safe, true); assert.equal(f.stocks, true); assert.deepEqual(f.syms, ["NVDA", "TSLA"]);
  assert.equal(goalFilter("aggressive solana meme coins").meme, true);
});

test("Auton: one cycle reads history, opens paper bots within budget, makes its e-wallet, map-only skill, map; stop turns it off", async () => {
  await freshPrices();
  const u = await newUser();
  await q("UPDATE trading_permissions SET allow_bots=true WHERE user_id=$1", [u]).catch(() => {});
  // Give two liquid assets a clear 24h move so Auton has candidates.
  const picks = await q<any>("SELECT id FROM assets WHERE last_price IS NOT NULL AND asset_class='crypto' AND NOT ('demo_data' = ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 2");
  for (const [i, p] of picks.entries()) await q("UPDATE assets SET change_24h=$2, market_cap=GREATEST(COALESCE(market_cap,0), 2e9), price_updated_at=now() WHERE id=$1", [p.id, 6 + i]);
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "auton budget $400 max 2 bots focus on crypto", auton: true } as any);
  const c = String(r.message.content);
  assert.match(c, /Auton is on \(paper money, budget \$400, up to 2 bots/, c);
  const bots = await q<any>("SELECT b.name, b.is_paper, b.status, b.params FROM auton_assets a JOIN trading_bots b ON b.id::text=a.ref_id WHERE a.user_id=$1 AND a.kind='bot'", [u]);
  assert.ok(bots.length >= 1 && bots.length <= 2, c);
  for (const b of bots) { assert.equal(b.is_paper, true); assert.match(b.name, /^Auton · /); assert.equal(Number(b.params.amount_usd), 200); }
  assert.ok(await one("SELECT 1 FROM e_wallets WHERE user_id=$1 AND name='Auton profits'", [u]), "its e-wallet");
  assert.equal(await one("SELECT 1 FROM skills WHERE user_id=$1", [u]), null, "Auton never makes skills or points on its own");
  const m = await one<any>("SELECT nodes FROM strategy_maps WHERE user_id=$1 AND name='Auton'", [u]);
  assert.ok(m.nodes.some((n: any) => n.type === "auton"), "Auton map with the Auton box");
  const ev = await one<any>("SELECT count(*)::int AS n FROM auton_events WHERE user_id=$1", [u]);
  assert.ok(ev.n >= 4, "thinking and actions are logged");
  // A second cycle doesn't exceed the bot limit or the budget.
  const { runAuton } = await import("@/server/auton/engine");
  await runAuton(u);
  assert.ok((await q("SELECT 1 FROM auton_assets WHERE user_id=$1 AND kind='bot'", [u])).length <= 2);
  const s: any = await handlePrompt(u, { text: "stop auton", provider: "merod" } as any);
  assert.match(s.message.content, /Auton is off/);
  assert.equal((await one<any>("SELECT active FROM auton_settings WHERE user_id=$1", [u]))!.active, false);
});

test("Auton: 'turn off budget limit, no limit on amount of bots, check every 5 seconds' sets no limits (and doesn't stop Auton); trade size by %", async () => {
  const u = await newUser();
  const { autonCommand, getAuton } = await import("@/server/auton/engine");
  const r = await autonCommand(u, "turn off budget limit, no limit on amount of bots, and have a check every 5 seconds", null);
  assert.match(r, /no budget limit, no bot limit, checks every 5 sec/, r);
  const s = await getAuton(u);
  assert.equal(s.active, true); assert.equal(s.max_capital_usd, 0); assert.equal(s.max_bots, 0); assert.equal(s.every_sec, 5);
  assert.equal(s.goals, "", "settings aren't saved as a goal");
  const r2 = await autonCommand(u, "increase the purchase amount of autons trading by 20%", null);
  assert.match(r2, /trade size is now \$120 per trade/, r2);
  assert.match(await autonCommand(u, "stop auton", null), /Auton is off/);
});

test("Auton's bots buy right away (momentum entry) so trades show up without waiting for a dip", async () => {
  await freshPrices();
  const u = await newUser();
  await q("UPDATE trading_permissions SET allow_bots=true WHERE user_id=$1", [u]).catch(() => {});
  await q("UPDATE risk_settings SET block_risky_tokens=false, min_liquidity_usd=0 WHERE user_id=$1", [u]);
  const p = (await one<any>("SELECT id FROM assets WHERE last_price IS NOT NULL AND asset_class='crypto' AND NOT ('demo_data' = ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  await q("UPDATE assets SET change_24h=8, market_cap=GREATEST(COALESCE(market_cap,0), 2e9), price_updated_at=now() WHERE id=$1", [p.id]);
  const { autonCommand } = await import("@/server/auton/engine");
  await autonCommand(u, "start auton budget $200 max 1 bots", null);
  const bot = (await one<any>("SELECT b.id, b.params FROM auton_assets a JOIN trading_bots b ON b.id::text=a.ref_id WHERE a.user_id=$1 AND a.kind='bot' LIMIT 1", [u]))!;
  assert.ok(bot, "a bot was opened");
  assert.equal(Number(bot.params.dip_pct), 0, "buys now");
  const { tickDueBots } = await import("@/server/bots/runner");
  await q("UPDATE trading_bots SET last_tick_at=NULL WHERE id=$1", [bot.id]);
  await tickDueBots("test-worker");
  const o = await one<any>("SELECT side, status FROM orders WHERE user_id=$1 AND source='bot' AND source_ref=$2 LIMIT 1", [u, bot.id]);
  assert.ok(o, "the bot placed an order on its first check");
  assert.equal(o.side, "buy");
});
