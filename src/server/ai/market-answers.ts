import "@/lib/server-only-shim";
import { one, q } from "../db";
import { getCredential } from "../providers/credentials";
import { providerFetch, readJson } from "../providers/http";
import { extractAssets } from "./parser";

/**
 * MARKET Q&A DATA
 * Answers questions about any stock or coin — live and historical — from real market data:
 *  • Live: the asset's latest quote (CoinGecko / DEX Screener / Merod's live feed), fetched at question time.
 *  • History: daily prices for the asset's whole available history (CoinGecko for coins; Massive, Twelve Data or
 *    Alpaca for stocks; Birdeye for DEX tokens), using the user's own key first, then the platform's.
 * Dates in the question ("in 2021", "on March 5 2020", "3 years ago", "since 2019") are looked up exactly.
 * Nothing here is simulated: if a source isn't reachable it says so instead of guessing.
 */

export type Bar = { t: number; o: number; h: number; l: number; c: number };
export type DateAsk = { label: string; from: number; to: number; point: boolean };
/** Only real provider quotes count; simulated/unknown prices are never used in answers. */
export const isRealSource = (src: string | null | undefined) => !!src && !/simulat|demo|unknown|estimate/i.test(src);

export type AssetFacts = {
  symbol: string; name: string; assetClass: string; venue: string | null;
  live: { price: number; change24hPct: number | null; marketCap: number | null; volume24h: number | null; source: string; at: string } | null;
  ath?: { price: number; date: string } | null; atl?: { price: number; date: string } | null;
  history: { source: string; bars: Bar[]; note?: string; closesOnly?: boolean; adjusted?: boolean } | null;
  extra?: Record<string, unknown>;
  errors: string[];
};

