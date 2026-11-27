import "@/lib/server-only-shim";
import { one, q } from "../db";
import { publish } from "../realtime";
import { contextFor, providerUsable } from "../providers/integrations";
import { readJson } from "../providers/http";
import { keylessUsable, recordTick } from "./real-data";

export interface AssetRow {
  id: string; asset_class: "stock" | "etf" | "crypto" | "option"; symbol: string; name: string; venue: string; identifier: string;
  decimals: number | null; tradability: string; lifecycle: string | null; categories: string[]; risk_flags: string[];
  coingecko_id: string | null; last_price: number | null; change_24h: number | null; volume_24h: number | null;
  market_cap: number | null; liquidity_usd: number | null; price_source: string | null; price_updated_at: string | null;
  launched_at: string | null; logo_url: string | null;
}

export interface PriceInfo { price: number; source: string; updatedAt: Date; simulated: boolean; delayed: boolean; ageSec: number }

export function priceInfo(a: AssetRow): PriceInfo | null {
  if (a.last_price == null || !a.price_updated_at) return null;
  const updatedAt = new Date(a.price_updated_at);
  const src = a.price_source ?? "unknown";
  return {
    price: Number(a.last_price), source: src, updatedAt, simulated: src === "simulated",
    delayed: src.endsWith(":delayed"), ageSec: (Date.now() - updatedAt.getTime()) / 1000,
  };
}

export async function getAsset(id: string) {
  return one<AssetRow>("SELECT * FROM assets WHERE id=$1", [id]);
}

/* ───────────────────────── Simulated feed (paper/demo only) ───────────────────────── */

const VOL: Record<string, number> = { stock: 0.0009, etf: 0.0005, crypto: 0.0018, option: 0.003 };
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const TF_SEC: Record<string, number> = { "1m": 60, "5m": 300, "1h": 3600, "1d": 86400 };
const bucket = (ts: number, tf: string) => Math.floor(ts / 1000 / TF_SEC[tf]) * TF_SEC[tf] * 1000;

/** Advance every simulated asset one step (geometric random walk) and roll candle bars. */
export async function tickSimulated() {
  const rows = await q<AssetRow>("SELECT * FROM assets WHERE price_source='simulated' OR price_source IS NULL");
  const now = Date.now();
  const updates: { id: string; price: number; change: number }[] = [];
  for (const a of rows) {
    const p0 = Number(a.last_price ?? 1);
    if (a.symbol === "USDC") { updates.push({ id: a.id, price: 1 + gauss() * 0.0002, change: 0 }); continue; }
    const vol = (VOL[a.asset_class] ?? 0.001) * (a.risk_flags?.includes("demo_data") ? 4 : 1);
    const p = Math.max(p0 * Math.exp(gauss() * vol), 1e-12);
    const dayOpen = await one<{ open: number }>("SELECT open FROM price_bars WHERE asset_id=$1 AND timeframe='1d' ORDER BY ts DESC LIMIT 1", [a.id]);
    const change = dayOpen ? ((p - Number(dayOpen.open)) / Number(dayOpen.open)) * 100 : 0;
    updates.push({ id: a.id, price: p, change });
  }
  for (const u of updates) {
    const vol = Math.random() * 1000;
    await q(`UPDATE assets SET last_price=$2, change_24h=$3, price_source='simulated', price_updated_at=now(),
              volume_24h=COALESCE(volume_24h,0)*0.9999 + $4 WHERE id=$1`, [u.id, u.price, u.change, vol * u.price]);
    for (const tf of ["1m", "5m", "1h", "1d"]) {
      await q(`INSERT INTO price_bars (asset_id, timeframe, ts, open, high, low, close, volume, source)
               VALUES ($1,$2,to_timestamp($3/1000.0),$4,$4,$4,$4,$5,'simulated')
               ON CONFLICT (asset_id, timeframe, ts) DO UPDATE SET high=GREATEST(price_bars.high,$4), low=LEAST(price_bars.low,$4),
                 close=$4, volume=price_bars.volume+$5`, [u.id, tf, bucket(now, tf), u.price, vol]);
    }
  }
  if (updates.length) await publish("market", "ticks", updates.map((u) => ({ id: u.id, price: u.price, change: u.change, source: "simulated" })));
  return updates.length;
}

