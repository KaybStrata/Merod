import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { flag } from "@/server/flags";

/** Leaderboard of users who consented (share_performance) — from FILLED orders only. Live and paper ranked separately. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const mode = new URL(req.url).searchParams.get("mode") === "live" ? false : true; // default paper
  const rows = await q<any>(
    `SELECT pr.handle, pr.display_name, pr.avatar_color,
            count(*)::int AS trades,
            count(*) FILTER (WHERE o.side='sell' AND o.realized_pnl > 0)::int AS wins,
            count(*) FILTER (WHERE o.side='sell' AND o.realized_pnl <> 0)::int AS closed,
            COALESCE(sum(o.realized_pnl),0) AS realized_pnl,
            COALESCE(sum(CASE WHEN o.side='buy' THEN o.filled_quantity*o.avg_fill_price END),0) AS bought_usd,
            (SELECT count(*)::int FROM followers f WHERE f.followee_id=pr.user_id) AS followers,
            EXISTS (SELECT 1 FROM followers f WHERE f.follower_id=$2 AND f.followee_id=pr.user_id) AS following
       FROM orders o JOIN user_profiles pr ON pr.user_id=o.user_id
      WHERE pr.share_performance AND pr.is_public AND o.status='filled' AND o.is_paper=$1
      GROUP BY pr.user_id, pr.handle, pr.display_name, pr.avatar_color
      ORDER BY COALESCE(sum(o.realized_pnl),0) DESC LIMIT 25`, [mode, u.id]);
  const popular = await q(
    `SELECT pr.handle, pr.display_name, pr.avatar_color, count(f.follower_id)::int AS followers,
            EXISTS (SELECT 1 FROM followers x WHERE x.follower_id=$1 AND x.followee_id=pr.user_id) AS following
       FROM user_profiles pr LEFT JOIN followers f ON f.followee_id=pr.user_id
      WHERE pr.is_public AND pr.user_id <> $1 GROUP BY pr.user_id ORDER BY followers DESC, pr.created_at DESC LIMIT 8`, [u.id]);
  return ok({
    mode: mode ? "paper" : "live",
    leaders: rows.map((r) => ({ ...r, winRate: r.closed ? (r.wins / r.closed) * 100 : null, returnPct: Number(r.bought_usd) > 0 ? (Number(r.realized_pnl) / Number(r.bought_usd)) * 100 : null })),
    popular,
    copyTradingEnabled: await flag("copy_trading"),
  });
});
