import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { parseSignal, baseSymbol, createSignalKey, handleSignal } from "@/server/signals";

test("signal payloads: Freqtrade, TradingView, plain text and pair formats", () => {
  for (const [raw, want] of [["BTC/USDT", "BTC"], ["BTC/USDT:USDT", "BTC"], ["SOL-USD", "SOL"], ["ETHUSDT", "ETH"], ["BINANCE:BTCUSDT", "BTC"], ["$doge", "DOGE"], ["AAPL", "AAPL"]] as const)
    assert.equal(baseSymbol(raw), want, raw);
  assert.deepEqual(
    { ...parseSignal({ action: "buy", pair: "ETH/USDT", amount_usd: "25.5", id: 7 }) },
    { side: "buy", ignore: undefined, symbol: "ETH", address: undefined, chain: undefined, usd: 25.5, quantity: undefined, percent: undefined, id: "7" });
  assert.equal(parseSignal({ type: "entry_fill", pair: "ETH/USDT" }).side, null, "fill notifications don't place a second order");
  assert.equal(parseSignal({ action: "exit", ticker: "SOLUSDT" }).side, "sell");
  const t = parseSignal("sell SOL 50%");
  assert.equal(t.side, "sell"); assert.equal(t.symbol, "SOL"); assert.equal(t.percent, 50);
  const t2 = parseSignal("buy BTC $40");
  assert.equal(t2.side, "buy"); assert.equal(t2.symbol, "BTC"); assert.equal(t2.usd, 40);
});

test("signal bot: buys with its limits on paper, sells the position, ignores repeats, and respects the off switch", async () => {
  await freshPrices();
  const u = await newUser();
  await q("UPDATE trading_permissions SET allow_bots=true WHERE user_id=$1", [u]).catch(() => {});
  await q("UPDATE risk_settings SET block_risky_tokens=false, min_liquidity_usd=0, max_daily_spend_usd=0 WHERE user_id=$1", [u]);
  const { key, row } = await createSignalKey(u, { name: "Freqtrade", perTradeUsd: 40, maxOrderUsd: 60 });
  assert.match(key, /^msk_/);
  const stored = await one<any>("SELECT key_hash FROM signal_keys WHERE id=$1", [row.id]);
  assert.notEqual(stored.key_hash, key, "only a hash of the key is stored");

  await assert.rejects(() => handleSignal("msk_wrong", { action: "buy", pair: "BTC/USDT" }), /Unknown signal key/);

  const buy = await handleSignal(key, { action: "buy", pair: "BTC/USDT", amount_usd: 500, id: "t1" });
  assert.ok(["filled", "submitted"].includes(buy.status), `${buy.status}: ${buy.reason}`);
  assert.equal(buy.symbol, "BTC");
  assert.equal(Number(buy.notional), 60, "capped at the bot's max order");
  const order = await one<any>("SELECT source, source_ref, is_paper FROM orders WHERE id=$1", [buy.orderId]);
  assert.equal(order.source, "signal"); assert.equal(order.source_ref, row.id); assert.equal(order.is_paper, true);

  const again = await handleSignal(key, { action: "buy", pair: "BTC/USDT", amount_usd: 500, id: "t1" });
  assert.equal(again.status, "duplicate", "a retried signal never places a second order");

  const sell = await handleSignal(key, "sell BTC");
  assert.ok(["filled", "submitted"].includes(sell.status), `${sell.status}: ${sell.reason}`);
  const none = await handleSignal(key, { action: "sell", symbol: "BTC", id: "t2" });
  assert.equal(none.status, "ignored"); assert.match(none.reason ?? "", /Nothing to sell/);

  const unknown = await handleSignal(key, { action: "buy", symbol: "ZZZNOTACOIN" });
  assert.equal(unknown.status, "failed"); assert.match(unknown.reason ?? "", /couldn't find/);

  await q("UPDATE signal_keys SET enabled=false WHERE id=$1", [row.id]);
  const off = await handleSignal(key, { action: "buy", pair: "ETH/USDT" });
  assert.equal(off.status, "ignored"); assert.match(off.reason ?? "", /turned off/);

  const ev = await one<any>("SELECT count(*)::int AS n FROM signal_events WHERE key_id=$1", [row.id]);
  assert.ok(ev.n >= 5, "every signal is recorded for the Recent signals table");
});
