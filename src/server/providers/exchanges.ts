import "@/lib/server-only-shim";
import { createHmac, createHash, randomBytes, randomUUID, sign as cryptoSign, createPrivateKey } from "node:crypto";
import { readJson, ProviderError } from "./http";
import type { ExecutionQuote, ProviderContext } from "./types";
import type { AssetRow } from "../market/prices";
import type { ExecutionAdapter, OrderLike, StatusResult, SubmitResult } from "./execution";

/**
 * Centralized crypto exchanges, trading the USER'S OWN account with the keys they pasted on Broker Keys.
 * Every call below is a documented REST endpoint of that exchange (public ticker / symbol rules for quotes,
 * signed order endpoints for submit / status / cancel). Supported order types: market and limit.
 * Quantities are rounded DOWN to each exchange's lot step, so an order never exceeds what was quoted.
 */

export const EXCHANGE_IDS = new Set(["coinbase_advanced", "kraken", "gemini", "bitstamp", "cryptocom", "binance_us", "okx_us"]);
const STABLES = new Set(["USD", "USDC", "USDT", "DAI", "PYUSD"]);
/** Typical taker fees used for the pre-trade estimate; the exchange's actual fee is recorded from the fill when reported. */
const TAKER_BPS: Record<string, number> = { coinbase_advanced: 60, kraken: 40, gemini: 40, bitstamp: 40, cryptocom: 50, binance_us: 60, okx_us: 10 };

const exSupports = (a: AssetRow) => a.asset_class === "crypto" && a.lifecycle !== "bonding_curve" && /^[A-Z0-9]{2,12}$/.test(a.symbol) && !STABLES.has(a.symbol);
const nowIso = () => new Date().toISOString();
const decimals = (step: string | number) => { const s = String(step); if (s.includes("e-")) return Number(s.split("e-")[1]); const d = s.split(".")[1]; return d ? d.replace(/0+$/, "").length : 0; };
/** Round down to a step size and render without float noise. */
const floorStep = (x: number, step: string | number) => { const st = Number(step); if (!(st > 0)) return String(x); const d = decimals(step); return (Math.floor(x / st + 1e-9) * st).toFixed(d); };
const hmacHex = (alg: string, key: string | Buffer, msg: string) => createHmac(alg, key).update(msg).digest("hex");
async function creds(ctx: ProviderContext, pid: string, ...names: string[]) {
  const out: Record<string, string> = {};
  for (const n of names) { const v = await ctx.cred(n); if (!v) throw new ProviderError(pid, 0, `Missing ${n}. Paste your keys on the Broker Keys page.`); out[n] = v; }
  return out;
}
function unsupportedType(pid: string, o: OrderLike) {
  if (!["market", "limit"].includes(o.order_type)) throw new ProviderError(pid, 0, `${o.order_type} orders aren't supported on this exchange from Merod yet. Use market or limit.`);
}
function mkQuote(pid: string, side: "buy" | "sell", bid: number, ask: number, last: number, qty: number, raw: Record<string, unknown>, route: string): ExecutionQuote {
  const price = (side === "buy" ? ask : bid) || last;
  if (!(price > 0)) throw new ProviderError(pid, 0, "Exchange returned no price for this market");
  if (!(qty > 0)) throw new ProviderError(pid, 0, "Order is smaller than this exchange's minimum size");
  const mid = bid && ask ? (bid + ask) / 2 : price;
  const n = qty * price;
  return { providerId: pid, price, quantity: qty, notionalUsd: n, feeUsd: (n * (TAKER_BPS[pid] ?? 50)) / 10_000, slippageBps: Math.max(1, Math.round((Math.abs(price - mid) / mid) * 10_000)),
    route, quotedAt: nowIso(), expiresAt: new Date(Date.now() + 20_000).toISOString(), raw, simulated: false };
}
const wantQty = (r: { quantity?: number; notionalUsd?: number }, price: number) => r.quantity ?? (r.notionalUsd ?? 0) / price;
const raw = (o: OrderLike) => ((o.quote as ExecutionQuote | null)?.raw ?? {}) as Record<string, any>;
const orderQty = (o: OrderLike) => { const q = Number(o.quantity ?? (o.quote as ExecutionQuote | null)?.quantity ?? 0); return floorStep(q, raw(o).step ?? "0.00000001"); };
/** Market orders that may sweep the book are protected by the order's slippage limit where the exchange needs a price. */
const protectPx = (o: OrderLike, ref: number) => ref * (1 + ((o.side === "buy" ? 1 : -1) * (o.max_slippage_bps ?? 100)) / 10_000);

