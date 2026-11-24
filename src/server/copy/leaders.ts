import "@/lib/server-only-shim";
import { q } from "../db";
import type { MimicScope } from "./service";

/**
 * "Mimic trade the top ROI earner for Solana meme coins this week" → find that trader and propose a mimic bot.
 * Only Merod traders who turned on "Let others copy my trades" are ranked. ROI = realized profit ÷ money put into buys,
 * over the window, counting only trades inside the scope.
 */
export type MimicRequest = { scope: MimicScope; windowDays: number; windowLabel: string };

const FIX: [RegExp, string][] = [
  [/\b(mimc|mimick?|mimik|mimmic|minic)\w*/g, "mimic"], [/\bcopt\b|\bcoppy\b/g, "copy"],
  [/\b(solona|solan|soalna|solanna|sol)\b/g, "solana"], [/\bmeme ?coins?\b|\bmemecoins?\b|\bmemes\b|\bmeem\w*/g, "meme"],
  [/\b(ethereum|eth|ether)\b/g, "ethereum"], [/\bbase chain\b/g, "base"], [/\b(r\.?o\.?i|rio)\b/g, "roi"],
];

export function parseMimicRequest(raw: string): MimicRequest | null {
  let t = ` ${raw.toLowerCase().replace(/[^a-z0-9$.#'\s-]/g, " ")} `;
  for (const [re, to] of FIX) t = t.replace(re, to);
  if (!/\b(mimic|copy|follow)\b/.test(t)) return null;
  if (!/\b(top|best|highest|most profitable|biggest|leading|number one)\b|#1|\bno\.? ?1\b/.test(t)) return null;
  if (!/\b(roi|earners?|traders?|performers?|gainers?|winners?|profits?|returns?|users?|person)\b/.test(t)) return null;

  const windowDays = /\b(today|day|daily|24 ?h(ours?)?)\b/.test(t) ? 1 : /\bmonth|30 ?d\b/.test(t) ? 30 : /\byear\b|\b365\b/.test(t) ? 365 : 7;
  const windowLabel = windowDays === 1 ? "today (last 24h)" : windowDays === 7 ? "this week" : windowDays === 30 ? "this month" : "this year";

  const scope: MimicScope = { label: "all markets" };
  const meme = /\bmeme\b/.test(t);
  const venue = /\bsolana\b/.test(t) ? "solana" : /\bethereum\b/.test(t) ? "ethereum" : /\bbase\b/.test(t) ? "base" : /\b(bsc|bnb)\b/.test(t) ? "bsc" : undefined;
  if (meme) scope.meme = true;
  if (venue) scope.venue = venue;
  if (meme || venue || /\b(crypto|coins?|tokens?)\b/.test(t)) scope.assetClasses = ["crypto"];
  else if (/\b(stocks?|equit(y|ies)|shares?|etfs?)\b/.test(t)) scope.assetClasses = ["stock", "etf"];
  const sym = raw.match(/\$([A-Za-z][A-Za-z0-9]{0,9})\b/);
  if (sym) { scope.symbol = sym[1].toUpperCase(); delete scope.assetClasses; }
  const venueName: Record<string, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", bsc: "BNB Chain" };
  scope.label = scope.symbol ? `$${scope.symbol}`
    : [venue ? venueName[venue] : null, meme ? "meme coins" : scope.assetClasses?.[0] === "crypto" ? "crypto" : scope.assetClasses ? "stocks" : null].filter(Boolean).join(" ") || "all markets";
  return { scope, windowDays, windowLabel };
}

export type RankedLeader = { userId: string; handle: string; displayName: string; roi: number; pnl: number; invested: number; trades: number };

/** Best ROI among consenting Merod traders over the window, scope applied. Needs at least $10 bought and one closed trade. */
export async function topRoiLeaders(followerId: string, req: MimicRequest, limit = 3): Promise<RankedLeader[]> {
  const s = req.scope;
  const rows = await q<any>(
    `WITH f AS (
       SELECT o.user_id, o.side, o.realized_pnl, COALESCE(NULLIF(o.filled_quantity * o.avg_fill_price, 0), o.notional_usd, 0) AS notional
         FROM orders o JOIN assets a ON a.id=o.asset_id JOIN user_profiles p ON p.user_id=o.user_id
        WHERE o.status IN ('filled','partially_filled') AND o.source <> 'copy' AND p.allow_copy_trading AND o.user_id <> $1
          AND o.updated_at > now() - make_interval(days => $2::int)
          AND ($3::text[] IS NULL OR a.asset_class = ANY($3::text[]))
          AND ($4::text IS NULL OR lower(a.venue) = $4::text)
          AND (NOT $5::boolean OR EXISTS (SELECT 1 FROM unnest(a.categories) c WHERE c ILIKE '%meme%'))
          AND ($6::text IS NULL OR upper(a.symbol) = $6::text))
     SELECT f.user_id, p.handle, p.display_name, count(*)::int AS trades,
            SUM(f.realized_pnl) AS pnl, SUM(CASE WHEN f.side='buy' THEN f.notional ELSE 0 END) AS invested
       FROM f JOIN user_profiles p ON p.user_id=f.user_id
      GROUP BY f.user_id, p.handle, p.display_name
     HAVING SUM(CASE WHEN f.side='buy' THEN f.notional ELSE 0 END) >= 10 AND SUM(CASE WHEN f.side='sell' THEN 1 ELSE 0 END) >= 1
      ORDER BY SUM(f.realized_pnl) / NULLIF(SUM(CASE WHEN f.side='buy' THEN f.notional ELSE 0 END),0) DESC, SUM(f.realized_pnl) DESC
      LIMIT $7`,
    [followerId, req.windowDays, s.assetClasses ?? null, s.venue ?? null, !!s.meme, s.symbol ?? null, limit]);
  return rows.map((r) => ({ userId: r.user_id, handle: r.handle, displayName: r.display_name, trades: r.trades,
    pnl: Number(r.pnl), invested: Number(r.invested), roi: Number(r.pnl) / Number(r.invested) }));
}
