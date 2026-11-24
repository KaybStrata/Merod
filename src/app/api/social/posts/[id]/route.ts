import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { notify } from "@/server/engine/engine";
import { visibilitySql } from "@/server/social/service";

type Ctx = { params: Promise<{ id: string }> };

async function visiblePost(viewer: string, id: string) {
  const p = await one<any>(`SELECT p.* FROM social_posts p WHERE p.id=$2 AND ${visibilitySql("$1")}`, [viewer, id]);
  if (!p) throw new HttpError(404, "Post not found");
  return p;
}

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  await visiblePost(u.id, id);
  const comments = await q(`SELECT c.id, c.body, c.created_at, pr.handle, pr.display_name, pr.avatar_color, c.user_id=$2 AS mine
                              FROM post_comments c JOIN user_profiles pr ON pr.user_id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at`, [id, u.id]);
  return ok({ comments });
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("like") }), z.object({ action: z.literal("unlike") }),
  z.object({ action: z.literal("bookmark") }), z.object({ action: z.literal("unbookmark") }),
  z.object({ action: z.literal("comment"), body: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("delete_comment"), commentId: z.string().uuid() }),
]);

export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const b = await parse(req, Body);
  const p = await visiblePost(u.id, id);
  switch (b.action) {
    case "like": await q("INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, u.id]); break;
    case "unlike": await q("DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2", [id, u.id]); break;
    case "bookmark": await q("INSERT INTO post_bookmarks (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, u.id]); break;
    case "unbookmark": await q("DELETE FROM post_bookmarks WHERE post_id=$1 AND user_id=$2", [id, u.id]); break;
    case "comment":
      await rateLimit(`comment:${u.id}`, 60, 3600);
      await q("INSERT INTO post_comments (post_id, user_id, body) VALUES ($1,$2,$3)", [id, u.id, b.body]);
      if (p.user_id !== u.id) await notify(p.user_id, "social", `@${u.handle} commented on your post`, b.body.slice(0, 120), `/social`);
      break;
    case "delete_comment": await q("DELETE FROM post_comments WHERE id=$1 AND user_id=$2", [b.commentId, u.id]); break;
  }
  return ok({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const r = await q("DELETE FROM social_posts WHERE id=$1 AND user_id=$2 RETURNING id", [id, u.id]);
  if (!r.length) throw new HttpError(404, "Post not found or not yours");
  return ok({ ok: true });
});
