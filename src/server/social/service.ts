import "@/lib/server-only-shim";
import { one, q } from "../db";

/**
 * Social helpers. Visibility: public → everyone; followers → followers + owner; private → owner only.
 * Verification of tagged trades is ALWAYS computed server-side from the orders table.
 */
export function visibilitySql(viewerParam: string) {
  return `(p.visibility='public' OR p.user_id=${viewerParam}
           OR (p.visibility='followers' AND EXISTS (SELECT 1 FROM followers f WHERE f.follower_id=${viewerParam} AND f.followee_id=p.user_id)))`;
}

export async function verifyTaggedOrder(posterId: string, orderId: string | null | undefined): Promise<{ verification: "verified_live" | "simulated" | "unverified"; order: any | null }> {
  if (!orderId) return { verification: "unverified", order: null };
  const o = await one<any>("SELECT id, user_id, status, is_paper, side, avg_fill_price, asset_id FROM orders WHERE id=$1", [orderId]);
  if (!o || o.user_id !== posterId || o.status !== "filled") return { verification: "unverified", order: o && o.user_id === posterId ? o : null };
  return { verification: o.is_paper ? "simulated" : "verified_live", order: o };
}

export async function feed(viewerId: string, opts: { tab?: string; authorId?: string; limit?: number; before?: string | null }) {
  const params: unknown[] = [viewerId];
  const where = [visibilitySql("$1")];
  if (opts.authorId) { params.push(opts.authorId); where.push(`p.user_id=$${params.length}`); }
  if (opts.tab === "following") where.push("EXISTS (SELECT 1 FROM followers f WHERE f.follower_id=$1 AND f.followee_id=p.user_id)");
  if (opts.tab === "trades") where.push("p.kind='trade'");
  if (opts.tab === "analysis") where.push("p.kind='analysis'");
  if (opts.tab === "strategies") where.push("p.kind='strategy'");
  if (opts.tab === "bookmarks") where.push("EXISTS (SELECT 1 FROM post_bookmarks b WHERE b.post_id=p.id AND b.user_id=$1)");
  if (opts.before) { params.push(opts.before); where.push(`p.created_at < $${params.length}`); }
  params.push(Math.min(opts.limit ?? 30, 100));
  return q<any>(
    `SELECT p.id, p.kind, p.body, p.visibility, p.tags, p.created_at, p.user_id,
            pr.handle, pr.display_name, pr.avatar_color,
            (SELECT count(*)::int FROM post_likes l WHERE l.post_id=p.id) AS likes,
            (SELECT count(*)::int FROM post_comments c WHERE c.post_id=p.id) AS comments,
            EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,
            EXISTS (SELECT 1 FROM post_bookmarks b WHERE b.post_id=p.id AND b.user_id=$1) AS bookmarked,
            EXISTS (SELECT 1 FROM followers f WHERE f.follower_id=$1 AND f.followee_id=p.user_id) AS following,
            (SELECT json_agg(json_build_object('asset_id', t.asset_id, 'symbol', a.symbol, 'venue', a.venue, 'verification', t.verification,
                     'side', t.side, 'entry_price', t.entry_price, 'last_price', a.last_price, 'price_source', a.price_source))
               FROM tagged_trades t JOIN assets a ON a.id=t.asset_id WHERE t.post_id=p.id) AS tagged
       FROM social_posts p JOIN user_profiles pr ON pr.user_id=p.user_id
      WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT $${params.length}`, params);
}

/** Performance from FILLED orders only. Separates live (real) and paper (simulated). */
export async function performance(userId: string) {
  const rows = await q<any>(
    `SELECT is_paper, count(*)::int AS trades,
            count(*) FILTER (WHERE side='sell' AND realized_pnl > 0)::int AS wins,
            count(*) FILTER (WHERE side='sell' AND realized_pnl < 0)::int AS losses,
            COALESCE(sum(realized_pnl),0) AS realized_pnl,
            COALESCE(sum(CASE WHEN side='buy' THEN filled_quantity*avg_fill_price END),0) AS bought_usd
       FROM orders WHERE user_id=$1 AND status='filled' GROUP BY is_paper`, [userId]);
  const pack = (paper: boolean) => {
    const r = rows.find((x) => x.is_paper === paper);
    if (!r) return null;
    const closed = r.wins + r.losses;
    return { trades: r.trades, wins: r.wins, losses: r.losses, winRate: closed ? (r.wins / closed) * 100 : null, realizedPnl: Number(r.realized_pnl),
      returnPct: Number(r.bought_usd) > 0 ? (Number(r.realized_pnl) / Number(r.bought_usd)) * 100 : null };
  };
  return { live: pack(false), paper: pack(true) };
}
