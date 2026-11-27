import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one } from "@/server/db";
import { adviceIntent, readAsset } from "@/server/ai/advice";

test("advice intents: advice, live updates and stop are recognised; trade instructions are not", () => {
  for (const t of ["any suggestions?", "give me advice on my bots", "should I buy SOL?", "what should I do with my portfolio", "is it a good time to buy BTC"]) assert.equal(adviceIntent(t), "advice", t);
  for (const t of ["give me live updates on BTC and NVDA", "keep me updated on ETH", "turn on advisor", "real-time updates please"]) assert.equal(adviceIntent(t), "live", t);
  for (const t of ["stop live updates", "turn off the advisor"]) assert.equal(adviceIntent(t), "stop", t);
  for (const t of ["buy $50 of SOL", "create a bot that buys SOL dips", "what is the price of BTC"]) assert.equal(adviceIntent(t), null, t);
});

test("readAsset: trend read from real history", () => {
  const now = Math.floor(Date.now() / 1000);
  const bars = Array.from({ length: 120 }, (_, i) => { const c = 100 + i; return { t: now - (120 - i) * 86_400, o: c, h: c + 1, l: c - 1, c }; });
  const r = readAsset({ symbol: "UPC", name: "Up coin", assetClass: "crypto", venue: null, live: { price: 220, change24hPct: 1, marketCap: null, volume24h: null, source: "test", at: "" }, history: { source: "test", bars }, errors: [] });
  assert.match(r, /Uptrend/); assert.match(r, /30d \+/);
});

test("prompt box: 'give me live updates' turns the Advisor on; 'stop live updates' turns it off; advice answers", async () => {
  await freshPrices();
  const u = await newUser();
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r1: any = await handlePrompt(u, { text: "give me live updates", provider: "merod" } as any);
  assert.match(r1.message.content, /Live updates are on/, r1.message.content);
  assert.equal((await one<any>("SELECT active FROM advisor_settings WHERE user_id=$1", [u]))!.active, true);
  const r2: any = await handlePrompt(u, { text: "any suggestions for my bots?", provider: "merod" } as any);
  assert.match(r2.message.content, /No filled trades|Nothing needs changing|What I'd do/, r2.message.content);
  const r3: any = await handlePrompt(u, { text: "stop live updates", provider: "merod" } as any);
  assert.match(r3.message.content, /Live updates are off/);
  assert.equal((await one<any>("SELECT active FROM advisor_settings WHERE user_id=$1", [u]))!.active, false);
});
