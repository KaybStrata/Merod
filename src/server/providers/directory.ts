import "@/lib/server-only-shim";
import { createHmac, createHash, randomBytes, randomUUID, sign as cryptoSign, createPrivateKey } from "node:crypto";
import type { ProviderContext, ProviderDefinition, TestResult } from "./types";
import { readJson } from "./http";

/**
 * Providers from the "Merod Self-Service Trading API Directory" (24 Nov 2026) that users can paste keys for
 * on the Broker Keys page. Each key check calls a documented, read-only, authenticated endpoint (balance /
 * profile). Providers whose auth needs an interactive OAuth login, a local gateway, or a single-use rotating
 * token return `unverified` instead of pretending to connect.
 *
 * Saving keys here does NOT enable order routing: orders only route through providers that have an
 * execution adapter (see execution.ts). The UI says which ones are "keys only".
 */

async function timed(fn: () => Promise<TestResult>): Promise<TestResult> {
  const t = Date.now();
  try { return { ...(await fn()), latencyMs: Date.now() - t }; }
  catch (e: any) { return { ok: false, message: e?.message ?? String(e), latencyMs: Date.now() - t }; }
}
async function need(ctx: ProviderContext, ...names: string[]) {
  const vals: Record<string, string> = {}; const missing: string[] = [];
  for (const n of names) { const v = await ctx.cred(n); if (v) vals[n] = v; else missing.push(n); }
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  return vals;
}
const unverified = (why: string): ProviderDefinition["test"] => async (ctx) => {
  return { ok: false, unverified: true, message: `Keys saved and encrypted. ${why}`, detail: { env: ctx.env } };
};
const hmacHex = (alg: string, key: string | Buffer, msg: string) => createHmac(alg, key).update(msg).digest("hex");

type Base = Omit<ProviderDefinition, "supportsWebhooks" | "supportsOAuth" | "settings" | "phase" | "commercialRequirements" | "troubleshooting" | "capabilities" | "networks"> &
  Partial<Pick<ProviderDefinition, "settings" | "supportsOAuth" | "capabilities" | "networks" | "troubleshooting" | "commercialRequirements" | "phase">>;
const def = (b: Base): ProviderDefinition => ({
  phase: 5, supportsWebhooks: false, supportsOAuth: false, settings: [], capabilities: ["balances"], networks: [], troubleshooting: [],
  commercialRequirements: "Personal-account use only. Serving other customers requires the provider's commercial/partner approval.",
  ...b,
});

