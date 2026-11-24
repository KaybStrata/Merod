import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/**
 * Universal asset search & discovery. Filters: q (symbol/name/contract), class, venue, sort,
 * minCap, maxCap, minLiq, category, new=1, limit. Includes 24h sparkline from 1h bars.
 */
export const GET = route(async (req) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const term = sp.get("q")?.trim() ?? "";
  const cls = sp.get("class");
  const venue = sp.get("venue");
  const category = sp.get("category");
  const isNew = sp.get("new") === "1";
  const minCap = sp.get("minCap") ? Number(sp.get("minCap")) : null;
  const maxCap = sp.get("maxCap") ? Number(sp.get("maxCap")) : null;
  const minLiq = sp.get("minLiq") ? Number(sp.get("minLiq")) : null;
  // Interpolated into SQL text below, so it must be a clamped integer.
  const limit = Math.max(1, Math.min(Math.floor(Number(sp.get("limit") ?? 50)) || 50, 200));
  const sort = ({ gainers: "change_24h DESC NULLS LAST", losers: "change_24h ASC NULLS LAST", volume: "volume_24h DESC NULLS LAST", cap: "market_cap DESC NULLS LAST", new: "launched_at DESC NULLS LAST", liquidity: "liquidity_usd DESC NULLS LAST" } as Record<string, string>)[sp.get("sort") ?? ""] ?? "market_cap DESC NULLS LAST";
  const where: string[] = []; const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (term) {
    const t = p(term), like = p(`%${term.toLowerCase()}%`);
    where.push(`(upper(symbol)=upper(${t}) OR lower(name) LIKE ${like} OR lower(identifier)=lower(${t}) OR lower(symbol) LIKE ${like})`);
  }
  if (cls === "stocks") where.push("asset_class IN ('stock','etf')"); else if (cls === "crypto") where.push("asset_class='crypto'");
  if (venue) where.push(`venue=${p(venue)}`);
  if (category) where.push(`${p(category)} = ANY(categories)`);
  if (isNew) where.push("launched_at IS NOT NULL");
  if (minCap != null) where.push(`market_cap >= ${p(minCap)}`);
  if (maxCap != null) where.push(`market_cap <= ${p(maxCap)}`);
  if (minLiq != null) where.push(`liquidity_usd >= ${p(minLiq)}`);
  const order = term ? `(upper(symbol)=upper($1)) DESC, ${sort}` : sort;
  const assets = await q(
    `SELECT a.id, a.asset_class, a.symbol, a.name, a.venue, a.identifier, a.tradability, a.lifecycle, a.categories, a.risk_flags, a.last_price, a.change_24h,
            a.volume_24h, a.market_cap, a.liquidity_usd, a.price_source, a.price_updated_at, a.launched_at, a.logo_url,
            (SELECT array_agg(provider_id) FROM asset_providers ap WHERE ap.asset_id=a.id) AS providers,
            (SELECT array_agg(close ORDER BY ts) FROM (SELECT close, ts FROM price_bars b WHERE b.asset_id=a.id AND b.timeframe='1h' ORDER BY ts DESC LIMIT 24) s) AS spark
       FROM assets a ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ${limit}`, params);
  const venues = await q<{ venue: string; asset_class: string; n: number }>("SELECT venue, min(asset_class) AS asset_class, count(*)::int AS n FROM assets GROUP BY venue ORDER BY n DESC");
  return ok({ assets, venues });
});
