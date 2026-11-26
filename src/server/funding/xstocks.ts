import "@/lib/server-only-shim";
import { one, q } from "../db";
import { getCredential } from "../providers/credentials";

/**
 * Tokenized stocks on Solana (xStocks, e.g. AAPLx, TSLAx, NVDAx). Mints are never hardcoded: they are
 * resolved at runtime from Jupiter's token search, keeping only VERIFIED tokens named "… xStock".
 * Each is imported as a Solana asset (Jupiter route) so a Merod Wallet can buy it with USDC/SOL. The price
 * then refreshes with the normal DEX Screener loop. They track the share price but are NOT shares at a broker.
 */
export interface XStock { id: string; symbol: string; name: string; mint: string; price: number | null; change24h: number | null; logo: string | null }

/** Keep only verified "<Company> xStock" tokens whose symbol ends in "x" (pure, unit-tested). */
export function pickXStocks(list: any[]): { mint: string; symbol: string; name: string; price: number | null; change: number | null; logo: string | null }[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const t of Array.isArray(list) ? list : []) {
    const mint = String(t?.id ?? t?.address ?? t?.mint ?? "");
    const symbol = String(t?.symbol ?? "");
    const name = String(t?.name ?? "");
    const verified = t?.isVerified === true || (Array.isArray(t?.tags) && t.tags.includes("verified"));
    if (!verified || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !/xstock$/i.test(name.trim()) || !/^[A-Z.]{1,8}x$/.test(symbol) || seen.has(mint)) continue;
    seen.add(mint);
    out.push({ mint, symbol: symbol.slice(0, 20), name: name.slice(0, 80), price: Number.isFinite(Number(t?.usdPrice)) ? Number(t.usdPrice) : null,
      change: Number.isFinite(Number(t?.stats24h?.priceChange)) ? Number(t.stats24h.priceChange) : null, logo: typeof t?.icon === "string" ? t.icon : null });
  }
  return out;
}

let cache: { at: number; rows: XStock[] } | null = null;
export async function listXStocks(force = false): Promise<{ rows: XStock[]; error: string | null }> {
  if (!force && cache && Date.now() - cache.at < 30 * 60_000) return { rows: cache.rows, error: null };
  try {
    const key = await getCredential("jupiter", "production", "JUPITER_API_KEY");
    const r = await fetch("https://api.jup.ag/tokens/v2/search?query=xStock", { headers: key ? { "x-api-key": key } : {}, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Jupiter token search answered ${r.status}`);
    const picked = pickXStocks(await r.json());
    const rows: XStock[] = [];
    for (const t of picked) {
      const row = await one<{ id: string }>(
        `INSERT INTO assets (asset_class, symbol, name, venue, identifier, tradability, categories, risk_flags, last_price, change_24h, price_source, price_updated_at, logo_url)
         VALUES ('crypto',$1,$2,'solana',$3,'paper_tradable','{tokenized_stock,xstock}','{}',$4,$5,$6,CASE WHEN $4::numeric IS NULL THEN NULL ELSE now() END,$7)
         ON CONFLICT (venue, identifier) DO UPDATE SET categories=(SELECT array_agg(DISTINCT c) FROM unnest(assets.categories || '{tokenized_stock,xstock}'::text[]) c),
           last_price=COALESCE(EXCLUDED.last_price, assets.last_price), change_24h=COALESCE(EXCLUDED.change_24h, assets.change_24h),
           price_updated_at=CASE WHEN EXCLUDED.last_price IS NULL THEN assets.price_updated_at ELSE now() END, logo_url=COALESCE(assets.logo_url, EXCLUDED.logo_url)
         RETURNING id`,
        [t.symbol, t.name, t.mint, t.price, t.change, t.price != null ? "jupiter" : null, t.logo]);
      if (!row) continue;
      await q("INSERT INTO asset_providers (asset_id, provider_id) VALUES ($1,'jupiter') ON CONFLICT DO NOTHING", [row.id]);
      await q("INSERT INTO asset_identifiers (asset_id, scheme, value) VALUES ($1,'mint',$2) ON CONFLICT DO NOTHING", [row.id, `solana:${t.mint}`]);
      rows.push({ id: row.id, symbol: t.symbol, name: t.name, mint: t.mint, price: t.price, change24h: t.change, logo: t.logo });
    }
    cache = { at: Date.now(), rows };
    return { rows, error: null };
  } catch (e: any) {
    // Fall back to xStocks imported earlier.
    const rows = await q<any>("SELECT id, symbol, name, identifier AS mint, last_price, change_24h, logo_url FROM assets WHERE venue='solana' AND 'xstock'=ANY(categories) ORDER BY symbol");
    return { rows: rows.map((r) => ({ id: r.id, symbol: r.symbol, name: r.name, mint: r.mint, price: r.last_price != null ? Number(r.last_price) : null, change24h: r.change_24h != null ? Number(r.change_24h) : null, logo: r.logo_url })), error: String(e?.message ?? e).slice(0, 200) };
  }
}
