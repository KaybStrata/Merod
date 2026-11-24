import "@/lib/server-only-shim";
import { contextFor } from "./integrations";
import { readJson, ProviderError } from "./http";
import type { ExecutionQuote, ProviderContext, ProviderEnv } from "./types";
import type { AssetRow } from "../market/prices";
import { EXCHANGE_ADAPTERS } from "./exchanges";

/**
 * Execution adapters. Every adapter returns the same ExecutionQuote shape and submit result,
 * so the Universal Trading Engine can route to any provider without provider-specific logic.
 *
 * Live DEX swaps are NON-CUSTODIAL: the adapter returns an unsigned transaction which must be
 * signed by the user's wallet (or a Privy wallet under a user-granted, revocable policy).
 * Merod never holds private keys and AI never sees signing material.
 */

export interface QuoteRequest {
  asset: AssetRow; side: "buy" | "sell"; quantity?: number; notionalUsd?: number;
  refPrice: number; slippageBps: number; account: { id: string; external_ref: string | null; network: string | null; metadata: any };
}
export type SubmitResult =
  | { status: "filled"; providerOrderId: string; fills: { quantity: number; price: number; feeUsd: number; fillId: string; txHash?: string }[] }
  | { status: "submitted"; providerOrderId: string }
  | { status: "awaiting_signature"; providerOrderId: string; unsignedTx: unknown; signingNetwork: string; instructions: string };
export interface OrderLike {
  id: string; side: "buy" | "sell"; order_type: string; quantity: number | null; notional_usd: number | null; limit_price: number | null;
  stop_price: number | null; time_in_force: string; provider_order_id: string | null; quote: any; max_slippage_bps: number | null;
}
export interface StatusResult { status: "submitted" | "partially_filled" | "filled" | "cancelled" | "rejected" | "expired"; filledQty: number; avgPrice: number | null; fills: { quantity: number; price: number; feeUsd: number; fillId: string; txHash?: string }[]; reason?: string }

export interface ExecutionAdapter {
  id: string;
  supports(asset: AssetRow): boolean;
  quote(ctx: ProviderContext, req: QuoteRequest): Promise<ExecutionQuote>;
  submit(ctx: ProviderContext, order: OrderLike, asset: AssetRow, account: QuoteRequest["account"]): Promise<SubmitResult>;
  status?(ctx: ProviderContext, order: OrderLike, account: QuoteRequest["account"]): Promise<StatusResult>;
  cancel?(ctx: ProviderContext, order: OrderLike, account: QuoteRequest["account"]): Promise<void>;
  /** Called after the user's wallet signed an unsigned transaction returned by submit(). */
  submitSigned?(ctx: ProviderContext, order: OrderLike, signed: { signedTransaction?: string; txHash?: string }): Promise<SubmitResult>;
}

const nowIso = () => new Date().toISOString();
const qtyFor = (r: QuoteRequest) => r.quantity ?? (r.notionalUsd ?? 0) / r.refPrice;