const DAY = 86_400;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monIdx = (w: string) => MONTHS.findIndex((m) => m.startsWith(w.toLowerCase().slice(0, 3)));
const utc = (y: number, m = 0, d = 1) => Math.floor(Date.UTC(y, m, d) / 1000);
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/* ───────────────────────── Dates in the question ───────────────────────── */
export function parseDates(text: string, nowSec = Math.floor(Date.now() / 1000)): DateAsk[] {
  const t = text.toLowerCase();
  const out: DateAsk[] = [];
  const add = (label: string, from: number, to: number, point = false) => { if (from <= nowSec && !out.some((d) => d.label === label)) out.push({ label, from, to: Math.min(to, nowSec), point }); };
  const nowY = new Date(nowSec * 1000).getUTCFullYear();
  // 2021-03-05 / 03/05/2021
  for (const m of t.matchAll(/\b(19\d{2}|20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) { const f = utc(+m[1], +m[2] - 1, +m[3]); add(iso(f), f, f + DAY, true); }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(19\d{2}|20\d{2})\b/g)) { const f = utc(+m[3], +m[1] - 1, +m[2]); add(iso(f), f, f + DAY, true); }
  // March 5, 2021 / 5 March 2021 / March 2021
  const mon = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  for (const m of t.matchAll(new RegExp(`\\b${mon}\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (19\\d{2}|20\\d{2})\\b`, "g"))) { const f = utc(+m[3], monIdx(m[1]), +m[2]); add(iso(f), f, f + DAY, true); }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${mon},? (19\\d{2}|20\\d{2})\\b`, "g"))) { const f = utc(+m[3], monIdx(m[2]), +m[1]); add(iso(f), f, f + DAY, true); }
  for (const m of t.matchAll(new RegExp(`\\b${mon},? (19\\d{2}|20\\d{2})\\b`, "g"))) {
    const y = +m[2], mi = monIdx(m[1]);
    if (!out.some((d) => d.point && new Date(d.from * 1000).getUTCFullYear() === y && new Date(d.from * 1000).getUTCMonth() === mi)) add(`${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)} ${y}`, utc(y, mi), utc(y, mi + 1));
  }
  // since 2019 / from 2019 to 2022 / in 2021
  const range = t.match(/\b(?:from|between) (19\d{2}|20\d{2}) (?:to|and|until|-) (19\d{2}|20\d{2})\b/);
  if (range) add(`${range[1]}–${range[2]}`, utc(+range[1]), utc(+range[2] + 1));
  for (const m of t.matchAll(/\bsince (19\d{2}|20\d{2})\b/g)) add(`since ${m[1]}`, utc(+m[1]), nowSec);
  for (const m of t.matchAll(/\b(19\d{2}|20\d{2})\b/g)) {
    const y = +m[1];
    if (y > nowY || out.some((d) => d.label.includes(m[1]))) continue;
    add(String(y), utc(y), utc(y + 1));
  }
  // relative
  for (const m of t.matchAll(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (day|week|month|year)s? ago\b/g)) {
    const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[m[1]] ?? +m[1];
    const sec = n * { day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY }[m[2] as "day"];
    const f = Math.floor((nowSec - sec) / DAY) * DAY;
    add(`${n} ${m[2]}${n > 1 ? "s" : ""} ago`, f, f + DAY, true);
  }
  if (/\byesterday\b/.test(t)) { const f = Math.floor(nowSec / DAY) * DAY - DAY; add("yesterday", f, f + DAY, true); }
  if (/\blast year\b/.test(t)) add(`last year (${nowY - 1})`, utc(nowY - 1), utc(nowY));
  if (/\b(this year|ytd|year to date)\b/.test(t)) add(`this year (${nowY})`, utc(nowY), nowSec);
  if (/\blast month\b/.test(t)) { const d = new Date(nowSec * 1000); add("last month", utc(d.getUTCFullYear(), d.getUTCMonth() - 1), utc(d.getUTCFullYear(), d.getUTCMonth())); }
  if (/\b(last|past) week\b/.test(t)) add("past week", nowSec - 7 * DAY, nowSec);
  return out.slice(0, 6);
}

/* ───────────────────────── Keyless full-history sources ───────────────────────── */
/** Coinbase Exchange public daily candles: [[time, low, high, open, close, volume], …] (newest first). */
export function parseCoinbaseCandles(rows: any): Bar[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => Array.isArray(r) && r.length >= 5).map((r) => ({ t: Number(r[0]), l: Number(r[1]), h: Number(r[2]), o: Number(r[3]), c: Number(r[4]) }))
    .filter((b) => Number.isFinite(b.t) && b.c > 0).sort((a, b) => a.t - b.t);
}
/** Every daily candle Coinbase has for SYM-USD (back to its listing, e.g. 2015 for BTC), 300 days per request. */
export async function coinbaseHistory(symbol: string): Promise<Bar[]> {
  const product = `${symbol.toUpperCase()}-USD`;
  const out = new Map<number, Bar>();
  let end = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 16; i++) {
    const start = end - 300 * DAY;
    const res = await providerFetch("coinbase_public", "production", `https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`,
      { headers: { accept: "application/json", "user-agent": "merod" }, timeoutMs: 12_000 });
    if (res.status === 404) break;
    const bars = parseCoinbaseCandles(await readJson(res, "coinbase_public"));
    if (!bars.length) break;
    for (const b of bars) out.set(b.t, b);
    end = start;
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
/** Stooq daily CSV: Date,Open,High,Low,Close,Volume. */
export function parseStooqCsv(csv: string): Bar[] {
  const lines = String(csv ?? "").trim().split(/\r?\n/);
  if (!/^date,open,high,low,close/i.test(lines[0] ?? "")) return [];
  return lines.slice(1).map((l) => l.split(",")).filter((c) => c.length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(c[0]))
    .map((c) => ({ t: utc(+c[0].slice(0, 4), +c[0].slice(5, 7) - 1, +c[0].slice(8, 10)), o: +c[1], h: +c[2], l: +c[3], c: +c[4] })).filter((b) => b.c > 0);
}
/** Full daily history for a US stock or ETF from Stooq (no key; decades of data). */
export async function stooqHistory(symbol: string): Promise<Bar[]> {
  const s = `${symbol.toLowerCase().replace(/\./g, "-")}.us`;
  const res = await providerFetch("stooq", "production", `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`, { headers: { "user-agent": "merod" }, timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseStooqCsv(await res.text());
}

/* ───────────────────────── Source helpers ───────────────────────── */
async function coingecko(userId: string | undefined) {
  const key = await getCredential("coingecko", "production", "COINGECKO_API_KEY", userId).catch(() => undefined);
  const plan = (await one<{ v: string }>("SELECT settings->>'plan' AS v FROM provider_configs WHERE provider_id='coingecko' AND environment='production'").catch(() => null))?.v ?? "demo";
  const base = key && plan === "pro" ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  const headers: Record<string, string> = key ? { [plan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {};
  return { get: async (path: string) => readJson(await providerFetch("coingecko", "production", `${base}${path}`, { headers, timeoutMs: 12_000 }), "coingecko"), keyed: !!key, plan };
}
const cred = (p: string, n: string, userId?: string) => getCredential(p, "production", n, userId).catch(() => undefined);

async function cryptoFacts(f: AssetFacts, a: any, userId?: string) {
  const cg = await coingecko(userId);
  let id: string | null = a?.coingecko_id ?? null;
  if (!id && !a?.identifier?.match?.(/^(0x|[1-9A-HJ-NP-Za-km-z]{32,})/)) {
    try {
      const s = await cg.get(`/search?query=${encodeURIComponent(f.symbol)}`);
      const hit = (s?.coins ?? []).filter((c: any) => c.symbol?.toUpperCase() === f.symbol.toUpperCase()).sort((x: any, y: any) => (x.market_cap_rank ?? 1e9) - (y.market_cap_rank ?? 1e9))[0];
      if (hit) { id = hit.id; f.name = hit.name; }
    } catch (e: any) { f.errors.push(`CoinGecko search: ${e.message}`); }
  }
  if (id) {
    try {
      const c = await cg.get(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`);
      const md = c?.market_data ?? {};
      f.name = c?.name ?? f.name;
      if (typeof md.current_price?.usd === "number")
        f.live = { price: md.current_price.usd, change24hPct: md.price_change_percentage_24h ?? null, marketCap: md.market_cap?.usd ?? null, volume24h: md.total_volume?.usd ?? null, source: "CoinGecko", at: md.last_updated ?? new Date().toISOString() };
      if (md.ath?.usd) f.ath = { price: md.ath.usd, date: String(md.ath_date?.usd ?? "").slice(0, 10) };
      if (md.atl?.usd) f.atl = { price: md.atl.usd, date: String(md.atl_date?.usd ?? "").slice(0, 10) };
      f.extra = { ...f.extra, coingecko_id: id, market_cap_rank: c?.market_cap_rank, circulating_supply: md.circulating_supply, max_supply: md.max_supply,
        change_7d_pct: md.price_change_percentage_7d, change_30d_pct: md.price_change_percentage_30d, change_1y_pct: md.price_change_percentage_1y, genesis_date: c?.genesis_date, categories: (c?.categories ?? []).slice(0, 5) };
    } catch (e: any) { f.errors.push(`CoinGecko quote: ${e.message}`); }
    // Full daily history ("max" needs a paid plan; keyless/demo is limited to the last 365 days).
    for (const days of cg.plan === "pro" ? ["max"] : ["max", "365"]) {
      try {
        const m = await cg.get(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`);
        const pts: [number, number][] = m?.prices ?? [];
        if (pts.length) { f.history = { source: "CoinGecko", closesOnly: true, bars: pts.map(([ms, p]) => ({ t: Math.floor(ms / 1000), o: p, h: p, l: p, c: p })), note: days === "365" ? "CoinGecko's free tier only returns the last 365 days of daily prices; ATH/ATL above cover the full history." : undefined }; break; }
      } catch (e: any) { if (days !== "max" || cg.plan === "pro") f.errors.push(`CoinGecko history: ${e.message}`); }
    }
    await fillOlderCrypto(f);
    return;
  }
  // DEX token (contract address): DEX Screener live, Birdeye history if a key is connected.
  if (a?.identifier && a.venue) {
    const chain: Record<string, string> = { solana: "solana", ethereum: "ethereum", base: "base", bsc: "bsc", polygon: "polygon", arbitrum: "arbitrum", avalanche: "avalanche" };
    try {
      const pairs = await readJson(await providerFetch("dexscreener", "production", `https://api.dexscreener.com/tokens/v1/${chain[a.venue] ?? a.venue}/${a.identifier}`, { timeoutMs: 10_000 }), "dexscreener");
      const best = (pairs as any[] ?? []).sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0];
      if (best) {
        f.live = { price: Number(best.priceUsd), change24hPct: best.priceChange?.h24 ?? null, marketCap: best.marketCap ?? best.fdv ?? null, volume24h: best.volume?.h24 ?? null, source: "DEX Screener", at: new Date().toISOString() };
        f.extra = { ...f.extra, change_5m_pct: best.priceChange?.m5, change_1h_pct: best.priceChange?.h1, change_6h_pct: best.priceChange?.h6, liquidity_usd: best.liquidity?.usd, pair_created: best.pairCreatedAt ? new Date(best.pairCreatedAt).toISOString() : null, dex: best.dexId };
      }
    } catch (e: any) { f.errors.push(`DEX Screener: ${e.message}`); }
    const bkey = await cred("birdeye", "BIRDEYE_API_KEY", userId);
    if (bkey) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const j = await readJson(await providerFetch("birdeye", "production", `https://public-api.birdeye.so/defi/history_price?address=${a.identifier}&address_type=token&type=1D&time_from=${now - 5 * 365 * DAY}&time_to=${now}`,
          { headers: { "X-API-KEY": bkey, "x-chain": a.venue, accept: "application/json" }, timeoutMs: 12_000 }), "birdeye");
        const items: any[] = j?.data?.items ?? [];
        if (items.length) f.history = { source: "Birdeye", closesOnly: true, bars: items.map((i) => ({ t: i.unixTime, o: i.value, h: i.value, l: i.value, c: i.value })) };
      } catch (e: any) { f.errors.push(`Birdeye history: ${e.message}`); }
    } else f.errors.push("Daily history for DEX tokens needs a Birdeye key (Broker & AI Keys).");
  }
}