/* ───────────────────────── Kraken ───────────────────────── */
const krakenBase = (s: string) => (s === "BTC" ? "XBT" : s === "DOGE" ? "XDG" : s);
export async function krakenPrivate(ctx: ProviderContext, path: string, params: Record<string, string>) {
  const { KRAKEN_API_KEY, KRAKEN_API_SECRET } = await creds(ctx, "kraken", "KRAKEN_API_KEY", "KRAKEN_API_SECRET");
  const nonce = `${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
  const body = new URLSearchParams({ nonce, ...params }).toString();
  const sig = createHmac("sha512", Buffer.from(KRAKEN_API_SECRET, "base64")).update(Buffer.concat([Buffer.from(path), createHash("sha256").update(nonce + body).digest()])).digest("base64");
  const j = await readJson(await ctx.fetch(`https://api.kraken.com${path}`, { method: "POST", body, headers: { "API-Key": KRAKEN_API_KEY, "API-Sign": sig, "Content-Type": "application/x-www-form-urlencoded" } }), "kraken");
  if (j?.error?.length) throw new ProviderError("kraken", 400, `Kraken: ${j.error.join(", ")}`);
  return j.result;
}
export const krakenAdapter: ExecutionAdapter = {
  id: "kraken", supports: exSupports,
  async quote(ctx, r) {
    const pair = `${krakenBase(r.asset.symbol)}USD`;
    const info = await readJson(await ctx.fetch(`https://api.kraken.com/0/public/AssetPairs?pair=${pair}`), "kraken");
    const [key, p] = Object.entries(info?.result ?? {})[0] ?? [];
    if (!p || info.error?.length) throw new ProviderError("kraken", 404, `Kraken has no ${r.asset.symbol}/USD market`);
    const t = Object.values((await readJson(await ctx.fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`), "kraken"))?.result ?? {})[0] as any;
    const step = (1 / 10 ** (p as any).lot_decimals).toFixed((p as any).lot_decimals);
    const price = Number(r.side === "buy" ? t?.a?.[0] : t?.b?.[0]);
    const qty = Number(floorStep(wantQty(r, price), step));
    if (qty < Number((p as any).ordermin ?? 0)) throw new ProviderError("kraken", 400, `Kraken's minimum for ${r.asset.symbol} is ${(p as any).ordermin}`);
    return mkQuote("kraken", r.side, Number(t?.b?.[0]), Number(t?.a?.[0]), Number(t?.c?.[0]), qty, { pair: (p as any).altname ?? key, step, pxDecimals: (p as any).pair_decimals }, `Kraken ${(p as any).altname ?? pair} (your account)`);
  },
  async submit(ctx, o) {
    unsupportedType("kraken", o);
    const rw = raw(o);
    const params: Record<string, string> = { pair: rw.pair, type: o.side, ordertype: o.order_type, volume: orderQty(o), userref: String(parseInt(o.id.replace(/-/g, "").slice(0, 7), 16)) };
    if (o.order_type === "limit") params.price = Number(o.limit_price).toFixed(rw.pxDecimals ?? 2);
    const res = await krakenPrivate(ctx, "/0/private/AddOrder", params);
    return { status: "submitted", providerOrderId: res.txid?.[0] };
  },
  async status(ctx, o) {
    const res = await krakenPrivate(ctx, "/0/private/QueryOrders", { txid: o.provider_order_id!, trades: "true" });
    const od = res?.[o.provider_order_id!] ?? {};
    const filled = Number(od.vol_exec ?? 0), avg = Number(od.price) || null;
    const st: StatusResult["status"] = od.status === "closed" ? "filled" : od.status === "canceled" ? (filled > 0 ? "filled" : "cancelled") : od.status === "expired" ? "expired" : filled > 0 ? "partially_filled" : "submitted";
    return { status: st, filledQty: filled, avgPrice: avg, fills: filled && avg ? [{ quantity: filled, price: avg, feeUsd: Number(od.fee ?? 0), fillId: `${o.provider_order_id}:${filled}` }] : [] };
  },
  async cancel(ctx, o) { await krakenPrivate(ctx, "/0/private/CancelOrder", { txid: o.provider_order_id! }); },
};

/* ───────────────────────── Binance.US ───────────────────────── */
async function binanceSigned(ctx: ProviderContext, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string>) {
  const { BINANCEUS_API_KEY, BINANCEUS_API_SECRET } = await creds(ctx, "binance_us", "BINANCEUS_API_KEY", "BINANCEUS_API_SECRET");
  const qs = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: "10000" }).toString();
  return readJson(await ctx.fetch(`https://api.binance.us${path}?${qs}&signature=${hmacHex("sha256", BINANCEUS_API_SECRET, qs)}`, { method, headers: { "X-MBX-APIKEY": BINANCEUS_API_KEY } }), "binance_us");
}
const binanceStatus = (j: any): StatusResult => {
  const filled = Number(j.executedQty ?? 0), quote = Number(j.cummulativeQuoteQty ?? 0), avg = filled ? quote / filled : null;
  const st: StatusResult["status"] = j.status === "FILLED" ? "filled" : j.status === "PARTIALLY_FILLED" ? "partially_filled" : j.status === "CANCELED" ? (filled ? "filled" : "cancelled") : j.status === "REJECTED" ? "rejected" : j.status === "EXPIRED" ? (filled ? "filled" : "expired") : "submitted";
  const fills = Array.isArray(j.fills) && j.fills.length
    ? j.fills.map((f: any) => ({ quantity: Number(f.qty), price: Number(f.price), feeUsd: STABLES.has(f.commissionAsset) ? Number(f.commission) : Number(f.commission) * Number(f.price), fillId: `bus-${f.tradeId}` }))
    : filled && avg ? [{ quantity: filled, price: avg, feeUsd: 0, fillId: `bus-${j.orderId}:${filled}` }] : [];
  return { status: st, filledQty: filled, avgPrice: avg, fills };
};
export const binanceUsAdapter: ExecutionAdapter = {
  id: "binance_us", supports: exSupports,
  async quote(ctx, r) {
    let sym = "", info: any = null;
    for (const quote of ["USD", "USDT"]) {
      try { info = await readJson(await ctx.fetch(`https://api.binance.us/api/v3/exchangeInfo?symbol=${r.asset.symbol}${quote}`), "binance_us"); sym = `${r.asset.symbol}${quote}`; break; } catch { /* try next quote currency */ }
    }
    const s = info?.symbols?.[0];
    if (!s || s.status !== "TRADING") throw new ProviderError("binance_us", 404, `Binance.US has no tradable ${r.asset.symbol} market`);
    const lot = s.filters.find((f: any) => f.filterType === "LOT_SIZE"), px = s.filters.find((f: any) => f.filterType === "PRICE_FILTER");
    const t = await readJson(await ctx.fetch(`https://api.binance.us/api/v3/ticker/bookTicker?symbol=${sym}`), "binance_us");
    const price = Number(r.side === "buy" ? t.askPrice : t.bidPrice);
    const qty = Number(floorStep(wantQty(r, price), lot.stepSize));
    if (qty < Number(lot.minQty)) throw new ProviderError("binance_us", 400, `Binance.US minimum for ${r.asset.symbol} is ${Number(lot.minQty)}`);
    return mkQuote("binance_us", r.side, Number(t.bidPrice), Number(t.askPrice), price, qty, { symbol: sym, step: lot.stepSize, tick: px?.tickSize }, `Binance.US ${sym} (your account)`);
  },
  async submit(ctx, o) {
    unsupportedType("binance_us", o);
    const rw = raw(o);
    const p: Record<string, string> = { symbol: rw.symbol, side: o.side.toUpperCase(), type: o.order_type.toUpperCase(), quantity: orderQty(o), newClientOrderId: o.id, newOrderRespType: "FULL" };
    if (o.order_type === "limit") { p.timeInForce = o.time_in_force === "ioc" ? "IOC" : "GTC"; p.price = floorStep(Number(o.limit_price), rw.tick ?? "0.01"); }
    const j = await binanceSigned(ctx, "POST", "/api/v3/order", p);
    const st = binanceStatus(j);
    const id = `${rw.symbol}:${j.orderId}`;
    return st.status === "filled" ? { status: "filled", providerOrderId: id, fills: st.fills } : { status: "submitted", providerOrderId: id };
  },
  async status(ctx, o) { const [symbol, orderId] = o.provider_order_id!.split(":"); return binanceStatus(await binanceSigned(ctx, "GET", "/api/v3/order", { symbol, orderId })); },
  async cancel(ctx, o) { const [symbol, orderId] = o.provider_order_id!.split(":"); await binanceSigned(ctx, "DELETE", "/api/v3/order", { symbol, orderId }); },
};

/* ───────────────────────── Coinbase Advanced Trade ───────────────────────── */
export async function coinbaseFetch(ctx: ProviderContext, method: "GET" | "POST", path: string, body?: unknown) {
  const { COINBASE_API_KEY_NAME: kid, COINBASE_API_PRIVATE_KEY: pem } = await creds(ctx, "coinbase_advanced", "COINBASE_API_KEY_NAME", "COINBASE_API_PRIVATE_KEY");
  const b64u = (x: object | Buffer) => Buffer.from(x instanceof Buffer ? x : JSON.stringify(x)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: "ES256", kid, nonce: randomBytes(16).toString("hex"), typ: "JWT" });
  const claims = b64u({ sub: kid, iss: "cdp", nbf: now, exp: now + 120, uri: `${method} api.coinbase.com${path.split("?")[0]}` });
  const sig = cryptoSign("sha256", Buffer.from(`${head}.${claims}`), { key: createPrivateKey(pem.replace(/\\n/g, "\n")), dsaEncoding: "ieee-p1363" });
  return readJson(await ctx.fetch(`https://api.coinbase.com${path}`, { method, headers: { Authorization: `Bearer ${head}.${claims}.${b64u(sig)}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), "coinbase_advanced");
}
export const coinbaseAdapter: ExecutionAdapter = {
  id: "coinbase_advanced", supports: exSupports,
  async quote(ctx, r) {
    const pid = `${r.asset.symbol}-USD`;
    const p = await coinbaseFetch(ctx, "GET", `/api/v3/brokerage/products/${pid}`).catch(() => null);
    if (!p?.product_id || p.trading_disabled) throw new ProviderError("coinbase_advanced", 404, `Coinbase has no tradable ${pid} market`);
    const bb = await coinbaseFetch(ctx, "GET", `/api/v3/brokerage/best_bid_ask?product_ids=${pid}`).catch(() => null);
    const book = bb?.pricebooks?.[0];
    const bid = Number(book?.bids?.[0]?.price ?? p.price), ask = Number(book?.asks?.[0]?.price ?? p.price);
    const price = r.side === "buy" ? ask : bid;
    const qty = Number(floorStep(wantQty(r, price), p.base_increment));
    if (qty < Number(p.base_min_size ?? 0)) throw new ProviderError("coinbase_advanced", 400, `Coinbase minimum for ${r.asset.symbol} is ${p.base_min_size}`);
    return mkQuote("coinbase_advanced", r.side, bid, ask, Number(p.price), qty, { product: pid, step: p.base_increment, tick: p.quote_increment }, `Coinbase ${pid} (your account)`);
  },
  async submit(ctx, o) {
    unsupportedType("coinbase_advanced", o);
    const rw = raw(o);
    const order_configuration = o.order_type === "market"
      ? { market_market_ioc: { base_size: orderQty(o) } }
      : { limit_limit_gtc: { base_size: orderQty(o), limit_price: floorStep(Number(o.limit_price), rw.tick ?? "0.01") } };
    const j = await coinbaseFetch(ctx, "POST", "/api/v3/brokerage/orders", { client_order_id: o.id, product_id: rw.product, side: o.side.toUpperCase(), order_configuration });
    if (!j?.success) throw new ProviderError("coinbase_advanced", 400, `Coinbase: ${j?.error_response?.message ?? j?.error_response?.error ?? "order rejected"}`);
    return { status: "submitted", providerOrderId: j.success_response?.order_id ?? j.order_id };
  },
  async status(ctx, o) {
    const od = (await coinbaseFetch(ctx, "GET", `/api/v3/brokerage/orders/historical/${o.provider_order_id}`))?.order ?? {};
    const filled = Number(od.filled_size ?? 0), avg = Number(od.average_filled_price) || null;
    const st: StatusResult["status"] = od.status === "FILLED" ? "filled" : od.status === "CANCELLED" ? (filled ? "filled" : "cancelled") : od.status === "EXPIRED" ? (filled ? "filled" : "expired") : od.status === "FAILED" ? "rejected" : filled ? "partially_filled" : "submitted";
    return { status: st, filledQty: filled, avgPrice: avg, fills: filled && avg ? [{ quantity: filled, price: avg, feeUsd: Number(od.total_fees ?? 0), fillId: `${o.provider_order_id}:${filled}` }] : [], reason: od.reject_message || undefined };
  },
  async cancel(ctx, o) { await coinbaseFetch(ctx, "POST", "/api/v3/brokerage/orders/batch_cancel", { order_ids: [o.provider_order_id] }); },
};

/* ───────────────────────── Gemini (no native market orders: IOC limit at the slippage limit) ───────────────────────── */
async function geminiPrivate(ctx: ProviderContext, path: string, extra: Record<string, unknown>) {
  const { GEMINI_API_KEY, GEMINI_API_SECRET } = await creds(ctx, "gemini", "GEMINI_API_KEY", "GEMINI_API_SECRET");
  const host = ctx.env === "sandbox" ? "https://api.sandbox.gemini.com" : "https://api.gemini.com";
  const payload = Buffer.from(JSON.stringify({ request: path, nonce: Date.now(), ...extra })).toString("base64");
  return readJson(await ctx.fetch(`${host}${path}`, { method: "POST", headers: { "Content-Type": "text/plain", "Cache-Control": "no-cache", "X-GEMINI-APIKEY": GEMINI_API_KEY, "X-GEMINI-PAYLOAD": payload, "X-GEMINI-SIGNATURE": hmacHex("sha384", GEMINI_API_SECRET, payload) } }), "gemini");
}
const geminiStatus = (j: any): StatusResult => {
  const filled = Number(j.executed_amount ?? 0), avg = Number(j.avg_execution_price) || null;
  const st: StatusResult["status"] = j.is_live ? (filled ? "partially_filled" : "submitted") : filled ? "filled" : j.is_cancelled ? "cancelled" : "submitted";
  return { status: st, filledQty: filled, avgPrice: avg, fills: filled && avg ? [{ quantity: filled, price: avg, feeUsd: 0, fillId: `gem-${j.order_id}:${filled}` }] : [], reason: j.reason };
};
export const geminiAdapter: ExecutionAdapter = {
  id: "gemini", supports: exSupports,
  async quote(ctx, r) {
    const sym = `${r.asset.symbol.toLowerCase()}usd`, host = ctx.env === "sandbox" ? "https://api.sandbox.gemini.com" : "https://api.gemini.com";
    const d = await readJson(await ctx.fetch(`${host}/v1/symbols/details/${sym}`), "gemini").catch(() => null);
    if (!d?.symbol || d.status === "closed") throw new ProviderError("gemini", 404, `Gemini has no ${r.asset.symbol}/USD market`);
    const t = await readJson(await ctx.fetch(`${host}/v1/pubticker/${sym}`), "gemini");
    const price = Number(r.side === "buy" ? t.ask : t.bid);
    const qty = Number(floorStep(wantQty(r, price), d.tick_size));
    if (qty < Number(d.min_order_size ?? 0)) throw new ProviderError("gemini", 400, `Gemini minimum for ${r.asset.symbol} is ${d.min_order_size}`);
    return mkQuote("gemini", r.side, Number(t.bid), Number(t.ask), Number(t.last), qty, { symbol: sym, step: d.tick_size, tick: d.quote_increment, ref: price }, `Gemini ${sym.toUpperCase()} (your account)`);
  },
  async submit(ctx, o) {
    unsupportedType("gemini", o);
    const rw = raw(o);
    const px = o.order_type === "limit" ? Number(o.limit_price) : protectPx(o, Number(rw.ref ?? (o.quote as ExecutionQuote).price));
    const j = await geminiPrivate(ctx, "/v1/order/new", { client_order_id: o.id, symbol: rw.symbol, amount: orderQty(o), price: floorStep(px, rw.tick ?? "0.01"), side: o.side, type: "exchange limit", options: o.order_type === "market" ? ["immediate-or-cancel"] : [] });
    if (j?.result === "error") throw new ProviderError("gemini", 400, `Gemini: ${j.message ?? j.reason}`);
    const st = geminiStatus(j);
    if (o.order_type === "market" && !st.filledQty) throw new ProviderError("gemini", 400, "Gemini couldn't fill within your slippage limit; nothing was bought or sold");
    return st.status === "filled" ? { status: "filled", providerOrderId: String(j.order_id), fills: st.fills } : { status: "submitted", providerOrderId: String(j.order_id) };
  },
  async status(ctx, o) { return geminiStatus(await geminiPrivate(ctx, "/v1/order/status", { order_id: Number(o.provider_order_id) })); },
  async cancel(ctx, o) { await geminiPrivate(ctx, "/v1/order/cancel", { order_id: Number(o.provider_order_id) }); },
};

/* ───────────────────────── Bitstamp ───────────────────────── */
async function bitstampPrivate(ctx: ProviderContext, path: string, form: Record<string, string>) {
  const { BITSTAMP_API_KEY, BITSTAMP_API_SECRET } = await creds(ctx, "bitstamp", "BITSTAMP_API_KEY", "BITSTAMP_API_SECRET");
  const host = "www.bitstamp.net", nonce = randomUUID(), ts = Date.now().toString();
  const body = new URLSearchParams(form).toString(), ct = body ? "application/x-www-form-urlencoded" : "";
  const msg = `BITSTAMP ${BITSTAMP_API_KEY}POST${host}${path}${ct}${nonce}${ts}v2${body}`;
  const headers: Record<string, string> = { "X-Auth": `BITSTAMP ${BITSTAMP_API_KEY}`, "X-Auth-Signature": hmacHex("sha256", BITSTAMP_API_SECRET, msg).toUpperCase(), "X-Auth-Nonce": nonce, "X-Auth-Timestamp": ts, "X-Auth-Version": "v2" };
  if (ct) headers["Content-Type"] = ct;
  const j = await readJson(await ctx.fetch(`https://${host}${path}`, { method: "POST", headers, body: body || undefined }), "bitstamp");
  if (j?.status === "error") throw new ProviderError("bitstamp", 400, `Bitstamp: ${typeof j.reason === "string" ? j.reason : JSON.stringify(j.reason)}`);
  return j;
}
export const bitstampAdapter: ExecutionAdapter = {
  id: "bitstamp", supports: exSupports,
  async quote(ctx, r) {
    const pair = `${r.asset.symbol.toLowerCase()}usd`;
    const pairs = await readJson(await ctx.fetch("https://www.bitstamp.net/api/v2/trading-pairs-info/"), "bitstamp");
    const p = (pairs as any[]).find((x) => x.url_symbol === pair && x.trading === "Enabled");
    if (!p) throw new ProviderError("bitstamp", 404, `Bitstamp has no ${r.asset.symbol}/USD market`);
    const t = await readJson(await ctx.fetch(`https://www.bitstamp.net/api/v2/ticker/${pair}/`), "bitstamp");
    const step = (1 / 10 ** p.base_decimals).toFixed(p.base_decimals), price = Number(r.side === "buy" ? t.ask : t.bid);
    const qty = Number(floorStep(wantQty(r, price), step));
    return mkQuote("bitstamp", r.side, Number(t.bid), Number(t.ask), Number(t.last), qty, { pair, step, pxDecimals: p.counter_decimals }, `Bitstamp ${pair.toUpperCase()} (your account)`);
  },
  async submit(ctx, o) {
    unsupportedType("bitstamp", o);
    const rw = raw(o);
    const path = o.order_type === "market" ? `/api/v2/${o.side}/market/${rw.pair}/` : `/api/v2/${o.side}/${rw.pair}/`;
    const form: Record<string, string> = { amount: orderQty(o), client_order_id: o.id };
    if (o.order_type === "limit") form.price = Number(o.limit_price).toFixed(rw.pxDecimals ?? 2);
    const j = await bitstampPrivate(ctx, path, form);
    return { status: "submitted", providerOrderId: String(j.id) };
  },
  async status(ctx, o) {
    const j = await bitstampPrivate(ctx, "/api/v2/order_status/", { id: o.provider_order_id! });
    const tx: any[] = j.transactions ?? [];
    const base = Object.keys(tx[0] ?? {}).find((k) => !["tid", "price", "fee", "datetime", "type", "usd"].includes(k));
    const fills = tx.map((t) => ({ quantity: Number(base ? t[base] : 0), price: Number(t.price), feeUsd: Number(t.fee ?? 0), fillId: `bst-${t.tid}` })).filter((f) => f.quantity > 0);
    const filled = fills.reduce((s, f) => s + f.quantity, 0), avg = filled ? fills.reduce((s, f) => s + f.quantity * f.price, 0) / filled : null;
    const st: StatusResult["status"] = j.status === "Finished" ? "filled" : j.status === "Canceled" ? (filled ? "filled" : "cancelled") : filled ? "partially_filled" : "submitted";
    return { status: st, filledQty: filled, avgPrice: avg, fills };
  },
  async cancel(ctx, o) { await bitstampPrivate(ctx, "/api/v2/cancel_order/", { id: o.provider_order_id! }); },
};

/* ───────────────────────── Crypto.com Exchange ───────────────────────── */
const cdcParamString = (p: unknown): string => {
  if (p == null) return "";
  if (Array.isArray(p)) return p.map(cdcParamString).join("");
  if (typeof p === "object") return Object.keys(p as object).sort().map((k) => k + cdcParamString((p as any)[k])).join("");
  return String(p);
};
async function cdcPrivate(ctx: ProviderContext, method: string, params: Record<string, unknown>) {
  const { CRYPTOCOM_API_KEY: key, CRYPTOCOM_API_SECRET: secret } = await creds(ctx, "cryptocom", "CRYPTOCOM_API_KEY", "CRYPTOCOM_API_SECRET");
  const id = Date.now(), nonce = Date.now();
  const sig = hmacHex("sha256", secret, `${method}${id}${key}${cdcParamString(params)}${nonce}`);
  const j = await readJson(await ctx.fetch(`https://api.crypto.com/exchange/v1/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, method, api_key: key, params, nonce, sig }) }), "cryptocom");
  if (j?.code !== 0) throw new ProviderError("cryptocom", 400, `Crypto.com: ${j?.message ?? j?.code}`);
  return j.result;
}
export const cryptocomAdapter: ExecutionAdapter = {
  id: "cryptocom", supports: exSupports,
  async quote(ctx, r) {
    const all = (await readJson(await ctx.fetch("https://api.crypto.com/exchange/v1/public/get-instruments"), "cryptocom"))?.result?.data ?? [];
    const inst = ["USD", "USDT"].map((qc) => all.find((i: any) => i.symbol === `${r.asset.symbol}_${qc}` && i.inst_type === "CCY_PAIR" && i.tradable !== false)).find(Boolean);
    if (!inst) throw new ProviderError("cryptocom", 404, `Crypto.com has no ${r.asset.symbol} spot market`);
    const t = (await readJson(await ctx.fetch(`https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=${inst.symbol}`), "cryptocom"))?.result?.data?.[0] ?? {};
    const price = Number(r.side === "buy" ? t.k : t.b);
    const qty = Number(floorStep(wantQty(r, price), inst.qty_tick_size));
    return mkQuote("cryptocom", r.side, Number(t.b), Number(t.k), Number(t.a), qty, { inst: inst.symbol, step: inst.qty_tick_size, tick: inst.price_tick_size }, `Crypto.com ${inst.symbol} (your account)`);
  },
  async submit(ctx, o) {
    unsupportedType("cryptocom", o);
    const rw = raw(o);
    const params: Record<string, unknown> = { instrument_name: rw.inst, side: o.side.toUpperCase(), type: o.order_type.toUpperCase(), quantity: orderQty(o), client_oid: o.id };
    if (o.order_type === "limit") params.price = floorStep(Number(o.limit_price), rw.tick ?? "0.01");
    const res = await cdcPrivate(ctx, "private/create-order", params);
    return { status: "submitted", providerOrderId: String(res.order_id) };
  },
  async status(ctx, o) {
    const d = await cdcPrivate(ctx, "private/get-order-detail", { order_id: o.provider_order_id });
    const filled = Number(d.cumulative_quantity ?? 0), avg = Number(d.avg_price) || null;
    const st: StatusResult["status"] = d.status === "FILLED" ? "filled" : d.status === "CANCELED" ? (filled ? "filled" : "cancelled") : d.status === "REJECTED" ? "rejected" : d.status === "EXPIRED" ? (filled ? "filled" : "expired") : filled ? "partially_filled" : "submitted";
    return { status: st, filledQty: filled, avgPrice: avg, fills: filled && avg ? [{ quantity: filled, price: avg, feeUsd: Math.abs(Number(d.cumulative_fee ?? 0)), fillId: `cdc-${o.provider_order_id}:${filled}` }] : [], reason: d.reason ? String(d.reason) : undefined };
  },
  async cancel(ctx, o) { await cdcPrivate(ctx, "private/cancel-order", { order_id: o.provider_order_id }); },
};

/* ───────────────────────── OKX (v5) ───────────────────────── */
async function okxFetch(ctx: ProviderContext, method: "GET" | "POST", path: string, body?: unknown) {
  const { OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE } = await creds(ctx, "okx_us", "OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE");
  const base = (await ctx.setting("base_url")) ?? "https://www.okx.com", ts = new Date().toISOString(), b = body ? JSON.stringify(body) : "";
  const sign = createHmac("sha256", OKX_API_SECRET).update(`${ts}${method}${path}${b}`).digest("base64");
  const j = await readJson(await ctx.fetch(`${base}${path}`, { method, body: b || undefined, headers: { "OK-ACCESS-KEY": OKX_API_KEY, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": OKX_API_PASSPHRASE, "Content-Type": "application/json" } }), "okx_us");
  if (j?.code !== "0") throw new ProviderError("okx_us", 400, `OKX: ${j?.data?.[0]?.sMsg || j?.msg || j?.code}`);
  return j.data;
}
export const okxAdapter: ExecutionAdapter = {
  id: "okx_us", supports: exSupports,
  async quote(ctx, r) {
    const base = (await ctx.setting("base_url")) ?? "https://www.okx.com";
    let inst: any = null;
    for (const qc of ["USD", "USDT"]) {
      inst = (await readJson(await ctx.fetch(`${base}/api/v5/public/instruments?instType=SPOT&instId=${r.asset.symbol}-${qc}`), "okx_us").catch(() => null))?.data?.[0];
      if (inst?.state === "live") break; inst = null;
    }
    if (!inst) throw new ProviderError("okx_us", 404, `OKX has no ${r.asset.symbol} spot market`);
    const t = (await readJson(await ctx.fetch(`${base}/api/v5/market/ticker?instId=${inst.instId}`), "okx_us"))?.data?.[0] ?? {};
    const price = Number(r.side === "buy" ? t.askPx : t.bidPx);
    const qty = Number(floorStep(wantQty(r, price), inst.lotSz));
    if (qty < Number(inst.minSz ?? 0)) throw new ProviderError("okx_us", 400, `OKX minimum for ${r.asset.symbol} is ${inst.minSz}`);
    return mkQuote("okx_us", r.side, Number(t.bidPx), Number(t.askPx), Number(t.last), qty, { inst: inst.instId, step: inst.lotSz, tick: inst.tickSz }, `OKX ${inst.instId} (your account)`);
  },
  async submit(ctx, o) {
    unsupportedType("okx_us", o);
    const rw = raw(o);
    const body: Record<string, string> = { instId: rw.inst, tdMode: "cash", side: o.side, ordType: o.order_type, sz: orderQty(o), clOrdId: o.id.replace(/-/g, "").slice(0, 32) };
    if (o.order_type === "market" && o.side === "buy") body.tgtCcy = "base_ccy";
    if (o.order_type === "limit") body.px = floorStep(Number(o.limit_price), rw.tick ?? "0.01");
    const d = await okxFetch(ctx, "POST", "/api/v5/trade/order", body);
    return { status: "submitted", providerOrderId: `${rw.inst}:${d[0].ordId}` };
  },
  async status(ctx, o) {
    const [instId, ordId] = o.provider_order_id!.split(":");
    const d = (await okxFetch(ctx, "GET", `/api/v5/trade/order?instId=${instId}&ordId=${ordId}`))?.[0] ?? {};
    const filled = Number(d.accFillSz ?? 0), avg = Number(d.avgPx) || null;
    const feeAbs = Math.abs(Number(d.fee ?? 0)), feeUsd = STABLES.has(d.feeCcy) ? feeAbs : feeAbs * (avg ?? 0);
    const st: StatusResult["status"] = d.state === "filled" ? "filled" : d.state === "canceled" || d.state === "mmp_canceled" ? (filled ? "filled" : "cancelled") : d.state === "partially_filled" ? "partially_filled" : "submitted";
    return { status: st, filledQty: filled, avgPrice: avg, fills: filled && avg ? [{ quantity: filled, price: avg, feeUsd, fillId: `okx-${ordId}:${filled}` }] : [] };
  },
  async cancel(ctx, o) { const [instId, ordId] = o.provider_order_id!.split(":"); await okxFetch(ctx, "POST", "/api/v5/trade/cancel-order", { instId, ordId }); },
};

export const EXCHANGE_ADAPTERS: ExecutionAdapter[] = [coinbaseAdapter, krakenAdapter, geminiAdapter, bitstampAdapter, cryptocomAdapter, binanceUsAdapter, okxAdapter];
export type { SubmitResult };