/* ───────────── Paper (simulated) ───────────── */
/** Realistic-ish simulated costs: commission-free stocks with spread, crypto taker fee + spread. */
export const PAPER_COSTS = {
  stock: { feeBps: 0, spreadBps: 2 }, etf: { feeBps: 0, spreadBps: 1 }, option: { feeBps: 0, spreadBps: 20 },
  crypto: { feeBps: 30, spreadBps: 8 }, meme: { feeBps: 100, spreadBps: 60 },
};
export const paperAdapter: ExecutionAdapter = {
  id: "paper",
  supports: (a) => ["paper_tradable", "live_tradable"].includes(a.tradability),
  async quote(_ctx, r) {
    const meme = r.asset.categories?.includes("meme") && (r.asset.liquidity_usd ?? Infinity) < 5_000_000;
    const c = meme ? PAPER_COSTS.meme : PAPER_COSTS[r.asset.asset_class as keyof typeof PAPER_COSTS] ?? PAPER_COSTS.crypto;
    // size-dependent impact for thin liquidity
    const notional = r.notionalUsd ?? qtyFor(r) * r.refPrice;
    const impactBps = r.asset.liquidity_usd ? Math.min(500, (notional / r.asset.liquidity_usd) * 10_000) : 0;
    const slip = c.spreadBps + impactBps;
    const price = r.refPrice * (1 + ((r.side === "buy" ? 1 : -1) * slip) / 10_000);
    const quantity = r.quantity ?? notional / price;
    const n = quantity * price;
    return { providerId: "paper", price, quantity, notionalUsd: n, feeUsd: (n * c.feeBps) / 10_000, slippageBps: Math.round(slip), priceImpactBps: Math.round(impactBps),
      route: "Simulated fill", quotedAt: nowIso(), expiresAt: new Date(Date.now() + 30_000).toISOString(), simulated: true };
  },
  async submit(_ctx, order) {
    const q = order.quote as ExecutionQuote;
    if (order.order_type !== "market") return { status: "submitted", providerOrderId: `paper-${order.id}` };
    return { status: "filled", providerOrderId: `paper-${order.id}`, fills: [{ quantity: q.quantity, price: q.price, feeUsd: q.feeUsd, fillId: `paper-fill-${order.id}` }] };
  },
};