/** Coins: add Coinbase's full daily OHLC history (back to listing) where CoinGecko's free tier stops at 365 days. */
async function fillOlderCrypto(f: AssetFacts) {
  const first = f.history?.bars.length ? Math.min(...f.history.bars.map((b) => b.t)) : Infinity;
  if (first < Math.floor(Date.now() / 1000) - 400 * DAY) return; // already have deep history
  try {
    const cb = await coinbaseHistory(f.symbol);
    if (!cb.length) return;
    const have = new Map((f.history?.bars ?? []).map((b) => [Math.floor(b.t / DAY), b]));
    for (const b of cb) if (!have.has(Math.floor(b.t / DAY))) have.set(Math.floor(b.t / DAY), b);
    const bars = [...have.values()].sort((x, y) => x.t - y.t);
    f.history = { source: f.history ? `${f.history.source} + Coinbase` : "Coinbase", closesOnly: !f.history ? false : f.history.closesOnly, bars,
      note: `Older daily prices from Coinbase (${f.symbol}-USD, from ${iso(cb[0].t)}); before a coin listed on Coinbase there is no data from this source.` };
  } catch (e: any) { f.errors.push(`Coinbase history: ${e.message}`); }
}

async function stockFacts(f: AssetFacts, a: any, userId?: string) {
  const sym = f.symbol.toUpperCase();
  const now = Math.floor(Date.now() / 1000), start = utc(1990);
  // 1) Massive (Polygon)
  const mk = await cred("massive", "MASSIVE_API_KEY", userId);
  if (mk && !f.history) {
    try {
      const j = await readJson(await providerFetch("massive", "production", `https://api.massive.com/v2/aggs/ticker/${sym}/range/1/day/${iso(start)}/${iso(now)}?adjusted=true&sort=asc&limit=50000&apiKey=${mk}`, { timeoutMs: 15_000 }), "massive");
      if (j?.results?.length) f.history = { source: "Massive", adjusted: true, bars: j.results.map((r: any) => ({ t: Math.floor(r.t / 1000), o: r.o, h: r.h, l: r.l, c: r.c })) };
    } catch (e: any) { f.errors.push(`Massive: ${e.message}`); }
  }
  // 2) Twelve Data
  const tk = await cred("twelvedata", "TWELVEDATA_API_KEY", userId);
  if (tk && !f.history) {
    try {
      const j = await readJson(await providerFetch("twelvedata", "production", `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=5000&order=asc&apikey=${tk}`, { timeoutMs: 15_000 }), "twelvedata");
      if (j?.status !== "error" && j?.values?.length) f.history = { source: "Twelve Data", adjusted: true, bars: j.values.map((v: any) => ({ t: utc(+v.datetime.slice(0, 4), +v.datetime.slice(5, 7) - 1, +v.datetime.slice(8, 10)), o: +v.open, h: +v.high, l: +v.low, c: +v.close })) };
      else if (j?.status === "error") f.errors.push(`Twelve Data: ${j.message}`);
    } catch (e: any) { f.errors.push(`Twelve Data: ${e.message}`); }
  }
  // 3) Alpaca (IEX feed history from 2016)
  if (!f.history) {
    const ak = await cred("alpaca_trading", "ALPACA_API_KEY", userId), as = await cred("alpaca_trading", "ALPACA_API_SECRET", userId);
    if (ak && as) {
      try {
        const bars: Bar[] = [];
        let token = "";
        for (let i = 0; i < 4; i++) {
          const j = await readJson(await providerFetch("alpaca_trading", "production", `https://data.alpaca.markets/v2/stocks/${sym}/bars?timeframe=1Day&start=${iso(utc(2016))}&limit=10000&adjustment=split&feed=iex${token ? `&page_token=${token}` : ""}`,
            { headers: { "APCA-API-KEY-ID": ak, "APCA-API-SECRET-KEY": as }, timeoutMs: 15_000 }), "alpaca_trading");
          for (const b of j?.bars ?? []) bars.push({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c });
          token = j?.next_page_token ?? ""; if (!token) break;
        }
        if (bars.length) f.history = { source: "Alpaca (IEX feed)", adjusted: true, bars, note: "Alpaca's free IEX feed starts in 2016 and only counts IEX trades, so prices can differ slightly from the official consolidated close." };
      } catch (e: any) { f.errors.push(`Alpaca: ${e.message}`); }
    }
  }
  // 4) Stooq: free daily history for US stocks and ETFs (decades), no key needed.
  if (!f.history) {
    try {
      const bars = await stooqHistory(sym);
      if (bars.length) f.history = { source: "Stooq", bars, note: "Free daily data from Stooq; check split/dividend adjustments for very old prices." };
    } catch (e: any) { f.errors.push(`Stooq: ${e.message}`); }
  }
  if (!f.history) f.errors.push("No price history found for this symbol (Massive, Twelve Data, Alpaca or Stooq).");
  // Live: Merod's live feed if it's real, else the latest daily close.
  if (a?.last_price && isRealSource(a.price_source) && !(a.risk_flags ?? []).includes("demo_data"))
    f.live = { price: Number(a.last_price), change24hPct: a.change_24h != null ? Number(a.change_24h) : null, marketCap: a.market_cap ? Number(a.market_cap) : null, volume24h: a.volume_24h ? Number(a.volume_24h) : null, source: a.price_source, at: new Date(a.price_updated_at ?? Date.now()).toISOString() };
  else if (f.history?.bars.length) {
    const b = f.history.bars, last = b[b.length - 1], prev = b[b.length - 2];
    f.live = { price: last.c, change24hPct: prev ? (last.c / prev.c - 1) * 100 : null, marketCap: null, volume24h: null, source: `${f.history.source} (last daily close ${iso(last.t)})`, at: new Date(last.t * 1000).toISOString() };
  }
}

