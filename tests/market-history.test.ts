import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { factsAnswer, gatherFacts, parseCoinbaseCandles, parseStooqCsv } from "@/server/ai/market-answers";

const day = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000);

test("parsers: Coinbase candles and Stooq CSV", () => {
  const cb = parseCoinbaseCandles([[day("2016-01-03"), 425, 435, 430, 431, 1], [day("2016-01-02"), 430, 437, 433, 434.5, 1]]);
  assert.deepEqual(cb.map((b) => b.c), [434.5, 431]); assert.equal(cb[0].h, 437); assert.equal(cb[0].o, 433);
  const st = parseStooqCsv("Date,Open,High,Low,Close,Volume\n1990-01-02,0.31,0.33,0.30,0.32,100\n2010-06-01,9.0,9.5,8.9,9.25,200\n");
  assert.equal(st.length, 2); assert.equal(st[1].c, 9.25); assert.equal(st[0].t, day("1990-01-02"));
  assert.deepEqual(parseStooqCsv("No data"), []);
});

test("any point in history: old coin prices from Coinbase when CoinGecko's free tier stops at 365 days; stocks from Stooq with no key", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("api.exchange.coinbase.com/products/BTC-USD/candles")) {
      const start = Date.parse(new URL(u).searchParams.get("start")!) / 1000, end = Date.parse(new URL(u).searchParams.get("end")!) / 1000;
      if (end < day("2015-07-20")) return new Response("[]", { status: 200 });
      const rows: any[] = [];
      for (let t = Math.floor(end / 86400) * 86400; t > start && rows.length < 300; t -= 86400) if (t >= day("2015-07-20")) rows.push([t, 100, 120, 105, t === day("2016-01-02") ? 434.5 : 110, 1]);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (u.includes("stooq.com/q/d/l/?s=aapl.us")) return new Response("Date,Open,High,Low,Close,Volume\n2010-06-01,9.0,9.5,8.9,9.25,200\n2024-01-02,185,186,183,185.6,300\n", { status: 200 });
    return new Response(JSON.stringify({ error: "unavailable in test" }), { status: 503 }); // CoinGecko etc.
  }) as any;
  try {
    const { facts, dates } = await gatherFacts("what was BTC's price on January 2, 2016?");
    const btc = facts.find((f) => f.symbol === "BTC")!;
    assert.ok(btc.history, JSON.stringify(btc.errors));
    assert.match(btc.history!.source, /Coinbase/);
    assert.ok(btc.history!.bars[0].t <= day("2015-08-01"), "history reaches back to the coin's Coinbase listing");
    assert.match(factsAnswer(facts, dates)!, /On 2016-01-02 it closed at \$434\.5/);

    const s = await gatherFacts("how much was AAPL stock in June 2010?");
    const aapl = s.facts.find((f) => f.symbol === "AAPL")!;
    assert.equal(aapl.history?.source, "Stooq", JSON.stringify(aapl.errors));
    assert.match(factsAnswer(s.facts, s.dates)!, /June 2010: opened \$9, closed \$9\.25/);
  } finally { globalThis.fetch = real; }
});

test("unlimited assets per question: 30 tickers (coins + stocks, even ones not in the catalog) and 'top 25 coins'", async () => {
  const real = globalThis.fetch;
  const calls: string[] = [];
  const coins = Array.from({ length: 25 }, (_, i) => ({ id: `coin-${i}`, symbol: `c${String.fromCharCode(65 + i)}x`, name: `Coin ${i}`, current_price: 10 + i, price_change_percentage_24h: 1, market_cap: 1e9 - i, total_volume: 1e6, ath: 50, ath_date: "2021-11-10T00:00:00Z", atl: 1, atl_date: "2018-12-15T00:00:00Z", market_cap_rank: i + 1, last_updated: new Date().toISOString() }));
  globalThis.fetch = (async (url: any) => {
    const u = String(url); calls.push(u);
    if (u.includes("/coins/markets")) return new Response(JSON.stringify(u.includes("order=market_cap_desc") ? coins : coins.filter((c) => u.toLowerCase().includes(c.symbol.toLowerCase()) || u.includes(c.id))), { status: 200 });
    if (u.includes("stooq.com")) return new Response("Date,Open,High,Low,Close,Volume\n2020-03-02,10,11,9,10.5,1\n2024-01-02,20,21,19,20.5,1\n", { status: 200 });
    if (u.includes("api.exchange.coinbase.com")) return new Response("[]", { status: 200 });
    return new Response(JSON.stringify({ error: "n/a" }), { status: 503 });
  }) as any;
  try {
    const stocks = ["AAPL", "MSFT", "KO", "ZM", "PLTR", "SHOP", "UBER", "ABNB", "SNOW", "CRWD", "NET", "DDOG", "MDB", "TEAM", "ZS", "OKTA", "TWLO", "ROKU", "SQ", "PYPL"];
    const r = await gatherFacts(`compare ${stocks.join(", ")} in March 2020`);
    const got = new Set(r.facts.map((f) => f.symbol));
    for (const s of stocks) assert.ok(got.has(s), `${s} included`);
    assert.ok(r.facts.length >= 20);
    const zm = r.facts.find((f) => f.symbol === "ZM")!;
    assert.equal(zm.history?.source, "Stooq");
    const ans = factsAnswer(r.facts, r.dates)!;
    assert.match(ans, new RegExp(`^${r.facts.length} assets:`));
    assert.match(ans, /• ZM.*March 2020: \+5\.00%/);
    const { factsPacket } = await import("@/server/ai/market-answers");
    assert.ok(factsPacket(r.facts, r.dates).split("\n").length <= r.facts.length + 1, "compact packet: one line per asset");

    calls.length = 0;
    const t = await gatherFacts("give me stats on the top 25 coins");
    assert.ok(t.facts.length >= 25, `got ${t.facts.length}`);
    assert.ok(calls.filter((c) => c.includes("/coins/markets")).length <= 4, "one batch quote call, not one per coin");
    assert.ok(t.facts.filter((f) => f.live?.source === "CoinGecko").length >= 25);
  } finally { globalThis.fetch = real; }
});