/* ───────────── Alpaca Trading API (single account; paper by default) ───────────── */
async function alpacaHeaders(ctx: ProviderContext) {
  const k = await ctx.cred("ALPACA_API_KEY"), s = await ctx.cred("ALPACA_API_SECRET");
  if (!k || !s) throw new ProviderError("alpaca_trading", 0, "Missing ALPACA_API_KEY / ALPACA_API_SECRET");
  return { "APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s, "content-type": "application/json" };
}
const alpacaBase = async (ctx: ProviderContext) => (await ctx.setting("base_url")) ?? process.env.ALPACA_BASE_URL ?? "https://paper-api.alpaca.markets";
const mapAlpaca = (s: string): StatusResult["status"] =>
  s === "filled" ? "filled" : s === "partially_filled" ? "partially_filled" : ["canceled", "done_for_day", "replaced"].includes(s) ? "cancelled" : s === "rejected" ? "rejected" : s === "expired" ? "expired" : "submitted";

export const alpacaTradingAdapter: ExecutionAdapter = {
  id: "alpaca_trading",
  supports: (a) => ["stock", "etf"].includes(a.asset_class) && ["XNAS", "XNYS", "ARCX", "BATS", "XASE"].includes(a.venue),
  async quote(ctx, r) {
    // Alpaca has no firm quotes for equities; use latest trade from the data API and model spread.
    const h = await alpacaHeaders(ctx);
    const j = await readJson(await ctx.fetch(`https://data.alpaca.markets/v2/stocks/${r.asset.symbol}/quotes/latest?feed=iex`, { headers: h }), "alpaca_trading").catch(() => null);
    const bid = j?.quote?.bp, ask = j?.quote?.ap;
    const price = (r.side === "buy" ? ask : bid) || r.refPrice;
    const quantity = r.quantity ?? (r.notionalUsd ?? 0) / price;
    return { providerId: "alpaca_trading", price, quantity, notionalUsd: quantity * price, feeUsd: 0, slippageBps: 5, route: "Alpaca smart routing",
      quotedAt: nowIso(), expiresAt: new Date(Date.now() + 15_000).toISOString(), raw: j?.quote ?? null, simulated: false };
  },
  async submit(ctx, o, asset) {
    const body: Record<string, unknown> = {
      symbol: asset.symbol, side: o.side, type: o.order_type, time_in_force: o.order_type === "market" && !o.quantity ? "day" : o.time_in_force,
      client_order_id: o.id, // idempotency at the broker
    };
    if (o.quantity) body.qty = String(o.quantity); else body.notional = String(o.notional_usd);
    if (o.limit_price) body.limit_price = String(o.limit_price);
    if (o.stop_price) body.stop_price = String(o.stop_price);
    const j = await readJson(await ctx.fetch(`${await alpacaBase(ctx)}/v2/orders`, { method: "POST", headers: await alpacaHeaders(ctx), body: JSON.stringify(body) }), "alpaca_trading");
    return { status: "submitted", providerOrderId: j.id };
  },
  async status(ctx, o) {
    const j = await readJson(await ctx.fetch(`${await alpacaBase(ctx)}/v2/orders/${o.provider_order_id}`, { headers: await alpacaHeaders(ctx) }), "alpaca_trading");
    const filled = Number(j.filled_qty ?? 0), avg = j.filled_avg_price ? Number(j.filled_avg_price) : null;
    return { status: mapAlpaca(j.status), filledQty: filled, avgPrice: avg, fills: filled && avg ? [{ quantity: filled, price: avg, feeUsd: 0, fillId: `${j.id}:${filled}` }] : [] };
  },
  async cancel(ctx, o) {
    const res = await ctx.fetch(`${await alpacaBase(ctx)}/v2/orders/${o.provider_order_id}`, { method: "DELETE", headers: await alpacaHeaders(ctx) });
    if (!res.ok && res.status !== 204) await readJson(res, "alpaca_trading");
  },
};

/* ───────────── Tradier ───────────── */
async function tradier(ctx: ProviderContext) {
  const t = await ctx.cred("TRADIER_ACCESS_TOKEN");
  if (!t) throw new ProviderError("tradier", 0, "Missing TRADIER_ACCESS_TOKEN");
  return { base: (await ctx.setting("base_url"))!, headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } };
}
export const tradierAdapter: ExecutionAdapter = {
  id: "tradier",
  supports: (a) => ["stock", "etf"].includes(a.asset_class) && ["XNAS", "XNYS", "ARCX"].includes(a.venue),
  async quote(ctx, r) {
    const { base, headers } = await tradier(ctx);
    const j = await readJson(await ctx.fetch(`${base}/v1/markets/quotes?symbols=${r.asset.symbol}`, { headers }), "tradier");
    const qt = j?.quotes?.quote;
    const price = (r.side === "buy" ? qt?.ask : qt?.bid) || qt?.last || r.refPrice;
    const quantity = Math.floor(r.quantity ?? (r.notionalUsd ?? 0) / price); // Tradier equities: whole shares
    return { providerId: "tradier", price, quantity, notionalUsd: quantity * price, feeUsd: 0, slippageBps: 5, route: "Tradier", quotedAt: nowIso(), raw: qt, simulated: false };
  },
  async submit(ctx, o, asset, account) {
    const { base, headers } = await tradier(ctx);
    if (!account.external_ref) throw new ProviderError("tradier", 0, "Tradier account id missing on trading account");
    const form = new URLSearchParams({ class: "equity", symbol: asset.symbol, side: o.side, quantity: String(Math.floor(o.quantity ?? 0)), type: o.order_type, duration: o.time_in_force === "gtc" ? "gtc" : "day", tag: o.id.replace(/-/g, "").slice(0, 32) });
    if (o.limit_price) form.set("price", String(o.limit_price));
    if (o.stop_price) form.set("stop", String(o.stop_price));
    const j = await readJson(await ctx.fetch(`${base}/v1/accounts/${account.external_ref}/orders`, { method: "POST", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, body: form }), "tradier");
    return { status: "submitted", providerOrderId: String(j?.order?.id) };
  },
  async status(ctx, o, account) {
    const { base, headers } = await tradier(ctx);
    const j = await readJson(await ctx.fetch(`${base}/v1/accounts/${account.external_ref}/orders/${o.provider_order_id}`, { headers }), "tradier");
    const od = j?.order ?? {};
    const st = od.status === "filled" ? "filled" : od.status === "partially_filled" ? "partially_filled" : od.status === "canceled" ? "cancelled" : od.status === "rejected" ? "rejected" : od.status === "expired" ? "expired" : "submitted";
    const filled = Number(od.exec_quantity ?? 0), avg = od.avg_fill_price ? Number(od.avg_fill_price) : null;
    return { status: st, filledQty: filled, avgPrice: avg, fills: filled && avg ? [{ quantity: filled, price: avg, feeUsd: 0, fillId: `${od.id}:${filled}` }] : [] };
  },
};