/* ───────────────────────── Gather ───────────────────────── */
export async function gatherFacts(text: string, opts: { userId?: string; screenAssetId?: string | null } = {}): Promise<{ facts: AssetFacts[]; dates: DateAsk[] }> {
  const named = extractAssets(text, 8);
  const rows: any[] = [];
  for (const n of named) {
    const r = n.contract
      ? await one<any>("SELECT * FROM assets WHERE lower(identifier)=lower($1) AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 1", [n.contract])
      : await one<any>(`SELECT * FROM assets WHERE upper(symbol)=upper($1) AND NOT ('demo_data'=ANY(risk_flags))
          ORDER BY (asset_class = $2) DESC, (coingecko_id IS NOT NULL OR asset_class <> 'crypto') DESC, market_cap DESC NULLS LAST LIMIT 1`, [n.symbol, hintClass(text)]);
    rows.push(r ?? { symbol: n.symbol ?? n.contract, name: n.symbol ?? n.contract, asset_class: n.contract ? "crypto" : guessClass(text), venue: n.network, identifier: n.contract });
  }
  if (!rows.length && opts.screenAssetId) { const r = await one<any>("SELECT * FROM assets WHERE id=$1", [opts.screenAssetId]); if (r) rows.push(r); }
  const facts = await Promise.all(rows.map(async (a) => {
    const f: AssetFacts = { symbol: a.symbol, name: a.name ?? a.symbol, assetClass: a.asset_class, venue: a.venue ?? null, live: null, history: null, errors: [] };
    try { if (a.asset_class === "crypto") await cryptoFacts(f, a, opts.userId); else await stockFacts(f, a, opts.userId); }
    catch (e: any) { f.errors.push(e.message); }
    // Last resort for live: Merod's own quote, but only when it came from a real provider in the last 15 minutes.
    if (!f.live && a.last_price && isRealSource(a.price_source) && !(a.risk_flags ?? []).includes("demo_data") && Date.now() - new Date(a.price_updated_at ?? 0).getTime() < 15 * 60_000)
      f.live = { price: Number(a.last_price), change24hPct: a.change_24h != null ? Number(a.change_24h) : null, marketCap: a.market_cap ? Number(a.market_cap) : null, volume24h: a.volume_24h ? Number(a.volume_24h) : null, source: a.price_source, at: new Date(a.price_updated_at).toISOString() };
    if (!f.live) f.errors.push("No live quote from a real data source right now.");
    if (f.history) f.history.bars.sort((x, y) => x.t - y.t);
    return f;
  }));
  return { facts, dates: parseDates(text) };
}
const hintClass = (t: string) => /\b(stocks?|shares?|equity|etf|nasdaq|nyse|company|ipo|earnings)\b/i.test(t) ? "stock" : "crypto";
const guessClass = (t: string) => /\b(coin|token|crypto|chain|defi|meme)\b/i.test(t) ? "crypto" : "stock";