export const DIRECTORY_PROVIDERS: ProviderDefinition[] = [
  /* ───────────── 02 · Stock brokers ───────────── */
  def({
    id: "schwab", name: "Charles Schwab", category: "stock_execution", userKeys: "personal_account", authMethod: "oauth", supportsOAuth: true,
    description: "US equities, ETFs and options via the Schwab Trader API.",
    docsUrl: "https://developer.schwab.com/", signupUrl: "https://developer.schwab.com/",
    credentials: [
      { name: "SCHWAB_APP_KEY", label: "App key", secret: true, required: true },
      { name: "SCHWAB_APP_SECRET", label: "App secret", secret: true, required: true },
      { name: "SCHWAB_REFRESH_TOKEN", label: "Refresh token (from the OAuth login)", secret: true, required: false },
    ],
    assetClasses: ["stock", "etf", "option"], environments: ["production"],
    test: unverified("Schwab signs in through an OAuth browser login, so Merod can't auto-check these keys yet."),
  }),
  def({
    id: "tastytrade", name: "tastytrade", category: "stock_execution", userKeys: "personal_account", authMethod: "oauth", supportsOAuth: true,
    description: "US equities, ETFs and options; account-based API.",
    docsUrl: "https://developer.tastytrade.com/", signupUrl: "https://developer.tastytrade.com/",
    credentials: [
      { name: "TASTYTRADE_CLIENT_SECRET", label: "OAuth client secret", secret: true, required: true },
      { name: "TASTYTRADE_REFRESH_TOKEN", label: "Refresh token", secret: true, required: true },
    ],
    assetClasses: ["stock", "etf", "option"], environments: ["sandbox", "production"],
    test: unverified("tastytrade uses OAuth tokens, so Merod can't auto-check these keys yet."),
  }),
  def({
    id: "public_com", name: "Public", category: "stock_execution", userKeys: "personal_account", authMethod: "bearer",
    description: "US stocks, ETFs and other assets. The individual API is for non-commercial personal use.",
    docsUrl: "https://public.com/api/docs", signupUrl: "https://public.com/settings/api",
    credentials: [{ name: "PUBLIC_SECRET_KEY", label: "Secret key", secret: true, required: true }],
    assetClasses: ["stock", "etf"], environments: ["production"],
    test: unverified("Public exchanges this secret for short-lived tokens, so Merod can't auto-check it yet."),
  }),
  def({
    id: "webull", name: "Webull OpenAPI", category: "stock_execution", userKeys: "personal_account", authMethod: "hmac_sdk",
    description: "US equities and other supported products. Apply for API access in your Webull account before creating keys.",
    docsUrl: "https://developer.webull.com/", signupUrl: "https://developer.webull.com/",
    credentials: [
      { name: "WEBULL_APP_KEY", label: "App key", secret: true, required: true },
      { name: "WEBULL_APP_SECRET", label: "App secret", secret: true, required: true },
    ],
    assetClasses: ["stock", "etf"], environments: ["production"],
    test: unverified("Webull requests are signed by its SDK, so Merod can't auto-check these keys yet."),
  }),
  def({
    id: "tradestation", name: "TradeStation", category: "stock_execution", userKeys: "personal_account", authMethod: "oauth", supportsOAuth: true,
    description: "US equities, ETFs and other products; SIM environment for testing.",
    docsUrl: "https://api.tradestation.com/docs/", signupUrl: "https://api.tradestation.com/docs/",
    credentials: [
      { name: "TRADESTATION_CLIENT_ID", label: "Client ID (API key)", secret: false, required: true },
      { name: "TRADESTATION_CLIENT_SECRET", label: "Client secret", secret: true, required: true },
      { name: "TRADESTATION_REFRESH_TOKEN", label: "Refresh token", secret: true, required: false },
    ],
    assetClasses: ["stock", "etf", "option", "future"], environments: ["sandbox", "production"],
    test: unverified("TradeStation uses an OAuth login, so Merod can't auto-check these keys yet."),
  }),
  def({
    id: "etrade", name: "E*TRADE", category: "stock_execution", userKeys: "personal_account", authMethod: "oauth", supportsOAuth: true,
    description: "US equities and options; sandbox for development.",
    docsUrl: "https://developer.etrade.com/home", signupUrl: "https://developer.etrade.com/getting-started",
    credentials: [
      { name: "ETRADE_CONSUMER_KEY", label: "Consumer key", secret: true, required: true },
      { name: "ETRADE_CONSUMER_SECRET", label: "Consumer secret", secret: true, required: true },
    ],
    assetClasses: ["stock", "etf", "option"], environments: ["sandbox", "production"],
    test: unverified("E*TRADE uses an OAuth 1.0a browser login, so Merod can't auto-check these keys yet."),
  }),

  /* ───────────── 03 · Global & connected brokers ───────────── */
  def({
    id: "saxo", name: "Saxo OpenAPI", category: "stock_execution", userKeys: "personal_account", authMethod: "bearer", supportsOAuth: true,
    description: "Global equities and multi-asset markets. Use a 24-hour developer token from the Saxo developer portal.",
    docsUrl: "https://www.developer.saxo/openapi/learn", signupUrl: "https://www.developer.saxo/",
    credentials: [{ name: "SAXO_ACCESS_TOKEN", label: "Access token (24h developer token or OAuth token)", secret: true, required: true }],
    assetClasses: ["stock", "etf", "forex", "future", "option"], networks: ["global"], environments: ["sandbox", "production"],
    test: (ctx) => timed(async () => {
      const { SAXO_ACCESS_TOKEN } = await need(ctx, "SAXO_ACCESS_TOKEN");
      const base = ctx.env === "sandbox" ? "https://gateway.saxobank.com/sim/openapi" : "https://gateway.saxobank.com/openapi";
      const j = await readJson(await ctx.fetch(`${base}/port/v1/users/me`, { headers: { Authorization: `Bearer ${SAXO_ACCESS_TOKEN}` } }), "saxo");
      if (!j?.UserKey) throw new Error("Unexpected response from Saxo");
      return { ok: true, message: `Signed in as ${j.Name ?? j.UserId ?? "Saxo user"}` };
    }),
  }),
  def({
    id: "moomoo", name: "Moomoo OpenAPI", category: "stock_execution", userKeys: "personal_account", authMethod: "session_gateway",
    description: "Eligible regional equity markets through the moomoo OpenD gateway running on your own computer.",
    docsUrl: "https://openapi.moomoo.com/moomoo-api-doc/en/intro/intro.html", signupUrl: "https://www.moomoo.com/download/OpenAPI",
    credentials: [{ name: "MOOMOO_OPEND_ADDRESS", label: "OpenD address (host:port)", secret: false, required: true, help: "Where your OpenD gateway listens, e.g. 127.0.0.1:11111." }],
    assetClasses: ["stock", "etf", "option"], networks: ["US", "HK", "SG", "JP", "AU"], environments: ["sandbox", "production"],
    test: unverified("Moomoo runs through the OpenD program on your computer, which Merod's servers can't reach to check."),
  }),
  def({
    id: "zerodha", name: "Zerodha Kite Connect", category: "stock_execution", userKeys: "personal_account", authMethod: "api_key",
    description: "Indian equities and other instruments. The access token expires daily; local algo rules apply.",
    docsUrl: "https://kite.trade/docs/connect/v3/", signupUrl: "https://developers.kite.trade/",
    credentials: [
      { name: "KITE_API_KEY", label: "API key", secret: false, required: true },
      { name: "KITE_ACCESS_TOKEN", label: "Access token (today's)", secret: true, required: true },
    ],
    assetClasses: ["stock", "etf", "future", "option"], networks: ["NSE", "BSE"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { KITE_API_KEY, KITE_ACCESS_TOKEN } = await need(ctx, "KITE_API_KEY", "KITE_ACCESS_TOKEN");
      const j = await readJson(await ctx.fetch("https://api.kite.trade/user/profile", { headers: { "X-Kite-Version": "3", Authorization: `token ${KITE_API_KEY}:${KITE_ACCESS_TOKEN}` } }), "zerodha");
      if (j?.status !== "success") throw new Error(j?.message ?? "Kite rejected the token");
      return { ok: true, message: `Signed in as ${j.data?.user_name ?? j.data?.user_id}` };
    }),
  }),
  def({
    id: "upstox", name: "Upstox", category: "stock_execution", userKeys: "personal_account", authMethod: "bearer", supportsOAuth: true,
    description: "Indian equities, with US stock access for eligible accounts.",
    docsUrl: "https://upstox.com/developer/api-documentation/open-api", signupUrl: "https://account.upstox.com/developer/apps",
    credentials: [{ name: "UPSTOX_ACCESS_TOKEN", label: "Access token", secret: true, required: true }],
    assetClasses: ["stock", "etf", "future", "option"], networks: ["NSE", "BSE"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { UPSTOX_ACCESS_TOKEN } = await need(ctx, "UPSTOX_ACCESS_TOKEN");
      const j = await readJson(await ctx.fetch("https://api.upstox.com/v2/user/profile", { headers: { Authorization: `Bearer ${UPSTOX_ACCESS_TOKEN}`, Accept: "application/json" } }), "upstox");
      if (j?.status !== "success") throw new Error("Upstox rejected the token");
      return { ok: true, message: `Signed in as ${j.data?.user_name ?? j.data?.user_id}` };
    }),
  }),
  def({
    id: "dhan", name: "DhanHQ", category: "stock_execution", userKeys: "personal_account", authMethod: "api_key",
    description: "Indian equities and other instruments via DhanHQ v2.",
    docsUrl: "https://dhanhq.co/docs/v2/", signupUrl: "https://web.dhan.co/",
    credentials: [
      { name: "DHAN_CLIENT_ID", label: "Client ID", secret: false, required: true },
      { name: "DHAN_ACCESS_TOKEN", label: "Access token", secret: true, required: true },
    ],
    assetClasses: ["stock", "etf", "future", "option"], networks: ["NSE", "BSE"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { DHAN_CLIENT_ID, DHAN_ACCESS_TOKEN } = await need(ctx, "DHAN_CLIENT_ID", "DHAN_ACCESS_TOKEN");
      const j = await readJson(await ctx.fetch("https://api.dhan.co/v2/fundlimit", { headers: { "access-token": DHAN_ACCESS_TOKEN, "client-id": DHAN_CLIENT_ID, Accept: "application/json" } }), "dhan");
      if (!j || j.errorType || j.status === "failure") throw new Error(j?.errorMessage ?? "Dhan rejected the token");
      return { ok: true, message: "Dhan account reachable (fund limits read)" };
    }),
  }),
  def({
    id: "questrade", name: "Questrade", category: "stock_execution", userKeys: "personal_account", authMethod: "oauth", supportsOAuth: true,
    description: "Canadian and US equities. The personal API is read-only data; order placement is partner-only.",
    docsUrl: "https://www.questrade.com/api/documentation/getting-started", signupUrl: "https://apphub.questrade.com/",
    credentials: [{ name: "QUESTRADE_REFRESH_TOKEN", label: "Refresh token", secret: true, required: true }],
    assetClasses: ["stock", "etf", "option"], networks: ["TSX", "XNYS", "XNAS"], capabilities: ["balances", "positions"], environments: ["production"],
    test: unverified("A Questrade refresh token works only once, so checking it would use it up. Merod keeps it for when it's needed."),
  }),

  /* ───────────── 04 · Crypto exchanges (your own account) ───────────── */
  def({
    id: "coinbase_advanced", name: "Coinbase Advanced Trade", category: "crypto_exchange", userKeys: "personal_account", authMethod: "api_key",
    description: "Listed spot cryptocurrencies on your Coinbase account. Create a CDP API key with View + Trade only (no transfers).",
    docsUrl: "https://docs.cdp.coinbase.com/advanced-trade/docs/welcome", signupUrl: "https://portal.cdp.coinbase.com/access/api",
    credentials: [
      { name: "COINBASE_API_KEY_NAME", label: "API key name (organizations/…/apiKeys/…)", secret: false, required: true },
      { name: "COINBASE_API_PRIVATE_KEY", label: "Private key (the full EC private key in PEM format, as Coinbase shows it)", secret: true, required: true },
    ],
    assetClasses: ["crypto"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { COINBASE_API_KEY_NAME: kid, COINBASE_API_PRIVATE_KEY: pem } = await need(ctx, "COINBASE_API_KEY_NAME", "COINBASE_API_PRIVATE_KEY");
      if (!pem.includes("PRIVATE KEY")) throw new Error("Paste the ECDSA private key in PEM format (Ed25519 keys aren't supported here yet)");
      const b64u = (o: object | Buffer) => Buffer.from(o instanceof Buffer ? o : JSON.stringify(o)).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const head = b64u({ alg: "ES256", kid, nonce: randomBytes(16).toString("hex"), typ: "JWT" });
      const body = b64u({ sub: kid, iss: "cdp", nbf: now, exp: now + 120, uri: "GET api.coinbase.com/api/v3/brokerage/accounts" });
      const sig = cryptoSign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(pem.replace(/\\n/g, "\n")), dsaEncoding: "ieee-p1363" });
      const jwt = `${head}.${body}.${b64u(sig)}`;
      const j = await readJson(await ctx.fetch("https://api.coinbase.com/api/v3/brokerage/accounts", { headers: { Authorization: `Bearer ${jwt}` } }), "coinbase_advanced");
      if (!Array.isArray(j?.accounts)) throw new Error("Unexpected response from Coinbase");
      return { ok: true, message: `${j.accounts.length} Coinbase wallets visible` };
    }),
  }),
  def({
    id: "kraken", name: "Kraken Spot API", category: "crypto_exchange", userKeys: "personal_account", authMethod: "api_key",
    description: "Listed spot cryptocurrencies on your Kraken account. Give the key Query Funds + trade permissions, never Withdraw.",
    docsUrl: "https://docs.kraken.com/api/", signupUrl: "https://pro.kraken.com/app/settings/api",
    credentials: [
      { name: "KRAKEN_API_KEY", label: "API key", secret: true, required: true },
      { name: "KRAKEN_API_SECRET", label: "Private key", secret: true, required: true },
    ],
    assetClasses: ["crypto"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { KRAKEN_API_KEY, KRAKEN_API_SECRET } = await need(ctx, "KRAKEN_API_KEY", "KRAKEN_API_SECRET");
      const path = "/0/private/Balance", nonce = Date.now().toString() + "000", post = `nonce=${nonce}`;
      const sig = createHmac("sha512", Buffer.from(KRAKEN_API_SECRET, "base64"))
        .update(Buffer.concat([Buffer.from(path), createHash("sha256").update(nonce + post).digest()])).digest("base64");
      const j = await readJson(await ctx.fetch(`https://api.kraken.com${path}`, { method: "POST", body: post, headers: { "API-Key": KRAKEN_API_KEY, "API-Sign": sig, "Content-Type": "application/x-www-form-urlencoded" } }), "kraken");
      if (j?.error?.length) throw new Error(`Kraken: ${j.error.join(", ")}`);
      return { ok: true, message: `${Object.keys(j?.result ?? {}).length} Kraken balances visible` };
    }),
  }),
  def({
    id: "gemini", name: "Gemini", category: "crypto_exchange", userKeys: "personal_account", authMethod: "api_key",
    description: "Listed crypto spot pairs on your Gemini account (confirm your region is supported). Use a Trading key, not Fund Management.",
    docsUrl: "https://docs.gemini.com/", signupUrl: "https://exchange.gemini.com/settings/api",
    credentials: [
      { name: "GEMINI_API_KEY", label: "API key", secret: true, required: true },
      { name: "GEMINI_API_SECRET", label: "API secret", secret: true, required: true },
    ],
    assetClasses: ["crypto"], environments: ["sandbox", "production"],
    test: (ctx) => timed(async () => {
      const { GEMINI_API_KEY, GEMINI_API_SECRET } = await need(ctx, "GEMINI_API_KEY", "GEMINI_API_SECRET");
      const host = ctx.env === "sandbox" ? "https://api.sandbox.gemini.com" : "https://api.gemini.com";
      const payload = Buffer.from(JSON.stringify({ request: "/v1/balances", nonce: Date.now() })).toString("base64");
      const j = await readJson(await ctx.fetch(`${host}/v1/balances`, { method: "POST", headers: {
        "Content-Type": "text/plain", "Cache-Control": "no-cache", "X-GEMINI-APIKEY": GEMINI_API_KEY, "X-GEMINI-PAYLOAD": payload,
        "X-GEMINI-SIGNATURE": hmacHex("sha384", GEMINI_API_SECRET, payload) } }), "gemini");
      if (!Array.isArray(j)) throw new Error(j?.message ?? "Unexpected response from Gemini");
      return { ok: true, message: `${j.length} Gemini balances visible` };
    }),
  }),
  def({
    id: "bitstamp", name: "Bitstamp", category: "crypto_exchange", userKeys: "personal_account", authMethod: "api_key",
    description: "Listed crypto spot pairs on your Bitstamp account.",
    docsUrl: "https://www.bitstamp.net/api/", signupUrl: "https://www.bitstamp.net/account/security/api/",
    credentials: [
      { name: "BITSTAMP_API_KEY", label: "API key", secret: true, required: true },
      { name: "BITSTAMP_API_SECRET", label: "API secret", secret: true, required: true },
    ],
    assetClasses: ["crypto"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { BITSTAMP_API_KEY, BITSTAMP_API_SECRET } = await need(ctx, "BITSTAMP_API_KEY", "BITSTAMP_API_SECRET");
      const host = "www.bitstamp.net", path = "/api/v2/account_balances/", nonce = randomUUID(), ts = Date.now().toString();
      const msg = `BITSTAMP ${BITSTAMP_API_KEY}POST${host}${path}${nonce}${ts}v2`;
      const j = await readJson(await ctx.fetch(`https://${host}${path}`, { method: "POST", headers: {
        "X-Auth": `BITSTAMP ${BITSTAMP_API_KEY}`, "X-Auth-Signature": hmacHex("sha256", BITSTAMP_API_SECRET, msg).toUpperCase(),
        "X-Auth-Nonce": nonce, "X-Auth-Timestamp": ts, "X-Auth-Version": "v2" } }), "bitstamp");
      if (!Array.isArray(j)) throw new Error(j?.reason ?? j?.code ?? "Unexpected response from Bitstamp");
      return { ok: true, message: `${j.length} Bitstamp balances visible` };
    }),
  }),
  def({
    id: "cryptocom", name: "Crypto.com Exchange", category: "crypto_exchange", userKeys: "personal_account", authMethod: "api_key",
    description: "Listed spot markets. Needs a Crypto.com Exchange account, not only the Crypto.com app.",
    docsUrl: "https://exchange-docs.crypto.com/exchange/v1/rest-ws/index.html", signupUrl: "https://crypto.com/exchange/user/settings/api-management",
    credentials: [
      { name: "CRYPTOCOM_API_KEY", label: "API key", secret: true, required: true },
      { name: "CRYPTOCOM_API_SECRET", label: "Secret key", secret: true, required: true },
    ],
    assetClasses: ["crypto"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { CRYPTOCOM_API_KEY, CRYPTOCOM_API_SECRET } = await need(ctx, "CRYPTOCOM_API_KEY", "CRYPTOCOM_API_SECRET");
      const id = Date.now(), nonce = Date.now(), method = "private/user-balance";
      const sig = hmacHex("sha256", CRYPTOCOM_API_SECRET, `${method}${id}${CRYPTOCOM_API_KEY}${nonce}`);
      const j = await readJson(await ctx.fetch(`https://api.crypto.com/exchange/v1/${method}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, method, api_key: CRYPTOCOM_API_KEY, params: {}, nonce, sig }) }), "cryptocom");
      if (j?.code !== 0) throw new Error(j?.message ?? `Crypto.com error ${j?.code}`);
      return { ok: true, message: "Crypto.com Exchange balances read" };
    }),
  }),
  def({
    id: "binance_us", name: "Binance.US", category: "crypto_exchange", userKeys: "personal_account", authMethod: "api_key",
    description: "Listed spot markets for US residents in eligible states. Enable spot trading only, never withdrawals.",
    docsUrl: "https://docs.binance.us/", signupUrl: "https://www.binance.us/settings/api-management",
    credentials: [
      { name: "BINANCEUS_API_KEY", label: "API key", secret: true, required: true },
      { name: "BINANCEUS_API_SECRET", label: "Secret key", secret: true, required: true },
    ],
    assetClasses: ["crypto"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { BINANCEUS_API_KEY, BINANCEUS_API_SECRET } = await need(ctx, "BINANCEUS_API_KEY", "BINANCEUS_API_SECRET");
      const qs = `timestamp=${Date.now()}&recvWindow=10000`;
      const j = await readJson(await ctx.fetch(`https://api.binance.us/api/v3/account?${qs}&signature=${hmacHex("sha256", BINANCEUS_API_SECRET, qs)}`, { headers: { "X-MBX-APIKEY": BINANCEUS_API_KEY } }), "binance_us");
      if (!Array.isArray(j?.balances)) throw new Error(j?.msg ?? "Unexpected response from Binance.US");
      return { ok: true, message: `Binance.US account reachable${j.canTrade === false ? " (trading disabled on this key)" : ""}` };
    }),
  }),
  def({
    id: "okx_us", name: "OKX US", category: "crypto_exchange", userKeys: "personal_account", authMethod: "api_key",
    description: "Eligible US spot markets through OKX's regional entity (v5 API).",
    docsUrl: "https://www.okx.com/docs-v5/en/", signupUrl: "https://www.okx.com/account/my-api",
    credentials: [
      { name: "OKX_API_KEY", label: "API key", secret: true, required: true },
      { name: "OKX_API_SECRET", label: "Secret key", secret: true, required: true },
      { name: "OKX_API_PASSPHRASE", label: "Passphrase", secret: true, required: true },
    ],
    settings: [{ key: "base_url", label: "API host", defaults: { production: "https://www.okx.com" }, help: "Use the API host your OKX regional account shows in its API settings." }],
    assetClasses: ["crypto"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE } = await need(ctx, "OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE");
      const base = (await ctx.setting("base_url")) ?? "https://www.okx.com";
      const path = "/api/v5/account/balance", ts = new Date().toISOString();
      const sign = createHmac("sha256", OKX_API_SECRET).update(`${ts}GET${path}`).digest("base64");
      const j = await readJson(await ctx.fetch(`${base}${path}`, { headers: { "OK-ACCESS-KEY": OKX_API_KEY, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": OKX_API_PASSPHRASE } }), "okx_us");
      if (j?.code !== "0") throw new Error(j?.msg || `OKX error ${j?.code}`);
      return { ok: true, message: "OKX account balance read" };
    }),
  }),

  /* ───────────── 05 · On-chain execution (swap APIs; trades are signed by your wallet) ───────────── */
  def({
    id: "oneinch", name: "1inch", category: "crypto_execution", userKeys: "service", authMethod: "bearer", phase: 3,
    description: "EVM and supported cross-chain swaps. Uses your own 1inch developer portal key.",
    docsUrl: "https://portal.1inch.dev/documentation", signupUrl: "https://portal.1inch.dev/",
    credentials: [{ name: "ONEINCH_API_KEY", label: "API key", secret: true, required: true }],
    assetClasses: ["crypto"], networks: ["ethereum", "base", "arbitrum", "polygon", "bsc", "avalanche", "optimism"], capabilities: ["quote", "swap"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { ONEINCH_API_KEY } = await need(ctx, "ONEINCH_API_KEY");
      const j = await readJson(await ctx.fetch("https://api.1inch.dev/swap/v6.0/1/tokens", { headers: { Authorization: `Bearer ${ONEINCH_API_KEY}` } }), "oneinch");
      if (!j?.tokens) throw new Error("Unexpected response from 1inch");
      return { ok: true, message: `${Object.keys(j.tokens).length} Ethereum tokens available` };
    }),
  }),
  def({
    id: "lifi", name: "LI.FI", category: "crypto_execution", userKeys: "service", authMethod: "api_key", phase: 3,
    description: "Cross-chain swaps and bridges. The key is optional and raises rate limits.",
    docsUrl: "https://docs.li.fi/", signupUrl: "https://portal.li.fi/",
    credentials: [{ name: "LIFI_API_KEY", label: "API key (optional)", secret: true, required: false }],
    assetClasses: ["crypto"], networks: ["*"], capabilities: ["quote", "swap", "bridge"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const key = await ctx.cred("LIFI_API_KEY");
      const j = await readJson(await ctx.fetch("https://li.quest/v1/chains", { headers: key ? { "x-lifi-api-key": key } : {} }), "lifi");
      if (!Array.isArray(j?.chains)) throw new Error("Unexpected response from LI.FI");
      return { ok: true, message: `${j.chains.length} chains supported` };
    }),
  }),
  def({
    id: "near_intents", name: "NEAR Intents (1Click)", category: "crypto_execution", userKeys: "service", authMethod: "bearer", phase: 3,
    description: "Native and cross-chain swaps via the 1Click API. A partner JWT unlocks authenticated access.",
    docsUrl: "https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api", signupUrl: "https://docs.near-intents.org/",
    credentials: [{ name: "NEAR_INTENTS_JWT", label: "Partner JWT", secret: true, required: true }],
    assetClasses: ["crypto"], networks: ["near", "*"], capabilities: ["quote", "swap"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { NEAR_INTENTS_JWT } = await need(ctx, "NEAR_INTENTS_JWT");
      const j = await readJson(await ctx.fetch("https://1click.chaindefuser.com/v0/tokens", { headers: { Authorization: `Bearer ${NEAR_INTENTS_JWT}` } }), "near_intents");
      if (!Array.isArray(j)) throw new Error("Unexpected response from 1Click");
      return { ok: true, message: `${j.length} tokens supported` };
    }),
  }),
  def({
    id: "orca", name: "Orca Whirlpools", category: "crypto_execution", userKeys: "service", authMethod: "none", phase: 3,
    description: "Solana liquidity pools via the public Whirlpools SDK. Optionally paste your own Solana RPC URL.",
    docsUrl: "https://dev.orca.so/", signupUrl: "https://dev.orca.so/",
    credentials: [{ name: "SOLANA_RPC_URL", label: "Solana RPC URL (optional)", secret: true, required: false, help: "e.g. your Helius or other RPC endpoint; leave blank to use Merod's." }],
    assetClasses: ["crypto"], networks: ["solana"], capabilities: ["quote", "swap"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const rpc = (await ctx.cred("SOLANA_RPC_URL")) ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
      const j = await readJson(await ctx.fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) }), "orca");
      if (j?.result !== "ok") throw new Error(j?.error?.message ?? "Solana RPC not healthy");
      return { ok: true, message: "Solana RPC healthy; Whirlpools reachable through it" };
    }),
  }),

  /* ───────────── 06 · Chain adapters ───────────── */
  def({
    id: "minswap", name: "Minswap", category: "crypto_execution", userKeys: "service", authMethod: "api_key", phase: 3,
    description: "Cardano tokens. The Minswap SDK reads the chain through Blockfrost.",
    docsUrl: "https://docs.minswap.org/", signupUrl: "https://blockfrost.io/",
    credentials: [{ name: "BLOCKFROST_PROJECT_ID", label: "Blockfrost project ID (mainnet)", secret: true, required: true }],
    assetClasses: ["crypto"], networks: ["cardano"], capabilities: ["quote", "swap"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { BLOCKFROST_PROJECT_ID } = await need(ctx, "BLOCKFROST_PROJECT_ID");
      const j = await readJson(await ctx.fetch("https://cardano-mainnet.blockfrost.io/api/v0/blocks/latest", { headers: { project_id: BLOCKFROST_PROJECT_ID } }), "minswap");
      if (!j?.hash) throw new Error(j?.message ?? "Unexpected response from Blockfrost");
      return { ok: true, message: `Cardano reachable (block ${j.height})` };
    }),
  }),
  def({
    id: "stonfi", name: "STON.fi", category: "crypto_execution", userKeys: "service", authMethod: "api_key", phase: 3,
    description: "TON ecosystem tokens. A TON Center key (optional) raises rate limits for reading the chain.",
    docsUrl: "https://docs.ston.fi/", signupUrl: "https://t.me/tonapibot",
    credentials: [{ name: "TONCENTER_API_KEY", label: "TON Center API key (optional)", secret: true, required: false }],
    assetClasses: ["crypto"], networks: ["ton"], capabilities: ["quote", "swap"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const key = await ctx.cred("TONCENTER_API_KEY");
      const j = await readJson(await ctx.fetch("https://toncenter.com/api/v2/getMasterchainInfo", { headers: key ? { "X-API-Key": key } : {} }), "stonfi");
      if (!j?.ok) throw new Error(j?.error ?? "TON Center rejected the request");
      return { ok: true, message: `TON reachable (seqno ${j.result?.last?.seqno})` };
    }),
  }),
  def({
    id: "sunswap", name: "SunSwap / SUN.io", category: "crypto_execution", userKeys: "service", authMethod: "api_key", phase: 3,
    description: "TRON ecosystem tokens. Uses a TronGrid key to read the chain.",
    docsUrl: "https://docs.sun.io/", signupUrl: "https://www.trongrid.io/",
    credentials: [{ name: "TRONGRID_API_KEY", label: "TronGrid API key", secret: true, required: true }],
    assetClasses: ["crypto"], networks: ["tron"], capabilities: ["quote", "swap"], environments: ["production"],
    test: (ctx) => timed(async () => {
      const { TRONGRID_API_KEY } = await need(ctx, "TRONGRID_API_KEY");
      const j = await readJson(await ctx.fetch("https://api.trongrid.io/wallet/getnowblock", { method: "POST", headers: { "TRON-PRO-API-KEY": TRONGRID_API_KEY, "Content-Type": "application/json" } }), "sunswap");
      if (!j?.blockID) throw new Error(j?.Error ?? "Unexpected response from TronGrid");
      return { ok: true, message: `TRON reachable (block ${j.block_header?.raw_data?.number})` };
    }),
  }),
];