/* ───────────── SnapTrade (user's own connected brokerage) ───────────── */
async function snaptrade(ctx: ProviderContext) {
  const clientId = await ctx.cred("SNAPTRADE_CLIENT_ID"), consumerKey = await ctx.cred("SNAPTRADE_CONSUMER_KEY");
  if (!clientId || !consumerKey) throw new ProviderError("snaptrade", 0, "Missing SnapTrade credentials");
  const { Snaptrade, SnaptradeAuth } = await import("snaptrade-typescript-sdk");
  return new Snaptrade({ auth: SnaptradeAuth.commercialApiKey({ clientId, consumerKey }) });
}
export { snaptrade as snaptradeClient };
export const snaptradeAdapter: ExecutionAdapter = {
  id: "snaptrade",
  supports: (a) => ["stock", "etf"].includes(a.asset_class),
  async quote(_ctx, r) {
    const quantity = r.quantity ?? (r.notionalUsd ?? 0) / r.refPrice;
    return { providerId: "snaptrade", price: r.refPrice, quantity, notionalUsd: quantity * r.refPrice, feeUsd: 0, slippageBps: 10,
      route: "Connected brokerage via SnapTrade (broker fees may apply)", quotedAt: nowIso(), simulated: false };
  },
  async submit(ctx, o, asset, account) {
    const st = await snaptrade(ctx);
    const m = account.metadata ?? {};
    if (!m.snaptrade_user_id || !m.snaptrade_user_secret_enc || !account.external_ref) throw new ProviderError("snaptrade", 0, "Brokerage connection incomplete");
    const { decrypt } = await import("../crypto");
    const userSecret = decrypt(m.snaptrade_user_secret_enc, `snaptrade:${m.snaptrade_user_id}`);
    const r = await st.trading.placeForceOrder({
      userId: m.snaptrade_user_id, userSecret, account_id: account.external_ref, action: o.side === "buy" ? "BUY" : "SELL",
      symbol: asset.symbol, order_type: o.order_type === "market" ? "Market" : o.order_type === "limit" ? "Limit" : o.order_type === "stop" ? "Stop" : "StopLimit",
      time_in_force: o.time_in_force === "gtc" ? "GTC" : "Day", units: o.quantity ?? undefined, notional_value: o.quantity ? undefined : (o.notional_usd ?? undefined),
      price: o.limit_price ?? undefined, stop: o.stop_price ?? undefined,
    } as any);
    return { status: "submitted", providerOrderId: String((r.data as any)?.brokerage_order_id ?? (r.data as any)?.id ?? o.id) };
  },
};

