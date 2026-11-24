import "@/lib/server-only-shim";
import { q } from "../db";
import { extractAsset, setCatalog } from "../ai/parser";

/**
 * Articles & News: headlines from publishers' public RSS feeds. We show the headline, a short snippet, source and
 * time, and link to the original article (we never republish full articles). Feeds are cached for 5 minutes and a
 * feed that fails is simply skipped.
 */
export type NewsCategory = "stocks" | "crypto";
const FEEDS: { source: string; url: string; cat: NewsCategory }[] = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", cat: "crypto" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss", cat: "crypto" },
  { source: "Decrypt", url: "https://decrypt.co/feed", cat: "crypto" },
  { source: "CNBC Markets", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", cat: "stocks" },
  { source: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", cat: "stocks" },
  { source: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", cat: "stocks" },
];

export interface Article { id: string; title: string; url: string; source: string; category: NewsCategory; publishedAt: string | null; summary: string; image: string | null; symbols: string[] }

const cache = new Map<string, { at: number; items: Article[] }>();
let catalogAt = 0;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };
/** Decode CDATA and HTML entities (named, decimal and hex), including double-encoded ones like &amp;#x2019;. */
const decode = (s: string) => {
  let out = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let i = 0; i < 2; i++)
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
      return NAMED[e.toLowerCase()] ?? m;
    });
  return out.trim();
};
const strip = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? null;

export function parseFeed(xml: string, source: string, cat: NewsCategory): Article[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.slice(0, 30).flatMap((b) => {
    const title = strip(tag(b, "title") ?? "");
    let url = decode(tag(b, "link") ?? "") || (b.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ?? "");
    if (!/^https?:\/\//.test(url)) url = decode(tag(b, "guid") ?? "");
    if (!title || !/^https?:\/\//.test(url)) return [];
    const when = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const date = when ? new Date(strip(when)) : null;
    const image = b.match(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)/i)?.[1] ?? b.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i)?.[1] ?? null;
    const summary = strip(tag(b, "description") ?? tag(b, "summary") ?? "").slice(0, 280);
    return [{ id: Buffer.from(url).toString("base64url").slice(-24), title, url, source, category: cat, publishedAt: date && !isNaN(+date) ? date.toISOString() : null, summary, image: image && /^https:\/\//.test(image) ? image : null, symbols: [] }];
  });
}

async function ensureCatalog() {
  if (Date.now() - catalogAt < 600_000) return;
  catalogAt = Date.now();
  const rows = await q<{ symbol: string; name: string }>("SELECT symbol, name FROM assets WHERE NOT ('demo_data' = ANY(risk_flags)) ORDER BY volume_24h DESC NULLS LAST LIMIT 3000").catch(() => []);
  if (rows.length) setCatalog(rows.map((r) => r.symbol), rows.map((r) => [r.name, r.symbol] as [string, string]));
}
/** Tickers an article is about: $CASHTAGS plus the first company/coin name the parser recognises in the headline. */
function symbolsFor(a: Article) {
  const out = new Set<string>();
  for (const m of `${a.title} ${a.summary}`.matchAll(/\$([A-Z]{1,6})\b/g)) out.add(m[1]);
  const first = extractAsset(a.title);
  if (first.symbol && first.symbol.length <= 6) out.add(first.symbol);
  return [...out].slice(0, 5);
}

async function loadFeed(f: (typeof FEEDS)[number]): Promise<Article[]> {
  const hit = cache.get(f.url);
  if (hit && Date.now() - hit.at < 300_000) return hit.items;
  try {
    const res = await fetch(f.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MerodNewsReader/1.0 (+headlines with links)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    if (!res.ok) throw new Error(String(res.status));
    const xml = (await res.text()).slice(0, 2_000_000);
    const items = parseFeed(xml, f.source, f.cat).map((a) => ({ ...a, symbols: symbolsFor(a) }));
    cache.set(f.url, { at: Date.now(), items });
    return items;
  } catch {
    cache.set(f.url, { at: Date.now() - 240_000, items: hit?.items ?? [] }); // retry this feed in ~1 minute
    return hit?.items ?? [];
  }
}

export async function getNews(opts: { category?: NewsCategory | null; query?: string | null; symbol?: string | null; limit?: number }) {
  await ensureCatalog();
  const feeds = FEEDS.filter((f) => !opts.category || f.cat === opts.category);
  const all = (await Promise.all(feeds.map(loadFeed))).flat();
  const seen = new Set<string>();
  const qy = opts.query?.trim().toLowerCase();
  const sym = opts.symbol?.trim().toUpperCase();
  const items = all
    .filter((a) => !seen.has(a.title.toLowerCase()) && seen.add(a.title.toLowerCase()))
    .filter((a) => !qy || a.title.toLowerCase().includes(qy) || a.summary.toLowerCase().includes(qy) || a.symbols.some((s) => s.toLowerCase() === qy))
    .filter((a) => !sym || a.symbols.includes(sym) || a.title.toUpperCase().includes(sym))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, Math.min(opts.limit ?? 60, 120));
  const sources = feeds.map((f) => ({ source: f.source, category: f.cat, ok: (cache.get(f.url)?.items.length ?? 0) > 0 }));
  return { items, sources };
}
