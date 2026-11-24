import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { q } from "@/server/db";
import { parseDates, isMarketQuestion, factsAnswer, factsPacket, rangeStats, type AssetFacts, type Bar } from "@/server/ai/market-answers";
import { handlePrompt } from "@/server/ai/interpret";

const NOW = Math.floor(Date.UTC(2026, 10, 24) / 1000);
const DAY = 86_400;

test("dates in questions are understood", () => {
  const d = parseDates("what was nvda on March 5, 2021 and how did it do in 2020, and 3 years ago?", NOW);
  assert.deepEqual(d.map((x) => x.label), ["2021-03-05", "2020", "3 years ago"]);
  assert.equal(d[0].point, true);
  assert.equal(parseDates("btc since 2019", NOW)[0].label, "since 2019");
  assert.equal(parseDates("eth in june 2022", NOW)[0].label, "June 2022");
  assert.equal(parseDates("sol price yesterday", NOW)[0].label, "yesterday");
});

test("market questions are told apart from trade instructions", () => {
  for (const t of ["what's the price of bitcoin", "NVDA all time high?", "how did tesla do in 2020", "btc price", "compare sol vs eth", "should I buy SOL?", "when did apple ipo"]) assert.ok(isMarketQuestion(t), t);
  for (const t of ["buy $100 of SOL", "sell 25% of nvda", "cancel all orders", "mimic the top roi trader this week"]) assert.ok(!isMarketQuestion(t), t);
});

function bars(from: number, days: number, start: number, step: number): Bar[] {
  return Array.from({ length: days }, (_, i) => { const c = start + step * i; return { t: from + i * DAY, o: c, h: c * 1.01, l: c * 0.99, c }; });
}

test("answers come straight from the price history", () => {
  const first = Math.floor(Date.UTC(2019, 0, 1) / 1000);
  const b = bars(first, Math.floor((Date.now() / 1000 - first) / DAY), 100, 0.5);
  const f: AssetFacts = { symbol: "TEST", name: "Test Corp", assetClass: "stock", venue: "XNAS", live: { price: 1200, change24hPct: 1.5, marketCap: null, volume24h: null, source: "unit", at: new Date().toISOString() },
    history: { source: "unit", bars: b }, errors: [] };
  const dates = parseDates("how did it do in 2020 and what was it on 2021-03-05?", NOW);
  const r2020 = rangeStats(b, Date.UTC(2020, 0, 1) / 1000, Date.UTC(2021, 0, 1) / 1000)!;
  assert.equal(r2020.open, 100 + 0.5 * 365);
  const a = factsAnswer([f], dates)!;
  assert.match(a, /Test Corp \(TEST\) is \$1,200/);
  assert.match(a, /2020: opened \$282\.5/);
  assert.match(a, /On 2021-03-05 it closed at/);
  assert.match(a, /Change: 7 days [+-]/);
  const p = factsPacket([f], dates);
  assert.match(p, /live_price=1200/);
  assert.match(p, /period 2020: open=282.5/);
  assert.match(p, /yearly 2019:/);
});

test("the prompt box answers a coin question with live + historical data", async () => {
  const me = await newUser();
  await q("UPDATE trading_permissions SET allow_ai_prompts=true WHERE user_id=$1", [me]);
  await q("UPDATE user_profiles SET ai_provider='merod' WHERE user_id=$1", [me]);
  const realFetch = globalThis.fetch;
  const start = Date.UTC(2025, 10, 24);
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/market_chart")) return json({ prices: Array.from({ length: 366 }, (_, i) => [start + i * DAY * 1000, 50_000 + i * 100]) });
    if (u.includes("/coins/")) return json({ name: "Bitcoin", market_cap_rank: 1, market_data: { current_price: { usd: 87_000 }, price_change_percentage_24h: 2.1, market_cap: { usd: 1.7e12 }, total_volume: { usd: 3e10 },
      ath: { usd: 126_000 }, ath_date: { usd: "2025-10-06T00:00:00Z" }, atl: { usd: 67.81 }, atl_date: { usd: "2013-07-06T00:00:00Z" }, last_updated: new Date().toISOString() } });
    if (u.includes("/search")) return json({ coins: [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 }] });
    return new Response("{}", { status: 404 });
  }) as any;
  try {
    const r = await handlePrompt(me, { text: "whats the price of bitcoin and its all time high?" } as any);
    assert.equal(r.message.plan?.type, "research", r.message.content);
    assert.match(r.message.content, /Bitcoin \(BTC\) is \$87,000 \(\+2\.10% 24h\), from CoinGecko/);
    assert.match(r.message.content, /All-time high \$126,000 on 2025-10-06/);
    assert.match(r.message.content, /Change: 7 days/);
  } finally { globalThis.fetch = realFetch; }
});

test("real-data helpers: simulated sources are rejected and real samples become candles", async () => {
  const { isRealSource } = await import("@/server/ai/market-answers");
  const { toCandles } = await import("@/server/market/real-data");
  assert.ok(!isRealSource("simulated") && !isRealSource(null) && !isRealSource("unknown"));
  assert.ok(isRealSource("coingecko") && isRealSource("alpaca_trading:iex"));
  const c = toCandles([[0, 10], [60_000, 12], [120_000, 9], [3_600_000, 11]], 3600);
  assert.deepEqual(c, [{ t: 0, o: 10, h: 12, l: 9, c: 9 }, { t: 3600, o: 11, h: 11, l: 11, c: 11 }]);
});