/* ───────────────────────── Stats ───────────────────────── */
const at = (bars: Bar[], t: number) => { let best: Bar | null = null; for (const b of bars) { if (b.t < t + DAY) best = b; else break; } return best; };
/** The close nearest to `t`, only if the data actually has a bar within 5 days of it (no stale substitutes). */
const near = (bars: Bar[], t: number) => { const p = at(bars, t); return p && t - p.t < 5 * DAY ? p : null; };
const pct = (a: number, b: number) => (b / a - 1) * 100;
export const money = (n: number) => n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toPrecision(4)}`;
const sp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function rangeStats(bars: Bar[], from: number, to: number) {
  const inR = bars.filter((b) => b.t >= from && b.t < to);
  if (!inR.length) return null;
  let hi = inR[0], lo = inR[0];
  for (const b of inR) { if (b.h > hi.h) hi = b; if (b.l < lo.l) lo = b; }
  const first = inR[0], last = inR[inR.length - 1];
  return { open: first.o, close: last.c, high: hi.h, highDate: iso(hi.t), low: lo.l, lowDate: iso(lo.t), changePct: pct(first.o, last.c), firstDate: iso(first.t), lastDate: iso(last.t) };
}

/** Compact, labelled data packet for the AI (and the source of the no-AI answer). */
export function factsPacket(facts: AssetFacts[], dates: DateAsk[]) {
  const now = Math.floor(Date.now() / 1000);
  const lines: string[] = [`now_utc=${new Date().toISOString()}`];
  for (const f of facts) {
    lines.push(`\n## ${f.name} (${f.symbol}) — ${f.assetClass}${f.venue ? ` on ${f.venue}` : ""}`);
    if (f.live) lines.push(`live_price=${f.live.price} change_24h_pct=${f.live.change24hPct ?? "n/a"} market_cap=${f.live.marketCap ?? "n/a"} volume_24h=${f.live.volume24h ?? "n/a"} source=${f.live.source} as_of=${f.live.at}`);
    else lines.push("live_price=unavailable");
    if (f.ath) lines.push(`all_time_high=${f.ath.price} on ${f.ath.date}`);
    if (f.atl) lines.push(`all_time_low=${f.atl.price} on ${f.atl.date}`);
    if (f.extra) lines.push(`details=${JSON.stringify(f.extra)}`);
    const b = f.history?.bars ?? [];
    if (b.length) {
      lines.push(`daily_history source=${f.history!.source}${f.history!.closesOnly ? " kind=one_price_per_day(00:00 UTC; intraday highs/lows not included)" : " kind=daily_OHLC"}${f.history!.adjusted ? " split_adjusted=true" : ""} from=${iso(b[0].t)} to=${iso(b[b.length - 1].t)} points=${b.length}${f.history!.note ? ` note="${f.history!.note}"` : ""}`);
      const last = b[b.length - 1];
      const ch = [["7d", 7], ["30d", 30], ["90d", 90], ["1y", 365], ["3y", 1095], ["5y", 1825], ["10y", 3650]].flatMap(([k, d]) => {
        const p = near(b, now - (d as number) * DAY); return p ? [`${k}=${sp(pct(p.c, f.live?.price ?? last.c))}`] : [];
      });
      lines.push(`change_vs_now ${ch.join(" ")}`);
      const all = rangeStats(b, 0, now + DAY)!;
      lines.push(`in_data high=${all.high} (${all.highDate}) low=${all.low} (${all.lowDate}) first_close=${b[0].c} (${iso(b[0].t)})`);
      for (const d of dates) {
        if (d.point) { const p = at(b, d.from); lines.push(p && Math.abs(p.t - d.from) < 5 * DAY ? `price_on ${d.label}: close=${p.c} (bar ${iso(p.t)}) change_since=${sp(pct(p.c, f.live?.price ?? last.c))}` : `price_on ${d.label}: not in available data`); }
        else { const r = rangeStats(b, d.from, d.to); lines.push(r ? `period ${d.label}: open=${r.open} close=${r.close} high=${r.high} (${r.highDate}) low=${r.low} (${r.lowDate}) change=${sp(r.changePct)}` : `period ${d.label}: not in available data`); }
      }
      // Yearly summary + recent monthly closes so the model can answer anything else about the path.
      const years = [...new Set(b.map((x) => new Date(x.t * 1000).getUTCFullYear()))];
      lines.push("yearly " + years.map((y) => { const r = rangeStats(b, utc(y), utc(y + 1))!; return `${y}:o=${+r.open.toPrecision(6)},c=${+r.close.toPrecision(6)},h=${+r.high.toPrecision(6)},l=${+r.low.toPrecision(6)}`; }).join(" "));
      const monthly: string[] = [];
      for (let i = 23; i >= 0; i--) { const d = new Date(now * 1000); const t0 = utc(d.getUTCFullYear(), d.getUTCMonth() - i + 1) - DAY; const p = at(b, t0); if (p && p.t >= b[0].t) monthly.push(`${iso(p.t).slice(0, 7)}=${+p.c.toPrecision(6)}`); }
      lines.push("month_end_closes " + monthly.join(" "));
      lines.push("last_10_daily " + b.slice(-10).map((x) => `${iso(x.t)}=${+x.c.toPrecision(6)}`).join(" "));
    } else lines.push("daily_history=unavailable");
    if (f.errors.length) lines.push(`data_gaps=${f.errors.join(" | ")}`);
  }
  return lines.join("\n");
}

