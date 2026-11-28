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
  const sk = await one<any>("SELECT active FROM skills WHERE user_id=$1 AND name='Auton rules'", [u]);
  assert.equal(sk?.active, false, "its skill only applies to its own bots");
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