/** Directory metadata for every provider in the PDF (incl. ones already in the main catalog), keyed by provider id. */
export const DIRECTORY_INFO: Record<string, { section: "services" | "stocks" | "global" | "exchanges" | "onchain" | "chains"; coverage: string; access: string }> = {
  anthropic: { section: "services", coverage: "Claude (Opus, Sonnet, Haiku): reads your prompts", access: "KEY" },
  openai: { section: "services", coverage: "ChatGPT models: reads your prompts", access: "KEY" },
  helius: { section: "services", coverage: "Solana blockchain connectivity", access: "KEY" },
  alchemy: { section: "services", coverage: "EVM blockchain connectivity", access: "KEY" },
  birdeye: { section: "services", coverage: "Token discovery and prices", access: "KEY" },
  alpaca_trading: { section: "stocks", coverage: "US stocks, ETFs; supported crypto", access: "PERSONAL / SANDBOX" },
  alpaca_broker: { section: "stocks", coverage: "Embedded brokerage; supported securities", access: "SANDBOX" },
  ibkr: { section: "stocks", coverage: "Broad global equities, ETFs", access: "PERSONAL" },
  tradier: { section: "stocks", coverage: "US equities, ETFs, options", access: "PERSONAL / SANDBOX" },
  schwab: { section: "stocks", coverage: "US equities, ETFs, options", access: "PERSONAL / REQUEST" },
  tastytrade: { section: "stocks", coverage: "US equities, ETFs, options", access: "PERSONAL" },
  public_com: { section: "stocks", coverage: "US stocks, ETFs, other assets", access: "PERSONAL" },
  webull: { section: "stocks", coverage: "US equities and other supported products", access: "REQUEST" },
  tradestation: { section: "stocks", coverage: "US equities, ETFs, other products", access: "REQUEST" },
  etrade: { section: "stocks", coverage: "US equities and options", access: "REQUEST / SANDBOX" },
  saxo: { section: "global", coverage: "Global equities and multi-asset markets", access: "SANDBOX / REQUEST" },
  moomoo: { section: "global", coverage: "Eligible regional equity markets", access: "PERSONAL" },
  zerodha: { section: "global", coverage: "Indian equities and other instruments", access: "PERSONAL / KEY" },
  upstox: { section: "global", coverage: "Indian equities; eligible US stock access", access: "PERSONAL" },
  dhan: { section: "global", coverage: "Indian equities and other instruments", access: "PERSONAL" },
  snaptrade: { section: "global", coverage: "Connected broker accounts; selected execution venues", access: "SANDBOX / REQUEST" },
  questrade: { section: "global", coverage: "Canadian and US equities (data-only personal API)", access: "REQUEST" },
  coinbase_advanced: { section: "exchanges", coverage: "Listed spot cryptocurrencies", access: "PERSONAL" },
  kraken: { section: "exchanges", coverage: "Listed spot cryptocurrencies", access: "PERSONAL" },
  gemini: { section: "exchanges", coverage: "Listed crypto spot pairs", access: "PERSONAL" },
  bitstamp: { section: "exchanges", coverage: "Listed crypto spot pairs", access: "PERSONAL" },
  cryptocom: { section: "exchanges", coverage: "Listed spot markets", access: "PERSONAL" },
  binance_us: { section: "exchanges", coverage: "Listed spot markets (US entity)", access: "PERSONAL" },
  okx_us: { section: "exchanges", coverage: "Eligible US spot markets", access: "PERSONAL" },
  jupiter: { section: "onchain", coverage: "Solana tokens and meme coins", access: "KEY" },
  pumpfun: { section: "onchain", coverage: "Solana bonding curves and graduated tokens", access: "PUBLIC SDK" },
  zerox: { section: "onchain", coverage: "EVM networks; other supported routes", access: "KEY" },
  swapkit: { section: "onchain", coverage: "Native BTC, DOGE, LTC, XRP and more", access: "KEY / REQUEST" },
  cetus: { section: "onchain", coverage: "Sui ecosystem tokens", access: "PUBLIC SDK" },
  panora: { section: "onchain", coverage: "Aptos ecosystem tokens", access: "PUBLIC / KEY" },
  oneinch: { section: "onchain", coverage: "EVM and supported cross-chain swaps", access: "KEY / REQUEST" },
  lifi: { section: "onchain", coverage: "Cross-chain swaps and bridges", access: "PUBLIC / KEY" },
  near_intents: { section: "onchain", coverage: "Native and cross-chain assets", access: "PUBLIC / KEY" },
  orca: { section: "onchain", coverage: "Solana liquidity pools", access: "PUBLIC SDK" },
  minswap: { section: "chains", coverage: "Cardano tokens", access: "PUBLIC SDK" },
  stonfi: { section: "chains", coverage: "TON ecosystem tokens", access: "PUBLIC SDK" },
  sunswap: { section: "chains", coverage: "TRON ecosystem tokens", access: "PUBLIC" },
};
