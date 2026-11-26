import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newUser, freshPrices, assetId } from "./helpers";
import { one, q } from "@/server/db";
import { InterfaceValues } from "@/server/talk/prefs";
import { Widget, sanitizeWidgets, widgetsFor } from "@/server/talk/widgets";
import { buildDigest } from "@/server/talk/digest";
import { handlePrompt, approvePlan } from "@/server/ai/interpret";

test("settings 'interface' section accepts valid values and rejects bad ui_mode_default / unknown widget names", () => {
  const good = { ui_mode_default: "last", talk_prefs: { showSwitch: true, digest: false, voice: true, widgets: ["chart", "plan"] } };
  assert.equal(InterfaceValues.safeParse(good).success, true);
  for (const m of ["classic", "talk", "last"]) assert.equal(InterfaceValues.safeParse({ ...good, ui_mode_default: m }).success, true);
  assert.equal(InterfaceValues.safeParse({ ...good, ui_mode_default: "voice" }).success, false);
  assert.equal(InterfaceValues.safeParse({ ...good, talk_prefs: { ...good.talk_prefs, widgets: ["chart", "html"] } }).success, false);
  assert.equal(InterfaceValues.safeParse({ ...good, talk_prefs: { ...good.talk_prefs, autonomy: 6 } }).success, false, "no extra keys (e.g. limits) can ride along");
  // The settings route uses exactly this schema for the section.
  assert.match(readFileSync("src/app/api/settings/route.ts", "utf8"), /section: z\.literal\("interface"\), values: InterfaceValues/);
});

test("digest requires auth, returns only the caller's events, and advances talk_last_seen_at", async () => {
  const route = readFileSync("src/app/api/talk/digest/route.ts", "utf8");
  assert.match(route, /requireUser\(\)/); assert.match(route, /buildDigest\(u\.id/);
  const me = await newUser(), other = await newUser();
  const sol = await assetId("SOL");
  const acct = async (u: string) => (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!.id;
  const fill = async (u: string, qty: number) => q(
    `INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price)
     VALUES ($1,$2,$3,'paper',gen_random_uuid()::text,'manual','buy','market',$4,true,'filled',$4,100)`, [u, await acct(u), sol, qty]);
  await fill(me, 3); await fill(other, 7);
  const d1 = await buildDigest(me);
  assert.ok(d1.events.some((e) => /Bought 3 SOL/.test(e.text)), JSON.stringify(d1.events));
  assert.ok(!d1.events.some((e) => /Bought 7 SOL/.test(e.text)), "never another user's events");
  assert.ok(typeof d1.portfolio.total === "number");
  const seen = await one<any>("SELECT talk_last_seen_at FROM user_profiles WHERE user_id=$1", [me]);
  assert.ok(seen.talk_last_seen_at, "talk_last_seen_at set");
  const d2 = await buildDigest(me);
  assert.ok(!d2.events.some((e) => /Bought 3 SOL/.test(e.text)), "already-seen events are not repeated");
});

test("riskUsedPct is null when the daily spend limit is 0 (no limit)", async () => {
  const me = await newUser();
  await q("UPDATE risk_settings SET max_daily_spend_usd=0 WHERE user_id=$1", [me]);
  assert.equal((await buildDigest(me)).portfolio.riskUsedPct, null);
  await q("UPDATE risk_settings SET max_daily_spend_usd=1000 WHERE user_id=$1", [me]);
  assert.equal(typeof (await buildDigest(me)).portfolio.riskUsedPct, "number");
});

test("Widget schema rejects unknown kinds and over-long arrays; widgetsFor never emits markup", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(Widget.safeParse({ kind: "html", html: "<b>x</b>" }).success, false);
  assert.equal(Widget.safeParse({ kind: "chart", assetId: id, symbol: "SOL", range: "1M", lines: Array.from({ length: 5 }, (_, i) => ({ label: `l${i}`, price: i + 1 })) }).success, false);
  assert.equal(Widget.safeParse({ kind: "clarify", question: "q", options: Array.from({ length: 5 }, () => ({ label: "a", reply: "b" })) }).success, false);
  assert.equal(Widget.safeParse({ kind: "agents", items: Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, name: "a", state: "running", note: "n" })) }).success, false);
  assert.equal(Widget.safeParse({ kind: "portfolio", total: 1, dayPnl: 0, cash: 1, riskUsedPct: null, html: "<script>" }).success, false, "no extra fields");
  assert.deepEqual(sanitizeWidgets([{ kind: "html", html: "<script>alert(1)</script>" }, { kind: "plan", planMessageId: id }]), [{ kind: "plan", planMessageId: id }]);
  const ws = widgetsFor("research", { chart: { assetId: id, symbol: "<img src=x onerror=alert(1)>", lines: [] }, clarify: { question: "<script>x</script>", options: [{ label: "Yes", reply: "do it" }] } });
  assert.equal(ws.length, 2);
  for (const w of ws) {
    assert.ok(!("html" in w) && !("markup" in w));
    for (const v of Object.values(w)) if (typeof v === "string") assert.ok(v.length <= 300);
  }
  // Strings stay plain data (the client renders them as text, never HTML); the builder adds no markup of its own.
  assert.equal(JSON.stringify(widgetsFor("info", {})), "[]");
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(readFileSync("src/components/talk/widgets/Widgets.tsx", "utf8") + readFileSync("src/components/talk/TalkThread.tsx", "utf8")));
});

test("a plan approved from a Talk conversation goes through the engine and writes an audit row", async () => {
  const me = await newUser(); await freshPrices();
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  await q("UPDATE trading_permissions SET allow_ai_prompts=true, mode='manual' WHERE user_id=$1", [me]);
  const r: any = await handlePrompt(me, { text: "Buy $100 worth of Solana" });
  assert.equal(r.message.status, "needs_approval", r.message.content);
  assert.equal(r.message.plan.type, "order", "the plan itself is unchanged");
  assert.ok(r.message.plan.widgets.some((w: any) => w.kind === "plan" && w.planMessageId === r.message.id), "plan widget points at this message");
  const res = await approvePlan(me, r.message.id);
  assert.equal(res.status, "filled");
  const audit = await one<any>("SELECT 1 FROM audit_logs WHERE user_id=$1 AND action LIKE 'order.%' AND target=$2", [me, res.orderId]);
  assert.ok(audit, "engine audit row for the order");
});

test("there is no code path from handlePrompt to the settings / mode writers", () => {
  const files = ["src/server/ai/interpret.ts", "src/server/ai/multi.ts", "src/server/ai/parser.ts", "src/server/talk/attach.ts", "src/server/talk/widgets.ts", "src/server/talk/summary.ts"];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/api\/settings|api\/talk\/mode/.test(src), `${f} must not import the settings or mode routes`);
    assert.ok(!/UPDATE\s+user_profiles\s+SET[^"`]*(ui_mode_default|ui_last_mode|talk_prefs|theme)/i.test(src), `${f} must not write interface settings`);
    assert.ok(!/UPDATE\s+(risk_settings|trading_permissions)/i.test(src), `${f} must not write limits or permissions`);
  }
});
