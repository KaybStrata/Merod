import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildWidgetUrl, signMoonpay } from "@/server/funding/onramp";
import { pickXStocks } from "@/server/funding/xstocks";

const ADDR = "4SYorod2TLfUS42rnodR77J5vHNQy9GNyGm3qSZxx2Kp";

test("MoonPay widget URL is prefilled with the user's own wallet and signed over the query string", () => {
  const url = buildWidgetUrl({ provider: "moonpay", env: "production", publishableKey: "pk_live_abc", secretKey: "sk_live_secret" }, { address: ADDR, currency: "SOL", amountUsd: 150 });
  const u = new URL(url);
  assert.equal(u.origin, "https://buy.moonpay.com");
  assert.equal(u.searchParams.get("walletAddress"), ADDR);
  assert.equal(u.searchParams.get("currencyCode"), "sol");
  assert.equal(u.searchParams.get("baseCurrencyAmount"), "150");
  const sig = u.searchParams.get("signature")!;
  u.searchParams.delete("signature");
  assert.equal(sig, createHmac("sha256", "sk_live_secret").update(u.search).digest("base64"));
  assert.equal(signMoonpay("https://buy.moonpay.com/?a=1", "k").includes("signature="), true);
});

test("MoonPay test keys use the sandbox widget; Transak uses the Solana network and hides the address form", () => {
  const m = new URL(buildWidgetUrl({ provider: "moonpay", env: "sandbox", publishableKey: "pk_test_x" }, { address: ADDR, currency: "usdc_sol" }));
  assert.equal(m.origin, "https://buy-sandbox.moonpay.com");
  assert.equal(m.searchParams.get("signature"), null, "no secret → unsigned");
  const t = new URL(buildWidgetUrl({ provider: "transak", env: "production", publishableKey: "11111111-2222-3333-4444-555555555555" }, { address: ADDR, currency: "usdc_sol", amountUsd: 20 }));
  assert.equal(t.origin, "https://global.transak.com");
  assert.equal(t.searchParams.get("network"), "solana");
  assert.equal(t.searchParams.get("cryptoCurrencyCode"), "USDC");
  assert.equal(t.searchParams.get("disableWalletAddressForm"), "true");
  assert.throws(() => buildWidgetUrl({ provider: "moonpay", env: "production", publishableKey: "pk" }, { address: "0xabc", currency: "sol" }), /Solana address/);
});

test("tokenized stocks: only verified '… xStock' tokens are kept", () => {
  const rows = pickXStocks([
    { id: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", symbol: "AAPLx", name: "Apple xStock", isVerified: true, usdPrice: 230.1, stats24h: { priceChange: 1.2 } },
    { id: "FakeMint1111111111111111111111111111111111", symbol: "AAPLx", name: "Apple xStock", isVerified: false },
    { id: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL", isVerified: true },
    { id: "bad", symbol: "TSLAx", name: "Tesla xStock", isVerified: true },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "AAPLx");
  assert.equal(rows[0].price, 230.1);
});