/** Plain answer from the data alone (used when no AI key is connected, or as a fallback). */
export function factsAnswer(facts: AssetFacts[], dates: DateAsk[]) {
  if (!facts.length) return null;
  const now = Math.floor(Date.now() / 1000);
  return facts.map((f) => {
    const out: string[] = [];
    const b = f.history?.bars ?? [];
    const cur = f.live?.price ?? null;
    const [hiW, loW] = f.history?.closesOnly ? ["highest daily price", "lowest daily price"] : ["high", "low"];
    out.push(cur != null
      ? `${f.name} (${f.symbol}) is ${money(cur)}${f.live?.change24hPct != null ? ` (${sp(f.live.change24hPct)} 24h)` : ""}, from ${f.live?.source ?? f.history?.source}.`
      : `I couldn't get a live price for ${f.name} (${f.symbol}) from a real data source right now, so I won't guess one.`);
    for (const d of dates) {
      if (!b.length) break;
      if (d.point) { const p = at(b, d.from); if (p && Math.abs(p.t - d.from) < 5 * DAY) out.push(`On ${iso(p.t)} it closed at ${money(p.c)}${cur ? ` (${sp(pct(p.c, cur))} since)` : ""}.`); else out.push(`I don't have its price for ${d.label}.`); }
      else { const r = rangeStats(b, d.from, d.to); if (r) out.push(`${d.label}: opened ${money(r.open)}, closed ${money(r.close)} (${sp(r.changePct)}); ${hiW} ${money(r.high)} on ${r.highDate}, ${loW} ${money(r.low)} on ${r.lowDate}.`); else out.push(`I don't have its prices for ${d.label}.`); }
    }
    if (b.length && cur != null) {
      const ch = [["7 days", 7], ["30 days", 30], ["1 year", 365], ["5 years", 1825]].flatMap(([k, d]) => { const p = near(b, now - (d as number) * DAY); return p ? [`${k} ${sp(pct(p.c, cur))}`] : []; });
      if (ch.length) out.push(`Change: ${ch.join(", ")}.`);
    }
    if (f.ath) out.push(`All-time high ${money(f.ath.price)} on ${f.ath.date}${cur ? ` (${sp(pct(f.ath.price, cur))} from there)` : ""}; all-time low ${f.atl ? `${money(f.atl.price)} on ${f.atl.date}` : "n/a"}.`);
    else if (b.length) { const r = rangeStats(b, 0, now + DAY)!; out.push(`Since ${iso(b[0].t)} (start of available data): ${hiW} ${money(r.high)} on ${r.highDate}, ${loW} ${money(r.low)} on ${r.lowDate}.`); }
    if (!b.length) out.push(f.errors.find((e) => /needs a|history/i.test(e)) ?? "No price history was available from a real source.");
    return out.join(" ");
  }).join("\n\n");
}

