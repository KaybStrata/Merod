import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt, mergeClarification, setCatalog, normalize } from "@/server/ai/parser";
import { InstructionSchema } from "@/server/ai/schema";

setCatalog(["JPM", "MSFT", "AAPL", "NVDA", "SOL", "BTC", "ON", "ALL", "BAC"],
  [["JPMorgan Chase & Co.", "JPM"], ["Microsoft Corp.", "MSFT"], ["Apple Inc.", "AAPL"], ["NVIDIA Corp.", "NVDA"], ["Bank of America Corp.", "BAC"], ["Solana", "SOL"]]);

test("tickers work in any letter case and with stray symbols", () => {
  for (const p of ["buy $100 of jpm", "BUY $100 OF JPM", "Buy $100 Of Jpm", "buy $100 of jpm*"]) {
    const r = parsePrompt(p);
    assert.equal(r.kind, "trade", p);
    assert.equal(r.trades[0].symbol, "JPM", p);
    InstructionSchema.parse(r);
  }
  assert.equal(parsePrompt("sell 10 msft").trades[0].symbol, "MSFT");
});

test("typos in command words and names are understood", () => {
  const cases: [string, string, string | null][] = [
    ["buyy $50 of microsfot", "trade", "MSFT"],
    ["purchse $20 of nvidea", "trade", "NVDA"],
    ["by $100 of apple", "clarify", null], // "by" is a real word — too risky to guess
    ["sel 25% of my nvidia positon", "trade", "NVDA"],
    ["buy at 3% dipp and sell at 5% incrase rinse and repeat sol", "swing_loop", "SOL"],
    ["notfy me when bitcon drops below 90000", "price_alert", "BTC"],
    ["get me $100 of solana", "trade", "SOL"],
    ["dump half my jpmorgan", "trade", "JPM"],
    ["buy $1k of bank of america", "trade", "BAC"],
  ];
  for (const [p, kind, sym] of cases) {
    const r = parsePrompt(p);
    assert.equal(r.kind, kind, `${p} → ${r.kind}`);
    if (sym) assert.equal(r.trades[0]?.symbol, sym, p);
  }
  assert.equal(parsePrompt("buy $1k of bank of america").trades[0].amount, 1000);
});

test("'buy jpm and sell at 3% profit' asks how much and keeps the 3% take-profit", () => {
  const r = parsePrompt("buy jpm and sell at 3% profit");
  assert.equal(r.kind, "clarify");
  assert.equal(r.trades[0].symbol, "JPM");
  assert.equal(r.trades[0].take_profit_pct, 3);
  const m = mergeClarification(r, "$100")!;
  assert.equal(m.kind, "trade");
  assert.equal(m.trades[0].amount, 100);
  assert.equal(m.trades[0].take_profit_pct, 3);
  assert.equal(mergeClarification(r, "100")!.trades[0].amount_type, "usd");
});

test("a bare ticker asks what to do; English words are never mistaken for tickers", () => {
  const r = parsePrompt("msft*");
  assert.equal(r.kind, "clarify");
  assert.match(r.clarification_question!, /What would you like to do with MSFT/);
  assert.equal(parsePrompt("buy all of it").trades[0]?.symbol ?? null, null); // "all" / "it" are words here
  assert.equal(normalize("Buy 2K of Sol"), "buy 2000 of sol");
});

test("dollar profit targets on a dollar buy become a take-profit %", () => {
  const r = parsePrompt("buy 10 dollars of sui and sell at 50 cents profit");
  assert.equal(r.kind, "trade");
  assert.equal(r.trades[0].amount, 10);
  assert.equal(r.trades[0].take_profit_pct, 5);
  assert.equal(parsePrompt("buy $200 of sol and sell at $10 profit").trades[0].take_profit_pct, 5);
});
