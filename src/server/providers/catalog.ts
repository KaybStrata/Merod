import "@/lib/server-only-shim";
import type { ProviderContext, ProviderDefinition, TestResult } from "./types";
import { readJson } from "./http";

/**
 * Merod provider catalog. Each entry documents official links, exact environment variable names,
 * SDK requirements and production prerequisites, and implements a REAL connectivity probe.
 * A probe only returns ok:true when the provider answered with the expected payload.
 */

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

async function timed(fn: () => Promise<TestResult>): Promise<TestResult> {
  const t = Date.now();
  try {
    const r = await fn();
    return { ...r, latencyMs: Date.now() - t };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e), latencyMs: Date.now() - t };
  }
}
const need = async (ctx: ProviderContext, ...names: string[]) => {
  const missing: string[] = [];
  const vals: Record<string, string> = {};
  for (const n of names) { const v = await ctx.cred(n); if (!v) missing.push(n); else vals[n] = v; }
  if (missing.length) throw new Error(`Missing credentials: ${missing.join(", ")}`);
  return vals;
};

async function solanaRpc(ctx: ProviderContext): Promise<string | undefined> {
  const secretUrl = await ctx.cred("SOLANA_RPC_URL");
  if (secretUrl) return secretUrl;
  const explicit = await ctx.setting("rpc_url");
  if (explicit) return explicit;
  const helius = process.env.HELIUS_API_KEY;
  if (helius) return `https://${ctx.env === "sandbox" ? "devnet" : "mainnet"}.helius-rpc.com/?api-key=${helius}`;
  return process.env.SOLANA_RPC_URL;
}

