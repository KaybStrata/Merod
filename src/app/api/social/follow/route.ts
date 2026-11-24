import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { notify } from "@/server/engine/engine";

const Body = z.object({ handle: z.string().min(1).max(30), follow: z.boolean() });

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`follow:${u.id}`, 120, 3600);
  const b = await parse(req, Body);
  const target = await one<{ user_id: string }>("SELECT user_id FROM user_profiles WHERE lower(handle)=lower($1)", [b.handle]);
  if (!target) throw new HttpError(404, "User not found");
  if (target.user_id === u.id) throw new HttpError(400, "You can't follow yourself");
  if (b.follow) {
    const r = await q("INSERT INTO followers (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1", [u.id, target.user_id]);
    if (r.length) await notify(target.user_id, "social", `@${u.handle} started following you`, "", `/social/${u.handle}`);
  } else await q("DELETE FROM followers WHERE follower_id=$1 AND followee_id=$2", [u.id, target.user_id]);
  return ok({ following: b.follow });
});
