import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q } from "@/server/db";

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const rows = await q(
    `SELECT * FROM notifications WHERE user_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at DESC LIMIT $3`,
    [u.id, kind, Math.min(Number(sp.get("limit") ?? 100), 300)]);
  const counts = await q("SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM notifications WHERE user_id=$1 GROUP BY kind", [u.id]);
  return ok({ notifications: rows, counts });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ ids: z.array(z.number()).optional(), all: z.boolean().optional() }));
  if (b.all) await q("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL", [u.id]);
  else if (b.ids?.length) await q("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2::bigint[])", [u.id, b.ids]);
  return ok({ ok: true });
});