export const PROVIDERS: ProviderDefinition[] = [
  // ───────────── Phase 2: market data & blockchain infra ─────────────
  {
    id: "helius", name: "Helius", category: "blockchain_infra", phase: 2, userKeys: "service",
    description: "Solana RPC, real-time blockchain activity, token launch & wallet monitoring, webhooks.",
    docsUrl: "https://www.helius.dev/docs", signupUrl: "https://dashboard.helius.dev/",
    authMethod: "api_key", supportsWebhooks: true, supportsOAuth: false,
    credentials: [{ name: "HELIUS_API_KEY", label: "API key", secret: true, required: true }],
    settings: [{ key: "webhook_url", label: "Webhook receiver URL", defaults: {}, help: "Public URL of /api/webhooks/helius" }],
    assetClasses: ["crypto"], networks: ["solana"], capabilities: ["rpc", "events", "launches", "wallet_monitoring"],
    environments: ["sandbox", "production"],
    commercialRequirements: "Self-serve plan sufficient for development; choose a plan sized for production RPC/webhook volume.",
    troubleshooting: ["401: key invalid or rotated", "429: plan rate limit exceeded — upgrade or reduce polling", "Sandbox uses devnet RPC"],
    test: (ctx) => timed(async () => {
      const { HELIUS_API_KEY } = await need(ctx, "HELIUS_API_KEY");
      const host = ctx.env === "sandbox" ? "devnet" : "mainnet";
      const res = await ctx.fetch(`https://${host}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      const j = await readJson(res, "helius");
      if (j?.result !== "ok") throw new Error(`Unexpected RPC response: ${JSON.stringify(j).slice(0, 120)}`);
      return { ok: true, message: `Solana ${host} RPC healthy` };
    }),
  },
  {
    id: "dexscreener", name: "DEX Screener", category: "market_data", phase: 2,
    description: "Trending meme coins, new pairs, liquidity, volume and price changes across DEXs. Public API.",
    docsUrl: "https://docs.dexscreener.com/api/reference", signupUrl: "https://docs.dexscreener.com/",
    authMethod: "none", supportsWebhooks: false, supportsOAuth: false, credentials: [], settings: [],
    // DEX Screener's documented API is public and keyless. Partner/enterprise access can be added as a Custom API.
    assetClasses: ["crypto"], networks: ["solana", "ethereum", "base", "bsc", "arbitrum", "polygon", "avalanche", "sui", "aptos"],
    capabilities: ["discovery", "market_data", "trending", "liquidity"], environments: ["production"],
    commercialRequirements: "Public endpoints are rate-limited (documented per-endpoint limits). Review DEX Screener API terms before redistributing data commercially.",
    troubleshooting: ["429: respect per-minute limits (60–300 rpm depending on endpoint)"],
    test: (ctx) => timed(async () => {
      const j = await readJson(await ctx.fetch("https://api.dexscreener.com/latest/dex/search?q=SOL%2FUSDC"), "dexscreener");
      if (!Array.isArray(j?.pairs)) throw new Error("Unexpected payload (no pairs array)");
      return { ok: true, message: `Search returned ${j.pairs.length} pairs` };
    }),
  },
  {
    id: "birdeye", name: "Birdeye", category: "market_data", phase: 2, userKeys: "service",
    description: "Token prices, analytics, trading activity, OHLCV history and on-chain discovery.",
    docsUrl: "https://docs.birdeye.so/", signupUrl: "https://bds.birdeye.so/",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "BIRDEYE_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    assetClasses: ["crypto"], networks: ["solana", "ethereum", "base", "bsc", "arbitrum", "polygon", "avalanche", "sui"],
    capabilities: ["market_data", "ohlcv", "discovery", "trending"], environments: ["production"],
    commercialRequirements: "Paid tier required for production volume and some endpoints; check redistribution terms.",
    troubleshooting: ["401: invalid key", "403: endpoint not in your plan", "Pass x-chain header for non-Solana chains"],
    test: (ctx) => timed(async () => {
      const { BIRDEYE_API_KEY } = await need(ctx, "BIRDEYE_API_KEY");
      const j = await readJson(await ctx.fetch(`https://public-api.birdeye.so/defi/price?address=${SOL_MINT}`, {
        headers: { "X-API-KEY": BIRDEYE_API_KEY, "x-chain": "solana", accept: "application/json" } }), "birdeye");
      if (!j?.success || typeof j?.data?.value !== "number") throw new Error("Unexpected payload");
      return { ok: true, message: `SOL price ${j.data.value.toFixed(2)} USD` };
    }),
  },
  {
    id: "alchemy", name: "Alchemy", category: "blockchain_infra", phase: 2, userKeys: "service",
    description: "Multichain RPC, wallet activity, transaction monitoring and token prices for EVM chains.",
    docsUrl: "https://www.alchemy.com/docs", signupUrl: "https://dashboard.alchemy.com/",
    authMethod: "api_key", supportsWebhooks: true, supportsOAuth: false,
    credentials: [{ name: "ALCHEMY_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    assetClasses: ["crypto"], networks: ["ethereum", "base", "polygon", "arbitrum", "optimism", "avalanche", "bsc", "solana"],
    capabilities: ["rpc", "events", "wallet_monitoring"], environments: ["sandbox", "production"],
    commercialRequirements: "Self-serve; size compute units for production.",
    troubleshooting: ["Enable each network for your Alchemy app in the dashboard", "Sandbox probes Sepolia"],
    test: (ctx) => timed(async () => {
      const { ALCHEMY_API_KEY } = await need(ctx, "ALCHEMY_API_KEY");
      const net = ctx.env === "sandbox" ? "eth-sepolia" : "eth-mainnet";
      const j = await readJson(await ctx.fetch(`https://${net}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) }), "alchemy");
      if (typeof j?.result !== "string") throw new Error("Unexpected RPC payload");
      return { ok: true, message: `${net} block ${parseInt(j.result, 16)}` };
    }),
  },
  {
    id: "coingecko", name: "CoinGecko", category: "market_data", phase: 2, userKeys: "service",
    description: "Crypto market data, market cap, token metadata and historical prices.",
    docsUrl: "https://docs.coingecko.com/", signupUrl: "https://www.coingecko.com/en/api",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "COINGECKO_API_KEY", label: "API key (Demo or Pro)", secret: true, required: false, help: "Without a key the keyless public tier is used (strict rate limits)." }],
    settings: [{ key: "plan", label: "Plan (demo | pro)", defaults: { production: "demo" } }],
    assetClasses: ["crypto"], networks: ["*"], capabilities: ["market_data", "history", "metadata"], environments: ["production"],
    commercialRequirements: "Demo plan is non-commercial; a paid plan is required for commercial display/redistribution.",
    troubleshooting: ["Demo keys use api.coingecko.com + x-cg-demo-api-key; Pro keys use pro-api.coingecko.com + x-cg-pro-api-key"],
    test: (ctx) => timed(async () => {
      const key = await ctx.cred("COINGECKO_API_KEY");
      const plan = (await ctx.setting("plan")) ?? "demo";
      const base = key && plan === "pro" ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
      const headers: Record<string, string> = key ? { [plan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {};
      const j = await readJson(await ctx.fetch(`${base}/ping`, { headers }), "coingecko");
      if (!j?.gecko_says) throw new Error("Unexpected payload");
      return { ok: true, message: key ? `Connected (${plan} key)` : "Connected (keyless public tier)" };
    }),
  },
  {
    id: "massive", name: "Massive (formerly Polygon.io)", category: "market_data", phase: 2, userKeys: "service", optional: true,
    description: "Licensed US stock, options and indices market data (REST + WebSocket).",
    docsUrl: "https://massive.com/docs", signupUrl: "https://massive.com/",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "MASSIVE_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    assetClasses: ["stock", "etf", "option"], networks: ["XNYS", "XNAS", "ARCX"], capabilities: ["market_data", "history", "streaming"],
    environments: ["production"],
    commercialRequirements: "Displaying real-time exchange data to end users requires the appropriate business plan and exchange agreements.",
    troubleshooting: ["Free tier data is end-of-day/delayed — label as delayed in UI"],
    test: (ctx) => timed(async () => {
      const { MASSIVE_API_KEY } = await need(ctx, "MASSIVE_API_KEY");
      const j = await readJson(await ctx.fetch(`https://api.massive.com/v1/marketstatus/now?apiKey=${MASSIVE_API_KEY}`), "massive");
      if (!j?.market) throw new Error("Unexpected payload");
      return { ok: true, message: `Market status: ${j.market}` };
    }),
  },
  {
    id: "twelvedata", name: "Twelve Data", category: "market_data", phase: 2, userKeys: "service", optional: true,
    description: "Global stocks, ETFs, forex and crypto time series.",
    docsUrl: "https://twelvedata.com/docs", signupUrl: "https://twelvedata.com/pricing",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "TWELVEDATA_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    assetClasses: ["stock", "etf", "crypto"], networks: ["*"], capabilities: ["market_data", "history"], environments: ["production"],
    commercialRequirements: "Commercial redistribution requires an enterprise/display license.",
    troubleshooting: ["Errors are returned as HTTP 200 with status:'error' — Merod checks the body"],
    test: (ctx) => timed(async () => {
      const { TWELVEDATA_API_KEY } = await need(ctx, "TWELVEDATA_API_KEY");
      const j = await readJson(await ctx.fetch(`https://api.twelvedata.com/price?symbol=AAPL&apikey=${TWELVEDATA_API_KEY}`), "twelvedata");
      if (j?.status === "error" || !j?.price) throw new Error(j?.message ?? "Unexpected payload");
      return { ok: true, message: `AAPL ${j.price}` };
    }),
  },
  {
    id: "privy", name: "Privy", category: "wallet", phase: 2,
    description: "Embedded wallets, external wallet connections, authentication and policy-controlled delegated signing.",
    docsUrl: "https://docs.privy.io/", signupUrl: "https://dashboard.privy.io/",
    authMethod: "basic", supportsWebhooks: true, supportsOAuth: true,
    credentials: [
      { name: "PRIVY_APP_ID", label: "App ID", secret: false, required: true },
      { name: "PRIVY_APP_SECRET", label: "App secret", secret: true, required: true },
      { name: "PRIVY_AUTHORIZATION_KEY", label: "Authorization private key (for server-controlled signing)", secret: true, required: false, help: "Only needed for delegated / server-wallet signing with authorization signatures." },
    ],
    settings: [{ key: "webhook_url", label: "Webhook URL", defaults: {} }],
    sdk: { packages: ["@privy-io/react-auth", "@privy-io/node"], install: "npm i @privy-io/react-auth @privy-io/node", notes: "React SDK provides login + embedded wallet UI; Node SDK for server wallet operations." },
    assetClasses: ["crypto"], networks: ["ethereum", "base", "polygon", "arbitrum", "solana", "bitcoin"], capabilities: ["embedded_wallets", "signing", "auth"],
    environments: ["sandbox", "production"],
    commercialRequirements: "Security review of signing policies, spending limits and key quorum before enabling delegated real-money signing.",
    troubleshooting: ["Use a separate Privy app for development vs production", "Configure allowed origins in the Privy dashboard"],
    test: (ctx) => timed(async () => {
      const { PRIVY_APP_ID, PRIVY_APP_SECRET } = await need(ctx, "PRIVY_APP_ID", "PRIVY_APP_SECRET");
      const auth = Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString("base64");
      const j = await readJson(await ctx.fetch(`https://api.privy.io/v1/users?limit=1`, {
        headers: { Authorization: `Basic ${auth}`, "privy-app-id": PRIVY_APP_ID } }), "privy");
      if (!Array.isArray(j?.data)) throw new Error("Unexpected payload");
      return { ok: true, message: "Authenticated against Privy REST API" };
    }),
  },

  // ───────────── Phase 3: crypto execution ─────────────
  {
    id: "jupiter", name: "Jupiter", category: "crypto_execution", phase: 3, userKeys: "service",
    description: "Solana swap aggregator: quotes, liquidity routing and transaction building for SPL tokens and established meme coins.",
    docsUrl: "https://developers.jup.ag/docs", signupUrl: "https://developers.jup.ag/portal",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "JUPITER_API_KEY", label: "API key", secret: true, required: false, help: "Required for Swap v2 execution. Keyless api.jup.ag is limited to 0.5 RPS (prices/search only)." }],
    settings: [],
    assetClasses: ["crypto"], networks: ["solana"], capabilities: ["quote", "execute", "discovery", "routing"], environments: ["production"],
    commercialRequirements: "Wallet signing security review + live_crypto_trading feature flag. Jupiter has no testnet; sandbox testing uses quotes only.",
    troubleshooting: ["No route: token lacks liquidity", "Quote expired: re-quote before signing", "Use priority fees during congestion"],
    test: (ctx) => timed(async () => {
      // lite-api.jup.ag is being phased out: keyless traffic now goes to api.jup.ag at 0.5 RPS.
      const key = await ctx.cred("JUPITER_API_KEY");
      const headers: Record<string, string> = key ? { "x-api-key": key } : {};
      if (key) {
        const j = await readJson(await ctx.fetch(`https://api.jup.ag/swap/v2/order?inputMint=${SOL_MINT}&outputMint=${USDC_SOL}&amount=10000000`, { headers }), "jupiter");
        if (!j?.outAmount) throw new Error("Unexpected Swap v2 order payload");
        return { ok: true, message: `Swap v2 quote 0.01 SOL → ${(Number(j.outAmount) / 1e6).toFixed(4)} USDC` };
      }
      const j = await readJson(await ctx.fetch(`https://api.jup.ag/price/v3?ids=${SOL_MINT}`, { headers }), "jupiter");
      const px = j?.[SOL_MINT]?.usdPrice;
      if (typeof px !== "number") throw new Error("Unexpected Price v3 payload");
      return { ok: true, message: `Keyless tier OK (SOL ${px.toFixed(2)} USD). Add a key for Swap v2 execution.` };
    }),
  },
  {
    id: "pumpfun", name: "Pump.fun + PumpSwap", category: "crypto_execution", phase: 3, userKeys: "service",
    description: "Direct bonding-curve trading for newly launched tokens and PumpSwap AMM trading after graduation, with automatic lifecycle detection.",
    docsUrl: "https://github.com/pump-fun/pump-public-docs", signupUrl: "https://github.com/pump-fun/pump-public-docs",
    authMethod: "none", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "SOLANA_RPC_URL", label: "Private Solana RPC URL (optional)", secret: true, required: false, help: "Paste any Solana RPC URL (it often embeds a key). Defaults to Helius when HELIUS_API_KEY is configured." }],
    settings: [{ key: "rpc_url", label: "Public Solana RPC URL (non-secret, optional)", defaults: {} }],
    sdk: { packages: ["@pump-fun/pump-sdk", "@pump-fun/pump-swap-sdk", "@solana/web3.js", "@coral-xyz/anchor"], install: "npm i @pump-fun/pump-sdk @pump-fun/pump-swap-sdk @solana/web3.js @coral-xyz/anchor", notes: "Lifecycle detection and bonding-curve quotes work via raw RPC reads; building signed buy/sell instructions requires the SDKs." },
    assetClasses: ["crypto"], networks: ["solana"], capabilities: ["quote", "execute", "lifecycle_detection", "launches"], environments: ["production"],
    commercialRequirements: "High-risk asset class: token screening, liquidity minimums and explicit risk acknowledgement required before live trading.",
    troubleshooting: ["Requires a Solana RPC (Helius recommended)", "Graduated tokens route to PumpSwap or Jupiter"],
    test: (ctx) => timed(async () => {
      const rpc = await solanaRpc(ctx);
      if (!rpc) throw new Error("No Solana RPC configured (set HELIUS_API_KEY, SOLANA_RPC_URL or rpc_url)");
      const j = await readJson(await ctx.fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [PUMP_PROGRAM, { encoding: "base64" }] }) }), "pumpfun");
      if (!j?.result?.value?.executable) throw new Error("Pump program account not found/executable on this RPC");
      return { ok: true, message: "Pump.fun program reachable via RPC" };
    }),
  },
  {
    id: "zerox", name: "0x Swap API", category: "crypto_execution", phase: 3, userKeys: "service",
    description: "EVM DEX aggregation (Ethereum, Base, BNB Chain, Polygon, Arbitrum, Avalanche and more).",
    docsUrl: "https://docs.0x.org/", signupUrl: "https://dashboard.0x.org/",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "ZEROX_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    assetClasses: ["crypto"], networks: ["ethereum", "base", "bsc", "polygon", "arbitrum", "avalanche", "optimism"],
    capabilities: ["quote", "execute", "routing"], environments: ["production"],
    commercialRequirements: "Production rate limits and any integrator-fee setup are configured in the 0x dashboard.",
    troubleshooting: ["Supported chains are listed by GET /swap/chains", "Insufficient allowance: approve the AllowanceHolder spender first"],
    test: (ctx) => timed(async () => {
      const { ZEROX_API_KEY } = await need(ctx, "ZEROX_API_KEY");
      const j = await readJson(await ctx.fetch("https://api.0x.org/swap/chains", { headers: { "0x-api-key": ZEROX_API_KEY, "0x-version": "v2" } }), "zerox");
      if (!Array.isArray(j?.chains)) throw new Error("Unexpected payload");
      return { ok: true, message: `${j.chains.length} chains supported` };
    }),
  },
  {
    id: "swapkit", name: "SwapKit", category: "crypto_execution", phase: 3, userKeys: "service",
    description: "Native cross-chain swaps (BTC, DOGE, LTC, XRP and more) with cross-chain transaction tracking.",
    docsUrl: "https://docs.swapkit.dev/", signupUrl: "https://www.swapkit.dev/",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "SWAPKIT_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    assetClasses: ["crypto"], networks: ["bitcoin", "dogecoin", "litecoin", "xrp", "ethereum", "cosmos", "thorchain", "maya"],
    capabilities: ["quote", "execute", "cross_chain", "tracking"], environments: ["production"],
    commercialRequirements: "Cross-chain swaps involve native deposits; requires wallet support per chain and compliance review.",
    troubleshooting: ["Asset identifiers use CHAIN.SYMBOL notation (e.g. BTC.BTC)"],
    test: (ctx) => timed(async () => {
      const { SWAPKIT_API_KEY } = await need(ctx, "SWAPKIT_API_KEY");
      const j = await readJson(await ctx.fetch("https://api.swapkit.dev/providers", { headers: { "x-api-key": SWAPKIT_API_KEY } }), "swapkit");
      if (!Array.isArray(j)) throw new Error("Unexpected payload");
      return { ok: true, message: `${j.length} swap providers available` };
    }),
  },
  {
    id: "cetus", name: "Cetus Aggregator", category: "crypto_execution", phase: 3, userKeys: "service",
    description: "Sui blockchain swap aggregation for Sui ecosystem tokens.",
    docsUrl: "https://cetus-1.gitbook.io/cetus-developer-docs/", signupUrl: "https://cetus-1.gitbook.io/cetus-developer-docs/",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "CETUS_API_KEY", label: "API key (optional, higher limits)", secret: true, required: false, help: "Sent as the `apikey` query parameter supported by the Cetus aggregator API." }],
    settings: [{ key: "api_url", label: "Router API URL", defaults: { production: "https://api-sui.cetus.zone/router_v3/find_routes" } }],
    sdk: { packages: ["@cetusprotocol/aggregator-sdk", "@mysten/sui"], install: "npm i @cetusprotocol/aggregator-sdk @mysten/sui", notes: "SDK builds the Sui transaction block from a route." },
    assetClasses: ["crypto"], networks: ["sui"], capabilities: ["quote", "execute", "routing"], environments: ["production"],
    commercialRequirements: "Sui wallet support (Privy does not cover all Sui flows — use a Sui wallet adapter).",
    troubleshooting: ["Coin types are full Move type strings (e.g. 0x2::sui::SUI)"],
    test: (ctx) => timed(async () => {
      const url = (await ctx.setting("api_url")) ?? "https://api-sui.cetus.zone/router_v3/find_routes";
      const usdc = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
      const key = await ctx.cred("CETUS_API_KEY");
      const j = await readJson(await ctx.fetch(`${url}?from=0x2::sui::SUI&target=${encodeURIComponent(usdc)}&amount=1000000000&by_amount_in=true${key ? `&apikey=${encodeURIComponent(key)}` : ""}`), "cetus");
      if (j?.code !== undefined && j.code !== 200) throw new Error(j?.msg ?? `code ${j.code}`);
      return { ok: true, message: "Route found for 1 SUI → USDC" };
    }),
  },
  {
    id: "panora", name: "Panora", category: "crypto_execution", phase: 3, userKeys: "service",
    description: "Aptos DEX aggregator for Aptos ecosystem tokens.",
    docsUrl: "https://docs.panora.exchange/", signupUrl: "https://docs.panora.exchange/",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "PANORA_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    sdk: { packages: ["@aptos-labs/ts-sdk"], install: "npm i @aptos-labs/ts-sdk", notes: "Used to sign/submit the transaction payload Panora returns." },
    assetClasses: ["crypto"], networks: ["aptos"], capabilities: ["quote", "execute", "routing"], environments: ["production"],
    commercialRequirements: "Aptos wallet support (Petra / Aptos wallet adapter) required for signing.",
    troubleshooting: ["Token addresses use Aptos FA/coin type format"],
    test: (ctx) => timed(async () => {
      const { PANORA_API_KEY } = await need(ctx, "PANORA_API_KEY");
      const usdc = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
      const qs = `fromTokenAddress=0xa&toTokenAddress=${usdc}&fromTokenAmount=1`;
      const j = await readJson(await ctx.fetch(`https://api.panora.exchange/swap/quote?${qs}`, { headers: { "x-api-key": PANORA_API_KEY } }), "panora");
      if (!j?.quotes && !j?.toTokenAmount) throw new Error("Unexpected payload");
      return { ok: true, message: "Quote returned for 1 APT → USDC" };
    }),
  },

  // ───────────── Phase 4: AI ─────────────
  {
    id: "anthropic", name: "Claude (Anthropic) — Opus, Sonnet, Haiku", category: "ai", phase: 4, userKeys: "service",
    description: "Claude models for prompt interpretation, research, strategy and bot configuration (structured outputs).",
    docsUrl: "https://platform.claude.com/docs", signupUrl: "https://platform.claude.com/",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "ANTHROPIC_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    sdk: { packages: ["@anthropic-ai/sdk"], install: "npm i @anthropic-ai/sdk (installed)" },
    assetClasses: [], networks: [], capabilities: ["llm", "structured_output"], environments: ["production"],
    commercialRequirements: "Standard API terms; AI never receives credentials or signing material.",
    troubleshooting: ["401: invalid key", "429: rate limited — Merod falls back to the deterministic parser"],
    test: (ctx) => timed(async () => {
      const { ANTHROPIC_API_KEY } = await need(ctx, "ANTHROPIC_API_KEY");
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 10_000, maxRetries: 0 });
      const m = await client.models.retrieve("claude-opus-5-5");
      return { ok: true, message: `Model available: ${m.display_name ?? m.id}` };
    }),
  },
  {
    id: "openai", name: "ChatGPT (OpenAI)", category: "ai", phase: 4, userKeys: "service",
    description: "OpenAI models for prompt interpretation, research and strategy creation (structured outputs).",
    docsUrl: "https://platform.openai.com/docs", signupUrl: "https://platform.openai.com/",
    authMethod: "bearer", supportsWebhooks: false, supportsOAuth: false,
    credentials: [{ name: "OPENAI_API_KEY", label: "API key", secret: true, required: true }], settings: [],
    sdk: { packages: ["openai"], install: "npm i openai (installed)" },
    assetClasses: [], networks: [], capabilities: ["llm", "structured_output"], environments: ["production"],
    commercialRequirements: "Standard API terms; AI never receives credentials or signing material.",
    troubleshooting: ["401: invalid key", "Organization may need model access enabled"],
    test: (ctx) => timed(async () => {
      const { OPENAI_API_KEY } = await need(ctx, "OPENAI_API_KEY");
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 10_000, maxRetries: 0 });
      const page = await client.models.list();
      return { ok: true, message: `${page.data.length} models visible` };
    }),
  },

  // ───────────── Phase 5: stocks ─────────────
  {
    id: "alpaca_trading", name: "Alpaca Trading API", category: "stock_execution", phase: 5, userKeys: "personal_account",
    description: "US stocks & ETFs, fractional shares and paper trading for an individual Alpaca account.",
    docsUrl: "https://docs.alpaca.markets/", signupUrl: "https://app.alpaca.markets/signup",
    authMethod: "api_key", supportsWebhooks: false, supportsOAuth: true,
    credentials: [
      { name: "ALPACA_API_KEY", label: "API key ID", secret: true, required: true },
      { name: "ALPACA_API_SECRET", label: "API secret key", secret: true, required: true },
    ],
    settings: [{ key: "base_url", label: "Base URL (ALPACA_BASE_URL)", defaults: { sandbox: "https://paper-api.alpaca.markets", production: "https://api.alpaca.markets" } }],
    assetClasses: ["stock", "etf"], networks: ["XNYS", "XNAS", "ARCX", "BATS"], capabilities: ["quote", "execute", "positions", "asset_catalog", "paper"],
    environments: ["sandbox", "production"],
    commercialRequirements: "The Trading API trades ONE Alpaca account. It must never execute other customers' orders. Customer trading requires the Broker API + Alpaca commercial agreement (or Alpaca OAuth Connect for users' own accounts).",
    troubleshooting: ["Paper and live keys are different", "403: account restricted / PDT rules"],
    test: (ctx) => timed(async () => {
      const { ALPACA_API_KEY, ALPACA_API_SECRET } = await need(ctx, "ALPACA_API_KEY", "ALPACA_API_SECRET");
      const base = (await ctx.setting("base_url")) ?? process.env.ALPACA_BASE_URL ?? (ctx.env === "sandbox" ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets");
      const j = await readJson(await ctx.fetch(`${base}/v2/account`, { headers: { "APCA-API-KEY-ID": ALPACA_API_KEY, "APCA-API-SECRET-KEY": ALPACA_API_SECRET } }), "alpaca_trading");
      if (!j?.status) throw new Error("Unexpected payload");
      return { ok: true, message: `Account status ${j.status}${base.includes("paper") ? " (paper)" : ""}` };
    }),
  },
  {
    id: "alpaca_broker", name: "Alpaca Broker API", category: "stock_execution", phase: 5,
    description: "Embedded brokerage: customer account opening (KYC), funding, and order execution for Merod customers.",
    docsUrl: "https://docs.alpaca.markets/docs/about-broker-api", signupUrl: "https://broker-app.alpaca.markets/",
    authMethod: "basic", supportsWebhooks: true, supportsOAuth: false,
    credentials: [
      { name: "ALPACA_BROKER_API_KEY", label: "Broker API key", secret: true, required: true, help: "Broker API keys are separate from Trading API keys." },
      { name: "ALPACA_BROKER_API_SECRET", label: "Broker API secret", secret: true, required: true },
    ],
    settings: [{ key: "base_url", label: "Base URL", defaults: { sandbox: "https://broker-api.sandbox.alpaca.markets", production: "https://broker-api.alpaca.markets" } }],
    assetClasses: ["stock", "etf"], networks: ["XNYS", "XNAS", "ARCX"], capabilities: ["accounts", "kyc", "funding", "execute", "asset_catalog"],
    environments: ["sandbox", "production"],
    commercialRequirements: "Signed Alpaca Broker agreement, KYC/AML program, disclosures and Alpaca go-live approval. Live customer stock trading stays disabled until then.",
    troubleshooting: ["Sandbox accounts are auto-approved; production KYC is asynchronous (use SSE events)"],
    test: (ctx) => timed(async () => {
      const { ALPACA_BROKER_API_KEY, ALPACA_BROKER_API_SECRET } = await need(ctx, "ALPACA_BROKER_API_KEY", "ALPACA_BROKER_API_SECRET");
      const base = (await ctx.setting("base_url")) ?? (ctx.env === "sandbox" ? "https://broker-api.sandbox.alpaca.markets" : "https://broker-api.alpaca.markets");
      const auth = Buffer.from(`${ALPACA_BROKER_API_KEY}:${ALPACA_BROKER_API_SECRET}`).toString("base64");
      const j = await readJson(await ctx.fetch(`${base}/v1/assets?status=active&asset_class=us_equity`, { headers: { Authorization: `Basic ${auth}` } }), "alpaca_broker");
      if (!Array.isArray(j)) throw new Error("Unexpected payload");
      return { ok: true, message: `${j.length} active assets in catalog` };
    }),
  },
  {
    id: "snaptrade", name: "SnapTrade", category: "stock_execution", phase: 5,
    description: "Connect users' existing brokerage accounts; sync balances/holdings and trade where the brokerage supports it.",
    docsUrl: "https://docs.snaptrade.com/", signupUrl: "https://dashboard.snaptrade.com/",
    authMethod: "hmac_sdk", supportsWebhooks: true, supportsOAuth: true,
    credentials: [
      { name: "SNAPTRADE_CLIENT_ID", label: "Client ID", secret: false, required: true },
      { name: "SNAPTRADE_CONSUMER_KEY", label: "Consumer key", secret: true, required: true },
    ],
    settings: [{ key: "webhook_url", label: "Webhook URL", defaults: {} }],
    sdk: { packages: ["snaptrade-typescript-sdk"], install: "npm i snaptrade-typescript-sdk (installed)", notes: "Requests are HMAC-signed by the SDK." },
    assetClasses: ["stock", "etf", "crypto"], networks: ["*"], capabilities: ["connect", "holdings", "execute"], environments: ["sandbox", "production"],
    commercialRequirements: "Production keys and trading permissions require SnapTrade approval; per-brokerage trade support varies.",
    troubleshooting: ["Personal keys only allow your own connections", "Trading must be enabled per connection"],
    test: (ctx) => timed(async () => {
      const { SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY } = await need(ctx, "SNAPTRADE_CLIENT_ID", "SNAPTRADE_CONSUMER_KEY");
      const { Snaptrade, SnaptradeAuth } = await import("snaptrade-typescript-sdk");
      const st = new Snaptrade({ auth: SnaptradeAuth.commercialApiKey({ clientId: SNAPTRADE_CLIENT_ID, consumerKey: SNAPTRADE_CONSUMER_KEY }) });
      const r = await st.apiStatus.check();
      if (!r.data?.online) throw new Error("SnapTrade reports offline");
      return { ok: true, message: `SnapTrade API online (v${r.data.version ?? "?"})` };
    }),
  },
  {
    id: "ibkr", name: "Interactive Brokers", category: "stock_execution", phase: 5, userKeys: "personal_account",
    description: "International markets and global securities via the IBKR Web API (Client Portal Gateway for development; OAuth for approved third parties).",
    docsUrl: "https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/", signupUrl: "https://www.interactivebrokers.com/en/trading/ib-api.php",
    authMethod: "session_gateway", supportsWebhooks: false, supportsOAuth: true,
    credentials: [
      { name: "IBKR_OAUTH_CONSUMER_KEY", label: "OAuth consumer key (third-party, after IBKR approval)", secret: true, required: false },
    ],
    settings: [{ key: "gateway_url", label: "Client Portal Gateway URL (IBKR_GATEWAY_URL)", defaults: { sandbox: "https://localhost:5000" }, help: "Run the IBKR Client Portal Gateway and log in with a paper account." }],
    assetClasses: ["stock", "etf", "option", "future", "forex"], networks: ["global"], capabilities: ["quote", "execute", "positions"],
    environments: ["sandbox", "production"],
    commercialRequirements: "Serving Merod customers requires IBKR third-party/introducing-broker approval and OAuth onboarding. The gateway approach is limited to a single logged-in account.",
    troubleshooting: ["Gateway sessions expire — call /tickle periodically", "Self-signed TLS on the local gateway"],
    test: (ctx) => timed(async () => {
      const gw = (await ctx.setting("gateway_url")) ?? process.env.IBKR_GATEWAY_URL;
      if (!gw) throw new Error("No IBKR gateway URL configured");
      const j = await readJson(await ctx.fetch(`${gw}/v1/api/iserver/auth/status`, { method: "POST" }), "ibkr");
      if (!j?.authenticated) throw new Error("Gateway reachable but session not authenticated — log in to the gateway");
      return { ok: true, message: "Gateway session authenticated" };
    }),
  },
  {
    id: "tradier", name: "Tradier", category: "stock_execution", phase: 5, userKeys: "personal_account", optional: true,
    description: "US stocks and options trading; sandbox for development.",
    docsUrl: "https://docs.tradier.com/", signupUrl: "https://developer.tradier.com/",
    authMethod: "bearer", supportsWebhooks: false, supportsOAuth: true,
    credentials: [{ name: "TRADIER_ACCESS_TOKEN", label: "Access token", secret: true, required: true }],
    settings: [{ key: "base_url", label: "Base URL", defaults: { sandbox: "https://sandbox.tradier.com", production: "https://api.tradier.com" } }],
    assetClasses: ["stock", "etf", "option"], networks: ["XNYS", "XNAS"], capabilities: ["quote", "execute", "positions"], environments: ["sandbox", "production"],
    commercialRequirements: "Commercial (multi-user) integrations require Tradier partner approval.",
    troubleshooting: ["Sandbox quotes are delayed 15 minutes"],
    test: (ctx) => timed(async () => {
      const { TRADIER_ACCESS_TOKEN } = await need(ctx, "TRADIER_ACCESS_TOKEN");
      const base = (await ctx.setting("base_url")) ?? (ctx.env === "sandbox" ? "https://sandbox.tradier.com" : "https://api.tradier.com");
      const j = await readJson(await ctx.fetch(`${base}/v1/user/profile`, { headers: { Authorization: `Bearer ${TRADIER_ACCESS_TOKEN}`, Accept: "application/json" } }), "tradier");
      if (!j?.profile) throw new Error("Unexpected payload");
      return { ok: true, message: `Profile ${j.profile.name ?? j.profile.id}` };
    }),
  },
];

/** Production requires an explicit compliance approval for these categories even after a successful test. */
export const APPROVAL_GATED = new Set(["crypto_execution", "stock_execution", "wallet"]);

export const getProvider = (id: string) => PROVIDERS.find((p) => p.id === id);