/** Is this a question about a market/asset (rather than a trade instruction)? */
export function isMarketQuestion(text: string) {
  const t = text.trim().toLowerCase();
  if (/^(buy|sell|short|long|swap|convert|cancel|pause|resume|stop|set|create|make|start|alert|dca|mimic|copy)\b/.test(t)) return false;
  return /\?$/.test(t) || /^(what|whats|what's|when|why|how|who|which|where|is|was|are|were|did|does|do|has|have|can|could|should|will|would|tell|show|give|compare|explain|list)\b/.test(t)
    || /\b(price|worth|trading at|all[- ]time high|ath|all[- ]time low|atl|history|historical|chart|performance|perform|market cap|volume|high|low|close|open|ipo|launch(ed)?|compare|vs\.?|versus|news)\b/.test(t);
}

/** Verifiable footer on every market answer: which real source each number came from, and when. */
export function sourcesLine(facts: AssetFacts[]) {
  if (!facts.length) return "";
  const hhmm = (s: string) => new Date(s).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const parts = facts.map((f) => {
    const p: string[] = [];
    p.push(f.live ? `${f.symbol} live from ${f.live.source} as of ${hhmm(f.live.at)}` : `${f.symbol}: no live quote`);
    const b = f.history?.bars;
    if (b?.length) p.push(`daily history from ${f.history!.source} (${iso(b[0].t)} to ${iso(b[b.length - 1].t)}${f.history!.adjusted ? ", split-adjusted" : ""})`);
    if (f.ath) p.push(`all-time high/low from CoinGecko`);
    if (f.extra?.coingecko_id) p.push(`CoinGecko coin “${f.extra.coingecko_id}”`);
    return p.join("; ");
  });
  return `\n\nSources: ${parts.join(" · ")}.`;
}