/* ───────────── Jupiter Swap v2 (Solana) ───────────── */
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const jupiterAdapter: ExecutionAdapter = {
  id: "jupiter",
  supports: (a) => a.asset_class === "crypto" && a.venue === "solana" && a.identifier !== USDC_SOL,
  async quote(ctx, r) {
    const key = await ctx.cred("JUPITER_API_KEY");
    if (!key) throw new ProviderError("jupiter", 0, "JUPITER_API_KEY required for Swap v2 quotes");
    const dec = r.asset.decimals ?? 6;
    const [inputMint, outputMint, amount] = r.side === "buy"
      ? [USDC_SOL, r.asset.identifier, Math.round((r.notionalUsd ?? qtyFor(r) * r.refPrice) * 1e6)]
      : [r.asset.identifier, USDC_SOL, Math.round(qtyFor(r) * 10 ** dec)];
    const taker = r.account.external_ref ? `&taker=${r.account.external_ref}` : "";
    const j = await readJson(await ctx.fetch(`https://api.jup.ag/swap/v2/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${r.slippageBps}${taker}`,
      { headers: { "x-api-key": key } }), "jupiter");
    const inAmt = Number(j.inAmount), outAmt = Number(j.outAmount);
    const quantity = r.side === "buy" ? outAmt / 10 ** dec : inAmt / 10 ** dec;
    const usd = r.side === "buy" ? inAmt / 1e6 : outAmt / 1e6;
    return { providerId: "jupiter", price: usd / quantity, quantity, notionalUsd: usd, feeUsd: Number(j.feeBps ?? 0) * usd / 10_000,
      slippageBps: Number(j.slippageBps ?? r.slippageBps), priceImpactBps: Math.round(Number(j.priceImpactPct ?? 0) * 100),
      route: (j.routePlan ?? []).map((p: any) => p.swapInfo?.label).filter(Boolean).join(" → ") || "Jupiter", quoteId: j.requestId,
      quotedAt: nowIso(), expiresAt: new Date(Date.now() + 20_000).toISOString(), raw: { requestId: j.requestId, transaction: j.transaction ?? null }, simulated: false };
  },
  async submit(_ctx, o) {
    const tx = o.quote?.raw?.transaction;
    if (!tx) throw new ProviderError("jupiter", 0, "Quote has no transaction — the trading account needs a Solana wallet address (taker)");
    return { status: "awaiting_signature", providerOrderId: o.quote.quoteId, unsignedTx: tx, signingNetwork: "solana",
      instructions: "Sign the base64 VersionedTransaction with the connected Solana wallet, then POST the signed transaction back." };
  },
  async submitSigned(ctx, o, signed) {
    const key = await ctx.cred("JUPITER_API_KEY");
    const j = await readJson(await ctx.fetch("https://api.jup.ag/swap/v2/execute", { method: "POST",
      headers: { "x-api-key": key ?? "", "content-type": "application/json" },
      body: JSON.stringify({ signedTransaction: signed.signedTransaction, requestId: o.quote.quoteId }) }), "jupiter");
    if (j.status !== "Success") throw new ProviderError("jupiter", 0, `Execution failed: ${j.error ?? j.status}`);
    return { status: "filled", providerOrderId: j.signature, fills: [{ quantity: o.quote.quantity, price: o.quote.price, feeUsd: o.quote.feeUsd, fillId: j.signature, txHash: j.signature }] };
  },
};

/* ───────────── Pump.fun bonding curve lifecycle detection ───────────── */
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const BONDING_DISC = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);

/**
 * Reads the bonding-curve account (PDA seeds ["bonding-curve", mint]) and decodes `complete`.
 * PDA derivation needs ed25519 off-curve checks, so the address is derived with @solana/web3.js when installed,
 * or the caller supplies it (DEX Screener pair data also reveals pumpfun vs pumpswap).
 */
export async function detectPumpLifecycle(ctx: ProviderContext, mint: string): Promise<{ lifecycle: "bonding_curve" | "graduated" | "unknown"; reserves?: { virtualToken: bigint; virtualQuote: bigint }; source: string }> {
  let pda: string | null = null;
  try {
    const web3: any = await import(/* webpackIgnore: true */ "@solana/web3.js" as string);
    const [key] = web3.PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new web3.PublicKey(mint).toBuffer()], new web3.PublicKey(PUMP_PROGRAM));
    pda = key.toBase58();
  } catch { /* SDK not installed */ }
  if (!pda) return { lifecycle: "unknown", source: "Install @solana/web3.js to derive the bonding-curve PDA" };
  const rpc = (await ctx.setting("rpc_url")) ?? (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : process.env.SOLANA_RPC_URL);
  if (!rpc) return { lifecycle: "unknown", source: "No Solana RPC configured" };
  const j = await readJson(await ctx.fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [pda, { encoding: "base64" }] }) }), "pumpfun");
  const data = j?.result?.value?.data?.[0];
  if (!data) return { lifecycle: "graduated", source: "No bonding curve account (not a pump.fun token or migrated)" };
  const buf = Buffer.from(data, "base64");
  if (!buf.subarray(0, 8).equals(BONDING_DISC)) return { lifecycle: "unknown", source: "Unexpected account discriminator" };
  const virtualToken = buf.readBigUInt64LE(8), virtualQuote = buf.readBigUInt64LE(16);
  const complete = buf.length > 48 ? buf[48] === 1 : false;
  return { lifecycle: complete ? "graduated" : "bonding_curve", reserves: { virtualToken, virtualQuote }, source: "pump bonding-curve account" };
}

