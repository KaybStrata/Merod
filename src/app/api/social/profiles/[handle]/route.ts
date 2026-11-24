import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { feed, performance } from "@/server/social/service";

type Ctx = { params: Promise<{ handle: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { handle } = await params;
  const p = await one<any>(
    `SELECT pr.user_id, pr.handle, pr.display_name, pr.bio, pr.avatar_color, pr.is_public, pr.share_performance, pr.created_at,
            (SELECT count(*)::int FROM followers WHERE followee_id=pr.user_id) AS followers,
            (SELECT count(*)::int FROM followers WHERE follower_id=pr.user_id) AS following,
            EXISTS (SELECT 1 FROM followers WHERE follower_id=$2 AND followee_id=pr.user_id) AS is_following
       FROM user_profiles pr WHERE lower(pr.handle)=lower($1)`, [handle, u.id]);
  if (!p) throw new HttpError(404, "Profile not found");
  const self = p.user_id === u.id;
  if (!p.is_public && !self) return ok({ profile: { handle: p.handle, display_name: p.display_name, is_public: false }, posts: [], performance: null, strategies: [], self });
  const posts = await feed(u.id, { authorId: p.user_id, limit: 50 });
  // Performance only with explicit consent (or to the owner).
  const perf = p.share_performance || self ? await performance(p.user_id) : null;
  // Public strategies: strategy + parameters only; no account, budget or balance details.
  const strategies = p.share_performance || self
    ? await q(`SELECT b.name, b.strategy_id, s.name AS strategy_name, b.params, b.is_paper, b.status, b.created_at
                 FROM trading_bots b JOIN bot_strategies s ON s.id=b.strategy_id WHERE b.user_id=$1 AND b.status IN ('running','paused') ORDER BY b.created_at DESC LIMIT 20`, [p.user_id])
    : [];
  const { user_id: _id, ...profile } = p;
  return ok({ profile: { ...profile, post_count: posts.length }, posts, performance: perf, strategies, self });
});