/** Generate a plausible history ending at `end` so charts have data in demo mode. Labeled source=simulated. */
export async function backfillSimulatedBars(assetId: string, end: number, assetClass: string) {
  const vol = VOL[assetClass] ?? 0.001;
  const plans: [string, number, number][] = [["1d", 365, vol * 12], ["1h", 24 * 30, vol * 3.5], ["5m", 12 * 24 * 3, vol * 1.2]];
  for (const [tf, n, stepVol] of plans) {
    const step = TF_SEC[tf] * 1000;
    const start = bucket(Date.now(), tf) - (n - 1) * step;
    // walk backwards from the current price so the series ends at `end`
    const closes: number[] = new Array(n);
    closes[n - 1] = end;
    for (let i = n - 2; i >= 0; i--) closes[i] = closes[i + 1] / Math.exp(gauss() * stepVol + stepVol * 0.02);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = closes[i], o = i ? closes[i - 1] : c;
      const h = Math.max(o, c) * (1 + Math.abs(gauss()) * stepVol * 0.5), l = Math.min(o, c) * (1 - Math.abs(gauss()) * stepVol * 0.5);
      const b = values.length;
      tuples.push(`($${b + 1},$${b + 2},to_timestamp($${b + 3}/1000.0),$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},'simulated')`);
      values.push(assetId, tf, start + i * step, o, h, l, c, Math.random() * 5000 + 500);
      if (tuples.length === 500 || i === n - 1) {
        await q(`INSERT INTO price_bars (asset_id,timeframe,ts,open,high,low,close,volume,source) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`, values);
        tuples.length = 0; values.length = 0;
      }
    }
  }
}

/* ───────────────────────── Live market data (connected providers only) ───────────────────────── */

const DEX_CHAIN: Record<string, string> = { solana: "solana", ethereum: "ethereum", base: "base", bsc: "bsc", arbitrum: "arbitrum", polygon: "polygon", avalanche: "avalanche", sui: "sui", aptos: "aptos" };

/**
 * Refresh prices from whichever market-data providers an admin has tested + enabled.
 * Assets updated here switch from "simulated" to the real provider source.
 */
/** After CoinGecko rate-limits us (HTTP 429), skip it for a few minutes instead of hammering it every 30s. */
let coingeckoPausedUntil = 0;