export const pumpfunAdapter: ExecutionAdapter = {
  id: "pumpfun",
  supports: (a) => a.asset_class === "crypto" && a.venue === "solana" && a.lifecycle === "bonding_curve",
  async quote(ctx, r) {
    const lc = await detectPumpLifecycle(ctx, r.asset.identifier);
    if (lc.lifecycle !== "bonding_curve" || !lc.reserves) throw new ProviderError("pumpfun", 0, `Not on bonding curve (${lc.source}) — route via PumpSwap/Jupiter`);
    // constant-product on virtual reserves; fee is an ESTIMATE (pump.fun fees are dynamic — confirm in SDK before signing)
    const vT = Number(lc.reserves.virtualToken), vQ = Number(lc.reserves.virtualQuote);
    const tokenPriceSol = vQ / vT / 1e3; // lamports per base unit adjusted for 6 vs 9 decimals
    return { providerId: "pumpfun", price: r.refPrice, quantity: qtyFor(r), notionalUsd: qtyFor(r) * r.refPrice, feeUsd: qtyFor(r) * r.refPrice * 0.0125,
      slippageBps: r.slippageBps, route: `Pump.fun bonding curve (≈${tokenPriceSol.toExponential(3)} SOL/token, fee estimated)`, quotedAt: nowIso(), simulated: false };
  },
  async submit() {
    throw new ProviderError("pumpfun", 0, "Bonding-curve buy/sell instruction building requires @pump-fun/pump-sdk (see Integration Center → SDK requirements)");
  },
};

