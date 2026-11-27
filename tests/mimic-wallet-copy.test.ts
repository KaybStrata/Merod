import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";

test("mimic a public wallet: a coin Merod hasn't listed is added from DEX Screener and copied; whale-size copies are scaled to fit", async () => {
  const u = await newUser();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [u]);
  await q("UPDATE risk_settings SET block_risky_tokens=false, min_liquidity_usd=0, max_daily_spend_usd=0 WHERE user_id=$1", [u]);
  const wallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const mint = `Mint${randomUUID().replace(/-/g, "").slice(0, 36)}`.slice(0, 44);
  const acct = (await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  await q(`INSERT INTO copy_follows (follower_id, kind, wallet_network, wallet_address, label, account_id, sizing, percent, fixed_usd, max_trade_usd, max_daily_usd, copy_sells, include_external, include_paper, created_at)
           VALUES ($1,'wallet','solana',$2,'Solana test',$3,'percent',100,0,0,0,true,false,false, now() - interval '1 hour')`, [u, wallet, acct.id]);
  const prevKey = process.env.HELIUS_API_KEY; process.env.HELIUS_API_KEY = "test-key";
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const s = String(url);
    if (s.includes("api.helius.xyz")) return new Response(JSON.stringify([{
      signature: `sig${randomUUID()}`, timestamp: Math.floor(Date.now() / 1000) - 60,
      // The whale bought 50,000,000 tokens at ~$0.01 = $500,000, far more than the $100k paper account.
      tokenTransfers: [{ mint, tokenAmount: 50_000_000, toUserAccount: wallet, fromUserAccount: "pool" }, { mint: "So11111111111111111111111111111111111111112", tokenAmount: 3000, fromUserAccount: wallet, toUserAccount: "pool" }],
    }]), { status: 200 });
    if (s.includes("api.dexscreener.com/tokens/v1/solana/")) return new Response(JSON.stringify([{ baseToken: { address: mint, symbol: "NEWT", name: "New Token" }, priceUsd: "0.01", liquidity: { usd: 250000 }, volume: { h24: 1e6 }, priceChange: { h24: 12 }, dexId: "raydium", pairCreatedAt: Date.now() - 86_400_000 }]), { status: 200 });
    return new Response("{}", { status: 503 });
  }) as any;
  try {
    const { processCopyTrading } = await import("@/server/copy/service");
    await processCopyTrading();
    const asset = await one<any>("SELECT id, symbol, last_price FROM assets WHERE identifier=$1", [mint]);
    assert.ok(asset, "the unknown coin was added to the catalog");
    assert.equal(asset.symbol, "NEWT");
    const ev = await one<any>("SELECT e.* FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id WHERE f.follower_id=$1 ORDER BY e.id DESC LIMIT 1", [u]);
    assert.ok(ev, "an event was recorded");
    assert.equal(ev.status, "copied", `${ev.status}: ${ev.reason}`);
    assert.match(ev.reason ?? "", /Scaled down: the wallet traded \$500000/);
    assert.match(ev.reason ?? "", /capped at your \$1000 max order/, "and fits the account's max-order limit");
    assert.equal(Number(ev.copy_notional), 1000);
  } finally {
    globalThis.fetch = real;
    if (prevKey === undefined) delete process.env.HELIUS_API_KEY; else process.env.HELIUS_API_KEY = prevKey;
    await q("UPDATE users SET role='user' WHERE id=$1", [u]);
    // Don't leave the test coin behind (other tests pick "top Solana meme coins" from the catalog).
    await cleanupTestCoins();
  }
});

async function cleanupTestCoins() {
  // Retire the test coins (other tests and their orders may reference them): marked demo_data with no price, which every
  // catalog query ignores.
  await q(`UPDATE assets SET risk_flags = array_append(array_remove(risk_flags, 'demo_data'), 'demo_data'), last_price = NULL, categories = '{}'
            WHERE symbol='NEWT' AND name='New Token' AND identifier LIKE 'Mint%'`);
}
