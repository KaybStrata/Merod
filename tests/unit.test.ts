import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, hashPassword, verifyPassword } from "@/server/crypto";
import { totpCode, verifyTotp, newTotpSecret } from "@/server/totp";
import { redact } from "@/server/audit";
import { parsePrompt, mergeClarification } from "@/server/ai/parser";
import { InstructionSchema } from "@/server/ai/schema";
import { getStrategy } from "@/server/bots/strategies";
import { OrderIntentSchema } from "@/server/engine/types";
import { closePool } from "./helpers";

test("AES-256-GCM vault round-trips and rejects tampering / wrong AAD", () => {
  const blob = encrypt("sk-live-123456789", "provider:x:production:KEY");
  assert.equal(decrypt(blob, "provider:x:production:KEY"), "sk-live-123456789");
  assert.ok(!blob.includes("sk-live"));
  assert.throws(() => decrypt(blob, "provider:y:production:KEY"));
  const buf = Buffer.from(blob, "base64"); buf[buf.length - 1] ^= 1;
  assert.throws(() => decrypt(buf.toString("base64"), "provider:x:production:KEY"));
});

test("scrypt password hashing", () => {
  const h = hashPassword("a-long-password");
  assert.ok(verifyPassword("a-long-password", h));
  assert.ok(!verifyPassword("wrong-password", h));
});

test("RFC 6238 TOTP", () => {
  const s = newTotpSecret();
  assert.ok(verifyTotp(s, totpCode(s)));
  assert.ok(!verifyTotp(s, "000000") || totpCode(s) === "000000");
  // RFC test vector (SHA-1, T=59s → 94287082 → last 6 digits 287082)
  assert.equal(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000), "287082");
});

test("redaction strips credential-like fields from logs", () => {
  const r = redact({ apiKey: "x", nested: { secret: "y", ok: 1 }, list: [{ token: "z" }] }) as any;
  assert.equal(r.apiKey, "[redacted]"); assert.equal(r.nested.secret, "[redacted]"); assert.equal(r.nested.ok, 1); assert.equal(r.list[0].token, "[redacted]");
});

test("prompt parser covers the documented commands", () => {
  const cases: [string, string][] = [
    ["Buy $100 worth of Solana", "trade"], ["Sell 25% of my NVIDIA position", "trade"], ["Buy $200 worth of Bitcoin", "trade"],
    ["Notify me when Tesla drops below my target price", "price_alert"], ["Sell half of my position when it reaches a 20% gain", "conditional_trade"],
    ["Monitor newly launched Solana coins matching my selected liquidity requirements", "create_bot"], ["Buy $50 worth of Ethereum every Monday", "recurring_buy"],
    ["Create a bot that monitors my watchlist", "create_bot"], ["Cancel all my open orders", "cancel_all_orders"], ["Pause all my active trading bots", "pause_all_bots"],
    ["buy at 3% dip and sell at 5% increase, and then rinse and repeat", "swing_loop"], ["buy something", "clarify"],
  ];
  for (const [p, kind] of cases) {
    const r = parsePrompt(p);
    assert.equal(r.kind, kind, p);
    InstructionSchema.parse(r); // parser output always satisfies the AI schema
  }
  const sw = parsePrompt("buy at 3% dip and sell at 5% increase, and then rinse and repeat");
  assert.deepEqual([sw.swing?.dip_pct, sw.swing?.take_profit_pct, sw.swing?.repeat], [3, 5, true]);
  const merged = mergeClarification(sw, "$100");
  assert.equal(merged?.trades[0].amount, 100); assert.equal(merged?.trades[0].amount_type, "usd");
});

test("ambiguous prompts never guess", () => {
  for (const p of ["buy", "sell some", "do the thing"]) assert.equal(parsePrompt(p).kind, "clarify", p);
});

test("dip-rebound loop strategy: buy on dip, sell at target, repeat", () => {
  const s = getStrategy("dip_rebound_loop")!;
  const p = { amount_usd: 100, dip_pct: 3, take_profit_pct: 5, repeat: true };
  let st: any = {};
  let r = s.decide({ price: 100, ts: 1, positionQty: 0, source: "t" }, st, p); assert.equal(r.decision.action, "none"); st = r.state;
  r = s.decide({ price: 104, ts: 2, positionQty: 0, source: "t" }, st, p); assert.equal(r.decision.action, "none"); st = r.state; // new high 104
  r = s.decide({ price: 100.8, ts: 3, positionQty: 0, source: "t" }, st, p); assert.equal(r.decision.action, "buy"); // 3.08% below 104
  st = { ...r.state, phase: "holding", entry: 100.8, qty: 0.99 };
  r = s.decide({ price: 104, ts: 4, positionQty: 0.99, source: "t" }, st, p); assert.equal(r.decision.action, "none");
  r = s.decide({ price: 105.9, ts: 5, positionQty: 0.99, source: "t" }, st, p); assert.equal(r.decision.action, "sell");
});

test("order intent validation", () => {
  assert.throws(() => OrderIntentSchema.parse({ asset: { symbol: "SOL" }, side: "buy", notionalUsd: 10, quantity: 1 }));
  assert.throws(() => OrderIntentSchema.parse({ asset: { symbol: "SOL" }, side: "buy", percentOfPosition: 50 }));
  assert.throws(() => OrderIntentSchema.parse({ asset: { symbol: "SOL" }, side: "buy", orderType: "limit", notionalUsd: 10 }));
  assert.ok(OrderIntentSchema.parse({ asset: { symbol: "SOL" }, side: "sell", percentOfPosition: 25 }));
});

test.after(closePool);