/* ───────────── 0x (EVM) ───────────── */
const EVM: Record<string, { chainId: number; usdc: string; usdcDec: number }> = {
  ethereum: { chainId: 1, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", usdcDec: 6 },
  base: { chainId: 8453, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", usdcDec: 6 },
  polygon: { chainId: 137, usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", usdcDec: 6 },
  arbitrum: { chainId: 42161, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", usdcDec: 6 },
  avalanche: { chainId: 43114, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", usdcDec: 6 },
  bsc: { chainId: 56, usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", usdcDec: 18 },
};
const NATIVE_EVM = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const zeroxAdapter: ExecutionAdapter = {
  id: "zerox",
  supports: (a) => a.asset_class === "crypto" && !!EVM[a.venue],
  async quote(ctx, r) {
    const key = await ctx.cred("ZEROX_API_KEY");
    if (!key) throw new ProviderError("zerox", 0, "Missing ZEROX_API_KEY");
    const c = EVM[r.asset.venue], token = r.asset.identifier === "native" ? NATIVE_EVM : r.asset.identifier, dec = r.asset.decimals ?? 18;
    const [sellToken, buyToken, sellAmount] = r.side === "buy"
      ? [c.usdc, token, BigInt(Math.round((r.notionalUsd ?? qtyFor(r) * r.refPrice) * 10 ** Math.min(c.usdcDec, 6))) * 10n ** BigInt(c.usdcDec - Math.min(c.usdcDec, 6))]
      : [token, c.usdc, BigInt(Math.round(qtyFor(r) * 1e6)) * 10n ** BigInt(Math.max(dec - 6, 0))];
    const taker = r.account.external_ref;
    const path = taker ? "quote" : "price";
    const j = await readJson(await ctx.fetch(`https://api.0x.org/swap/allowance-holder/${path}?chainId=${c.chainId}&sellToken=${sellToken}&buyToken=${buyToken}&sellAmount=${sellAmount}&slippageBps=${r.slippageBps}${taker ? `&taker=${taker}` : ""}`,
      { headers: { "0x-api-key": key, "0x-version": "v2" } }), "zerox");
    if (j.liquidityAvailable === false) throw new ProviderError("zerox", 0, "No liquidity available for this pair");
    const buyAmt = Number(j.buyAmount), sellAmt = Number(sellAmount);
    const quantity = r.side === "buy" ? buyAmt / 10 ** dec : sellAmt / 10 ** dec;
    const usd = r.side === "buy" ? sellAmt / 10 ** c.usdcDec : buyAmt / 10 ** c.usdcDec;
    return { providerId: "zerox", price: usd / quantity, quantity, notionalUsd: usd, feeUsd: 0, slippageBps: r.slippageBps,
      route: (j.route?.fills ?? []).map((f: any) => f.source).join(" + ") || "0x", quotedAt: nowIso(), expiresAt: new Date(Date.now() + 30_000).toISOString(),
      raw: { transaction: j.transaction ?? null, issues: j.issues ?? null, chainId: c.chainId }, simulated: false };
  },
  async submit(_ctx, o) {
    if (!o.quote?.raw?.transaction) throw new ProviderError("zerox", 0, "Firm quote requires the wallet address (taker) on the trading account");
    return { status: "awaiting_signature", providerOrderId: `0x-${o.id}`, unsignedTx: o.quote.raw.transaction, signingNetwork: `eip155:${o.quote.raw.chainId}`,
      instructions: "Approve the AllowanceHolder spender if quote.issues.allowance is set, then send the transaction from the connected wallet and POST the tx hash." };
  },
  async submitSigned(_ctx, o, signed) {
    if (!signed.txHash) throw new ProviderError("zerox", 0, "txHash required");
    return { status: "submitted", providerOrderId: signed.txHash };
  },
};

/* ───────────── SwapKit (native cross-chain) ───────────── */
const SWAPKIT_ASSET: Record<string, string> = { bitcoin: "BTC.BTC", dogecoin: "DOGE.DOGE", litecoin: "LTC.LTC", xrp: "XRP.XRP", ethereum: "ETH.ETH", bsc: "BSC.BNB" };
export const swapkitAdapter: ExecutionAdapter = {
  id: "swapkit",
  supports: (a) => a.asset_class === "crypto" && a.identifier === "native" && !!SWAPKIT_ASSET[a.venue],
  async quote(ctx, r) {
    const key = await ctx.cred("SWAPKIT_API_KEY");
    if (!key) throw new ProviderError("swapkit", 0, "Missing SWAPKIT_API_KEY");
    const usdc = "ETH.USDC-0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", asset = SWAPKIT_ASSET[r.asset.venue];
    const body = r.side === "buy"
      ? { sellAsset: usdc, buyAsset: asset, sellAmount: String((r.notionalUsd ?? qtyFor(r) * r.refPrice).toFixed(2)), slippage: r.slippageBps / 100 }
      : { sellAsset: asset, buyAsset: usdc, sellAmount: String(qtyFor(r)), slippage: r.slippageBps / 100 };
    const j = await readJson(await ctx.fetch("https://api.swapkit.dev/quote", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) }), "swapkit");
    const best = j?.routes?.[0];
    if (!best) throw new ProviderError("swapkit", 0, "No cross-chain route");
    const out = Number(best.expectedBuyAmount);
    const quantity = r.side === "buy" ? out : qtyFor(r), usd = r.side === "buy" ? Number(body.sellAmount) : out;
    const fees = (best.fees ?? []).reduce((s: number, f: any) => s + Number(f.amountUSD ?? 0), 0);
    return { providerId: "swapkit", price: usd / quantity, quantity, notionalUsd: usd, feeUsd: fees, slippageBps: r.slippageBps,
      route: (best.providers ?? []).join(" → "), quoteId: best.routeId, quotedAt: nowIso(), expiresAt: best.expiration ?? undefined, raw: { routeId: best.routeId }, simulated: false };
  },
  async submit() {
    throw new ProviderError("swapkit", 0, "Cross-chain execution requires per-chain wallet support (deposit address flow) — not enabled");
  },
};

/* ───────────── Cetus (Sui) & Panora (Aptos): quotes; signing via chain wallet adapters ───────────── */
export const cetusAdapter: ExecutionAdapter = {
  id: "cetus",
  supports: (a) => a.asset_class === "crypto" && a.venue === "sui",
  async quote(ctx, r) {
    const url = (await ctx.setting("api_url")) ?? "https://api-sui.cetus.zone/router_v3/find_routes";
    const usdc = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC", dec = r.asset.decimals ?? 9;
    const [from, target, amount] = r.side === "buy" ? [usdc, r.asset.identifier, Math.round((r.notionalUsd ?? qtyFor(r) * r.refPrice) * 1e6)] : [r.asset.identifier, usdc, Math.round(qtyFor(r) * 10 ** dec)];
    const j = await readJson(await ctx.fetch(`${url}?from=${encodeURIComponent(from)}&target=${encodeURIComponent(target)}&amount=${amount}&by_amount_in=true`), "cetus");
    const d = j?.data ?? j;
    const outAmt = Number(d?.amount_out ?? 0);
    if (!outAmt) throw new ProviderError("cetus", 0, "No route");
    const quantity = r.side === "buy" ? outAmt / 10 ** dec : amount / 10 ** dec, usd = r.side === "buy" ? amount / 1e6 : outAmt / 1e6;
    return { providerId: "cetus", price: usd / quantity, quantity, notionalUsd: usd, feeUsd: 0, slippageBps: r.slippageBps, route: "Cetus aggregator", quotedAt: nowIso(), raw: d, simulated: false };
  },
  async submit() { throw new ProviderError("cetus", 0, "Sui transaction building requires @cetusprotocol/aggregator-sdk + a Sui wallet adapter"); },
};
export const panoraAdapter: ExecutionAdapter = {
  id: "panora",
  supports: (a) => a.asset_class === "crypto" && a.venue === "aptos",
  async quote(ctx, r) {
    const key = await ctx.cred("PANORA_API_KEY");
    if (!key) throw new ProviderError("panora", 0, "Missing PANORA_API_KEY");
    const usdc = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
    const apt = r.asset.identifier === "0x1::aptos_coin::AptosCoin" ? "0xa" : r.asset.identifier;
    const qs = r.side === "buy" ? `fromTokenAddress=${usdc}&toTokenAddress=${apt}&fromTokenAmount=${(r.notionalUsd ?? qtyFor(r) * r.refPrice).toFixed(2)}`
      : `fromTokenAddress=${apt}&toTokenAddress=${usdc}&fromTokenAmount=${qtyFor(r)}`;
    const j = await readJson(await ctx.fetch(`https://api.panora.exchange/swap/quote?${qs}`, { headers: { "x-api-key": key } }), "panora");
    const out = Number(j?.quotes?.[0]?.toTokenAmount ?? j?.toTokenAmount ?? 0);
    if (!out) throw new ProviderError("panora", 0, "No route");
    const quantity = r.side === "buy" ? out : qtyFor(r), usd = r.side === "buy" ? (r.notionalUsd ?? qtyFor(r) * r.refPrice) : out;
    return { providerId: "panora", price: usd / quantity, quantity, notionalUsd: usd, feeUsd: 0, slippageBps: r.slippageBps, route: "Panora", quotedAt: nowIso(), simulated: false };
  },
  async submit() { throw new ProviderError("panora", 0, "Aptos signing requires @aptos-labs/ts-sdk + Aptos wallet adapter"); },
};

export const EXECUTION_ADAPTERS: ExecutionAdapter[] = [
  alpacaTradingAdapter, snaptradeAdapter, tradierAdapter, pumpfunAdapter, jupiterAdapter, zeroxAdapter, swapkitAdapter, cetusAdapter, panoraAdapter,
  ...EXCHANGE_ADAPTERS,
];
export const adapterById = (id: string) => (id === "paper" ? paperAdapter : EXECUTION_ADAPTERS.find((a) => a.id === id));
/** Accounts created from a user's own pasted keys ONLY ever use that user's keys. */
export const adapterContext = (id: string, env: ProviderEnv, account?: { user_id?: string; metadata?: any } | null) =>
  account?.metadata?.byo_keys && account.user_id ? contextFor(id, env, { userId: account.user_id, userOnly: true }) : contextFor(id, env);
