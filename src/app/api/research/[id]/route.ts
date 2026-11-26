import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { getNews } from "@/server/news/service";
import { indicators } from "@/server/agents/signals";

type Ctx = { params: Promise<{ id: string }> };
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
const POS = /surge|beat|upgrade|record|soar|approval|partnership|rally|raises|expands|strong|growth|launch/i;
const NEG = /plunge|lawsuit|probe|downgrade|miss|halt|hack|exploit|bankrupt|fraud|recall|sell-off|slump|cut|ban|restriction|tariff/i;

/**
 * Asset research: everything on the Research screen from REAL data only — price history (returns, 52-week range,
 * volatility, RSI/MACD trend), public headlines (tone by keyword), Merod social posts, peers and a screener of the
 * same category. The Merod Score is a transparent, deterministic blend of those inputs (shown with its parts),
 * never a forecast or advice. Fundamentals we don't have a provider for are returned as null.
 */
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const a = await one<any>("SELECT * FROM assets WHERE id=$1", [id]);
  if (!a) throw new HttpError(404, "Asset not found");
  const daily = (await q<any>("SELECT extract(epoch from ts)::bigint AS t, close, high, low, volume FROM price_bars WHERE asset_id=$1 AND timeframe='1d' ORDER BY ts DESC LIMIT 1900", [id])).reverse();
  const hourly = (await q<any>("SELECT close, volume, high, low FROM price_bars WHERE asset_id=$1 AND timeframe='1h' ORDER BY ts DESC LIMIT 200", [id])).reverse();
  const closes = daily.map((d) => Number(d.close));
  const px = a.last_price != null ? Number(a.last_price) : closes.at(-1) ?? null;
  const back = (n: number) => (closes.length > n ? closes[closes.length - 1 - n] : null);
  const ret = (n: number) => { const b = back(n); return px != null && b ? pct(px, b) : null; };
  const yr = closes.slice(-365);
  const rets = closes.slice(-91).map((c, i, arr) => (i ? Math.log(c / arr[i - 1]) : 0)).slice(1);
  const vol = rets.length > 5 ? Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length) * Math.sqrt(a.asset_class === "crypto" ? 365 : 252) * 100 : null;
  const ind = indicators({ close: hourly.map((h) => Number(h.close)), volume: hourly.map((h) => Number(h.volume)), high: hourly.map((h) => Number(h.high)), low: hourly.map((h) => Number(h.low)) }, px ?? undefined);
  let news: any[] = [];
  try {
    news = (await getNews({ symbol: a.symbol, limit: 12 })).items;
    if (news.length < 3 && a.name) news = [...news, ...(await getNews({ query: a.name.split(" ")[0], limit: 8 })).items].slice(0, 12);
  } catch { /* feeds down */ }
  const tagged = news.map((n) => ({ title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt, tone: POS.test(n.title) ? "Positive" : NEG.test(n.title) ? "Negative" : "Neutral",
    kind: /earnings|quarter|q[1-4]\b|guidance|revenue|eps/i.test(n.title) ? "Earnings" : /sec |filing|10-k|10-q|8-k/i.test(n.title) ? "Filings" : "News" }));
  const posN = tagged.filter((n) => n.tone === "Positive").length, negN = tagged.filter((n) => n.tone === "Negative").length;
  const newsScore = tagged.length ? Math.round(50 + ((posN - negN) / Math.max(1, tagged.length)) * 50) : null;
  const posts = await q<any>("SELECT body FROM social_posts WHERE visibility='public' AND created_at > now() - interval '14 days' AND (body ILIKE $1 OR $2 = ANY(tags)) LIMIT 300", [`%$${a.symbol}%`, a.symbol.toLowerCase()]);
  const bull = posts.filter((p) => /bull|long|buy|moon|breakout|undervalued|calls/i.test(p.body)).length, bear = posts.filter((p) => /bear|short|sell|dump|overvalued|puts|rug/i.test(p.body)).length;
  const socialScore = bull + bear ? Math.round(50 + ((bull - bear) / (bull + bear)) * 50) : null;
  const m1 = ret(30), m3 = ret(90), y1 = ret(365);
  const momentumScore = m1 == null ? null : Math.max(0, Math.min(100, Math.round(50 + m1 * 2)));
  const trendScore = ind.ema12 != null && ind.ema26 != null ? Math.max(0, Math.min(100, Math.round(50 + ((ind.ema12 - ind.ema26) / ind.ema26) * 2000 + ((ind.rsi14 ?? 50) - 50) / 2))) : null;
  const parts = ([["News", newsScore], ["Social", socialScore], ["Momentum", momentumScore], ["Trend", trendScore]] as [string, number | null][]).filter(([, v]) => v != null) as [string, number][];
  const sentiment = parts.length ? Math.round(parts.reduce((s, [, v]) => s + v, 0) / parts.length) : null;
  const score = sentiment == null ? null : Math.round(sentiment * 0.6 + (m3 == null ? 50 : Math.max(0, Math.min(100, 50 + m3))) * 0.4);
  const cat = (a.categories ?? []).find((c: string) => c !== "meme") ?? null;
  const peers = await q<any>(
    `SELECT id, symbol, name, last_price, change_24h, market_cap, logo_url,
            (SELECT array_agg(close ORDER BY ts) FROM (SELECT close, ts FROM price_bars b WHERE b.asset_id=assets.id AND b.timeframe='1d' ORDER BY ts DESC LIMIT 30) s) AS spark,
            (SELECT close FROM price_bars b WHERE b.asset_id=assets.id AND b.timeframe='1d' AND b.ts <= now() - interval '365 days' ORDER BY ts DESC LIMIT 1) AS y_ago
       FROM assets WHERE asset_class=$1 AND last_price IS NOT NULL AND NOT ('demo_data'=ANY(risk_flags)) AND ($2::text IS NULL OR $2 = ANY(categories)) AND market_cap IS NOT NULL
      ORDER BY (id=$3) DESC, market_cap DESC NULLS LAST LIMIT 12`, [a.asset_class, cat, id]);
  const watch = await one(`SELECT 1 FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id WHERE w.user_id=$1 AND wi.asset_id=$2`, [u.id, id]);
  const thesis = [
    `${a.name} (${a.symbol}) is ${a.asset_class === "crypto" ? "a crypto asset" : a.asset_class === "etf" ? "an ETF" : "a stock"} on ${a.venue}${a.market_cap ? ` with a market value of about ${Number(a.market_cap) >= 1e12 ? `$${(Number(a.market_cap) / 1e12).toFixed(2)}T` : `$${(Number(a.market_cap) / 1e9).toFixed(1)}B`}` : ""}.`,
    m3 != null ? `It is ${m3 >= 0 ? "up" : "down"} ${Math.abs(m3).toFixed(1)}% over 3 months and ${y1 != null ? `${y1 >= 0 ? "up" : "down"} ${Math.abs(y1).toFixed(1)}% over a year` : "has under a year of history in Merod"}.` : "",
    ind.rsi14 != null ? `Short-term trend is ${(ind.ema12 ?? 0) > (ind.ema26 ?? 0) ? "positive" : "negative"} (RSI ${ind.rsi14.toFixed(0)}${vol != null ? `, annualised volatility ${vol.toFixed(0)}%` : ""}).` : "",
  ].filter(Boolean).join(" ");
  const take = score == null ? null : score >= 65 ? "Bullish" : score <= 40 ? "Bearish" : "Neutral";
  return ok({
    asset: a, watched: !!watch, price: px, change24h: a.change_24h != null ? Number(a.change_24h) : null,
    change24hUsd: px != null && a.change_24h != null ? px - px / (1 + Number(a.change_24h) / 100) : null,
    asOf: a.price_updated_at, source: a.price_source, history: daily.map((d) => ({ t: Number(d.t), v: Number(d.close), vol: Number(d.volume) })),
    returns: { "1M": m1, "3M": m3, "6M": ret(182), "1Y": y1, "5Y": ret(1825) },
    thesis, tags: [...(a.categories ?? []).slice(0, 3), a.asset_class === "crypto" ? "Crypto" : a.venue].filter(Boolean),
    take, takeText: score == null ? "Not enough data yet." : `${take}. ${m1 != null ? `1-month move ${m1 >= 0 ? "+" : ""}${m1.toFixed(1)}%` : ""}${trendScore != null ? `, trend score ${trendScore}/100` : ""}${newsScore != null ? `, headline tone ${newsScore}/100 across ${tagged.length} recent articles` : ""}. Key risk: ${vol != null && vol > 60 ? "high volatility" : negN ? "negative headlines" : "a market-wide reversal"}.`,
    score, scoreParts: parts, sentiment, sentimentLabel: sentiment == null ? "No data" : sentiment >= 75 ? "Very Bullish" : sentiment >= 60 ? "Bullish" : sentiment > 40 ? "Neutral" : sentiment > 25 ? "Bearish" : "Very Bearish",
    metrics: { marketCap: a.market_cap != null ? Number(a.market_cap) : null, volume24h: a.volume_24h != null ? Number(a.volume_24h) : null, high52: yr.length ? Math.max(...yr) : null, low52: yr.length ? Math.min(...yr) : null,
      volatility: vol, rsi: ind.rsi14, liquidity: a.liquidity_usd != null ? Number(a.liquidity_usd) : null, return1y: y1 },
    news: tagged, catalysts: tagged.filter((n) => n.kind !== "News" || n.tone !== "Neutral").slice(0, 4).map((n) => ({ ...n, impact: n.kind === "Earnings" || n.tone === "Negative" ? "High" : "Med" })),
    peers: peers.map((p) => ({ ...p, last_price: Number(p.last_price), change_24h: Number(p.change_24h ?? 0), market_cap: Number(p.market_cap), spark: (p.spark ?? []).map(Number), y1: p.y_ago ? pct(Number(p.last_price), Number(p.y_ago)) : null })),
    category: cat, disclaimer: "Merod Score blends real headline tone, Merod social posts, 1-month momentum and the hourly trend. It is a data summary, not a forecast or investment advice.",
  });
});