/** DEX Screener: at most 300 tokens per price run (10 batched requests every 30s ≈ 20/min, well under its limits). */
const DEX_TOKENS_PER_RUN = 300;
/** Shared DEX Screener back-off: a 429 pauses price refresh and launch discovery together, doubling up to 10 minutes. */
let dexPausedUntil = 0, dexPauseMs = 60_000;
const dexReady = () => Date.now() >= dexPausedUntil;
function dexBackoff(e: any, where: string): boolean {
  const msg = String(e?.message ?? e);
  const limited = /429|rate limit|too many requests/i.test(msg);
  if (limited) { dexPausedUntil = Date.now() + dexPauseMs; console.warn(`[${where}] dexscreener rate-limited: pausing ${Math.round(dexPauseMs / 1000)}s`); dexPauseMs = Math.min(dexPauseMs * 2, 10 * 60_000); }
  else console.warn(`[${where}] dexscreener: ${msg.split("\n")[0].slice(0, 160)}`);
  return limited;
}
const dexOk = () => { dexPauseMs = 60_000; };
export async function refreshLivePrices(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const env = "production" as const;

  // Each source runs on its own: a CoinGecko rate limit must never stop DEX Screener (meme coin) prices.
  if (Date.now() >= coingeckoPausedUntil && await keylessUsable("coingecko")) try {
    const ctx = contextFor("coingecko", env);
    const assets = await q<AssetRow>("SELECT * FROM assets WHERE coingecko_id IS NOT NULL");
    const key = await ctx.cred("COINGECKO_API_KEY");
    const plan = (await ctx.setting("plan")) ?? "demo";
    const base = key && plan === "pro" ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    const headers: Record<string, string> = key ? { [plan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {};
    const ids = assets.map((a) => a.coingecko_id).join(",");
    const rows = await readJson(await ctx.fetch(`${base}/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`, { headers }), "coingecko");
    for (const r of rows as any[]) {
      const a = assets.find((x) => x.coingecko_id === r.id);
      if (!a || typeof r.current_price !== "number") continue;
      await q(`UPDATE assets SET last_price=$2, change_24h=$3, volume_24h=$4, market_cap=$5, price_source='coingecko', price_updated_at=now(), logo_url=COALESCE(logo_url,$6) WHERE id=$1`,
        [a.id, r.current_price, r.price_change_percentage_24h ?? 0, r.total_volume ?? null, r.market_cap ?? null, r.image ?? null]);
      await recordTick(a.id, r.current_price, "coingecko");
    }
    counts.coingecko = (rows as any[]).length;
  } catch (e: any) {
    if (/429|rate limit/i.test(String(e?.message))) coingeckoPausedUntil = Date.now() + 5 * 60_000;
    counts.coingecko_error = 1;
    console.warn(`[live_prices] coingecko skipped: ${String(e?.message).slice(0, 120)}${coingeckoPausedUntil > Date.now() ? " (paused 5 min)" : ""}`);
  }

  if (dexReady() && await keylessUsable("dexscreener")) {
    const ctx = contextFor("dexscreener", env);
    // A fixed request budget per run (DEX Screener rate-limits). Coins someone is actually using come first — bot, agent,
    // position and watchlist coins — then everything else, least recently updated first, so all coins rotate through.
    const assets = await q<AssetRow>(
      `SELECT a.* FROM assets a WHERE a.asset_class='crypto' AND a.identifier <> 'native' AND a.venue = ANY($1) AND a.coingecko_id IS NULL
        ORDER BY (EXISTS (SELECT 1 FROM trading_bots b WHERE b.status='running' AND a.id = ANY(b.asset_ids))
               OR EXISTS (SELECT 1 FROM agents g WHERE g.status='running' AND a.id = ANY(g.asset_ids))
               OR EXISTS (SELECT 1 FROM positions p WHERE p.asset_id=a.id AND p.quantity > 0)
               OR EXISTS (SELECT 1 FROM watchlist_items w WHERE w.asset_id=a.id)) DESC,
                 a.price_updated_at ASC NULLS FIRST
        LIMIT $2`, [Object.keys(DEX_CHAIN), DEX_TOKENS_PER_RUN]);
    const byChain = new Map<string, AssetRow[]>();
    for (const a of assets) byChain.set(a.venue, [...(byChain.get(a.venue) ?? []), a]);
    let n = 0;
    chains: for (const [chain, list] of byChain) {
      for (let i = 0; i < list.length; i += 30) {
        const chunk = list.slice(i, i + 30);
        let pairs: any;
        try { pairs = await readJson(await ctx.fetch(`https://api.dexscreener.com/tokens/v1/${DEX_CHAIN[chain]}/${chunk.map((a) => a.identifier).join(",")}`), "dexscreener"); }
        catch (e: any) { if (dexBackoff(e, "live_prices")) break chains; continue; } // one bad batch never stops the rest; a rate limit pauses
        for (const a of chunk) {
          const best = (pairs as any[]).filter((p) => p.baseToken?.address?.toLowerCase() === a.identifier.toLowerCase())
            .sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0];
          if (!best) continue;
          await q(`UPDATE assets SET last_price=$2, change_24h=$3, volume_24h=$4, liquidity_usd=$5, market_cap=$6, price_source='dexscreener', price_updated_at=now(),
                    lifecycle=CASE WHEN $7='pumpfun' THEN 'bonding_curve' WHEN $7='pumpswap' THEN 'graduated' ELSE lifecycle END WHERE id=$1`,
            [a.id, Number(best.priceUsd), best.priceChange?.h24 ?? 0, best.volume?.h24 ?? null, best.liquidity?.usd ?? null, best.marketCap ?? best.fdv ?? null, best.dexId]);
          await recordTick(a.id, Number(best.priceUsd), "dexscreener");
          n++;
        }
      }
    }
    counts.dexscreener = n;
    if (n > 0) dexOk();
  }

  for (const pid of ["alpaca_trading", "alpaca_broker"] as const) {
    const penv = (await providerUsable(pid, "production")) ? "production" : (await providerUsable(pid, "sandbox")) ? "sandbox" : null;
    if (!penv) continue;
    const ctx = contextFor(pid, penv);
    const stocks = await q<AssetRow>("SELECT * FROM assets WHERE asset_class IN ('stock','etf') AND venue IN ('XNAS','XNYS','ARCX','BATS')");
    const headers: Record<string, string> = pid === "alpaca_trading"
      ? { "APCA-API-KEY-ID": (await ctx.cred("ALPACA_API_KEY"))!, "APCA-API-SECRET-KEY": (await ctx.cred("ALPACA_API_SECRET"))! }
      : { Authorization: `Basic ${Buffer.from(`${await ctx.cred("ALPACA_BROKER_API_KEY")}:${await ctx.cred("ALPACA_BROKER_API_SECRET")}`).toString("base64")}` };
    // Free Alpaca market data is the IEX feed — real-time for IEX only, so label it.
    const feed = (await ctx.setting("data_feed")) ?? "iex";
    const base = pid === "alpaca_trading" ? "https://data.alpaca.markets" : (penv === "sandbox" ? "https://data.sandbox.alpaca.markets" : "https://data.alpaca.markets");
    const snap = await readJson(await ctx.fetch(`${base}/v2/stocks/snapshots?symbols=${stocks.map((s) => s.symbol).join(",")}&feed=${feed}`, { headers }), pid);
    let n = 0;
    for (const s of stocks) {
      const d = snap?.[s.symbol];
      const px = d?.latestTrade?.p ?? d?.minuteBar?.c;
      if (!px) continue;
      const prev = d?.prevDailyBar?.c;
      await q(`UPDATE assets SET last_price=$2, change_24h=$3, volume_24h=$4, price_source=$5, price_updated_at=now() WHERE id=$1`,
        [s.id, px, prev ? ((px - prev) / prev) * 100 : 0, d?.dailyBar?.v ? d.dailyBar.v * px : null, `${pid}:${feed === "sip" ? "sip" : "iex"}`]);
      await recordTick(s.id, px, `${pid}:${feed === "sip" ? "sip" : "iex"}`);
      n++;
    }
    counts[pid] = n;
    break;
  }
  if (Object.keys(counts).length) await publish("market", "refresh", counts);
  return counts;
}

/** Discover new tokens from DEX Screener's latest token profiles (only when connected). */
export async function discoverLaunches(): Promise<number> {
  if (!dexReady() || !(await providerUsable("dexscreener", "production"))) return 0;
  const ctx = contextFor("dexscreener", "production");
  let profiles: any[];
  try { profiles = await readJson(await ctx.fetch("https://api.dexscreener.com/token-profiles/latest/v1"), "dexscreener"); }
  catch (e: any) { dexBackoff(e, "launch_discovery"); return 0; }
  // Only tokens we don't know yet (known ones are refreshed by the price loop), looked up in batches of 30 per chain
  // instead of one request per token.
  const fresh = (profiles ?? []).slice(0, 50).filter((p: any) => DEX_CHAIN[p.chainId] && p.tokenAddress);
  const known = new Set((await q<{ k: string }>("SELECT venue || ':' || lower(identifier) AS k FROM assets WHERE venue || ':' || lower(identifier) = ANY($1)",
    [fresh.map((p: any) => `${p.chainId}:${String(p.tokenAddress).toLowerCase()}`)])).map((r) => r.k));
  const todo = fresh.filter((p: any) => !known.has(`${p.chainId}:${String(p.tokenAddress).toLowerCase()}`));
  const pairsByToken = new Map<string, any[]>();
  const byChain = new Map<string, string[]>();
  for (const p of todo) byChain.set(p.chainId, [...(byChain.get(p.chainId) ?? []), p.tokenAddress]);
  for (const [chain, addrs] of byChain) for (let i = 0; i < addrs.length; i += 30) {
    try {
      const rows = await readJson(await ctx.fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${addrs.slice(i, i + 30).join(",")}`), "dexscreener");
      for (const pr of rows as any[]) { const k = String(pr.baseToken?.address ?? "").toLowerCase(); pairsByToken.set(k, [...(pairsByToken.get(k) ?? []), pr]); }
    } catch (e: any) { if (dexBackoff(e, "launch_discovery")) return 0; }
  }
  let n = 0;
  for (const p of todo) {
    const pairs = pairsByToken.get(String(p.tokenAddress).toLowerCase()) ?? [];
    const best = (pairs as any[]).sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0];
    if (!best?.baseToken) continue;
    // Token names/descriptions are untrusted text: stored as data, truncated, never fed to AI as instructions.
    const name = String(best.baseToken.name ?? "").slice(0, 80);
    const symbol = String(best.baseToken.symbol ?? "").slice(0, 20);
    const flags = ["new_listing", "unverified"];
    if ((best.liquidity?.usd ?? 0) < 50_000) flags.push("low_liquidity");
    const providers = p.chainId === "solana" ? ["jupiter", ...(best.dexId?.startsWith("pump") ? ["pumpfun"] : [])] : ["zerox"];
    const row = await one<{ id: string }>(
      `INSERT INTO assets (asset_class, symbol, name, venue, identifier, tradability, lifecycle, categories, risk_flags, last_price, change_24h,
         volume_24h, liquidity_usd, market_cap, price_source, price_updated_at, launched_at, logo_url)
       VALUES ('crypto',$1,$2,$3,$4,'paper_tradable',$5,'{meme,new}',$6,$7,$8,$9,$10,$11,'dexscreener',now(),to_timestamp($12/1000.0),$13)
       ON CONFLICT (venue, identifier) DO UPDATE SET last_price=EXCLUDED.last_price, liquidity_usd=EXCLUDED.liquidity_usd,
         volume_24h=EXCLUDED.volume_24h, price_updated_at=now(), lifecycle=EXCLUDED.lifecycle RETURNING id`,
      [symbol, name, p.chainId, p.tokenAddress, best.dexId === "pumpfun" ? "bonding_curve" : best.dexId === "pumpswap" ? "graduated" : null,
       flags, Number(best.priceUsd ?? 0), best.priceChange?.h24 ?? 0, best.volume?.h24 ?? null, best.liquidity?.usd ?? null,
       best.marketCap ?? best.fdv ?? null, best.pairCreatedAt ?? Date.now(), p.icon ?? null]);
    if (row) {
      for (const pid of providers) await q("INSERT INTO asset_providers (asset_id, provider_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [row.id, pid]);
      await q("INSERT INTO asset_identifiers (asset_id, scheme, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [row.id, p.chainId === "solana" ? "mint" : "contract", `${p.chainId}:${p.tokenAddress}`]);
      n++;
    }
  }
  if (n) await publish("launches", "new_tokens", { count: n });
  return n;
}

/**
 * Add one token to the catalog by its contract/mint address (DEX Screener), so it can be priced and traded right away.
 * Used by Mimic when a copied wallet buys a coin Merod hasn't listed yet. Returns the asset row, or null if DEX Screener
 * has no trading pair for it.
 */
export async function importDexToken(chain: string, address: string): Promise<{ id: string; symbol: string; last_price: string; asset_class: string } | null> {
  const known = await one<any>("SELECT id, symbol, last_price, asset_class FROM assets WHERE venue=$1 AND identifier=$2", [chain, address]);
  if (known) return known;
  const { providerFetch } = await import("../providers/http");
  const rows = await readJson(await providerFetch("dexscreener", "production", `https://api.dexscreener.com/tokens/v1/${DEX_CHAIN[chain] ?? chain}/${address}`, { timeoutMs: 10_000 }), "dexscreener");
  const best = (rows as any[] ?? []).filter((p) => String(p.baseToken?.address ?? "") === address).sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0];
  if (!best?.baseToken || !(Number(best.priceUsd) > 0)) return null;
  const flags = ["unverified", ...((best.liquidity?.usd ?? 0) < 50_000 ? ["low_liquidity"] : []), ...(best.pairCreatedAt && Date.now() - best.pairCreatedAt < 7 * 86_400_000 ? ["new_listing"] : [])];
  const row = await one<any>(
    `INSERT INTO assets (asset_class, symbol, name, venue, identifier, tradability, lifecycle, categories, risk_flags, last_price, change_24h,
       volume_24h, liquidity_usd, market_cap, price_source, price_updated_at, launched_at, logo_url)
     VALUES ('crypto',$1,$2,$3,$4,'paper_tradable',$5,'{meme}',$6,$7,$8,$9,$10,$11,'dexscreener',now(),to_timestamp($12/1000.0),$13)
     ON CONFLICT (venue, identifier) DO UPDATE SET last_price=EXCLUDED.last_price, liquidity_usd=EXCLUDED.liquidity_usd, volume_24h=EXCLUDED.volume_24h, price_updated_at=now()
     RETURNING id, symbol, last_price, asset_class`,
    [String(best.baseToken.symbol ?? "").slice(0, 20), String(best.baseToken.name ?? "").slice(0, 80), chain, address,
     best.dexId === "pumpfun" ? "bonding_curve" : best.dexId === "pumpswap" ? "graduated" : null, flags, Number(best.priceUsd), best.priceChange?.h24 ?? 0,
     best.volume?.h24 ?? null, best.liquidity?.usd ?? null, best.marketCap ?? best.fdv ?? null, best.pairCreatedAt ?? Date.now(), best.info?.imageUrl ?? null]);
  if (row) {
    for (const pid of chain === "solana" ? ["jupiter", ...(best.dexId?.startsWith("pump") ? ["pumpfun"] : [])] : ["zerox"]) await q("INSERT INTO asset_providers (asset_id, provider_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [row.id, pid]);
    await q("INSERT INTO asset_identifiers (asset_id, scheme, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [row.id, chain === "solana" ? "mint" : "contract", `${chain}:${address}`]);
  }
  return row;
}

/** Sync the US equity catalog from Alpaca's asset endpoint (thousands of assets, no manual entry). */
export async function syncBrokerCatalog(): Promise<number> {
  const env = (await providerUsable("alpaca_trading", "production")) ? "production" : (await providerUsable("alpaca_trading", "sandbox")) ? "sandbox" : null;
  if (!env) return 0;
  const ctx = contextFor("alpaca_trading", env);
  const base = (await ctx.setting("base_url"))!;
  const list = await readJson(await ctx.fetch(`${base}/v2/assets?status=active&asset_class=us_equity`, {
    headers: { "APCA-API-KEY-ID": (await ctx.cred("ALPACA_API_KEY"))!, "APCA-API-SECRET-KEY": (await ctx.cred("ALPACA_API_SECRET"))! }, timeoutMs: 30_000 }), "alpaca_trading");
  const MIC: Record<string, string> = { NASDAQ: "XNAS", NYSE: "XNYS", ARCA: "ARCX", BATS: "BATS", AMEX: "XASE" };
  let n = 0;
  for (const a of list as any[]) {
    if (!a.tradable || !MIC[a.exchange]) continue;
    const row = await one<{ id: string }>(
      `INSERT INTO assets (asset_class, symbol, name, venue, identifier, tradability, categories) VALUES ('stock',$1,$2,$3,$1,'paper_tradable',$4)
       ON CONFLICT (venue, identifier) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [a.symbol, String(a.name ?? a.symbol).slice(0, 120), MIC[a.exchange], a.fractionable ? ["fractionable"] : []]);
    if (row) {
      await q("INSERT INTO asset_providers (asset_id, provider_id, provider_symbol) VALUES ($1,'alpaca_trading',$2) ON CONFLICT DO NOTHING", [row.id, a.symbol]);
      await q("INSERT INTO asset_identifiers (asset_id, scheme, value) VALUES ($1,'alpaca_id',$2) ON CONFLICT DO NOTHING", [row.id, a.id]);
      n++;
    }
  }
  return n;
}
