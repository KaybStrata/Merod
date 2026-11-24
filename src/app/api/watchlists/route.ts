import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";

/** GET: watchlists with items and prices. POST {name}: create. DELETE ?id=: delete. */
export const GET = route(async () => {
  const u = await requireUser();
  const lists = await q<any>("SELECT id, name, created_at FROM watchlists WHERE user_id=$1 ORDER BY created_at", [u.id]);
  const items = await q<any>(
    `SELECT wi.watchlist_id, wi.target_price, wi.added_at, a.id, a.symbol, a.name, a.venue, a.asset_class, a.last_price, a.change_24h, a.price_source, a.risk_flags,
            (SELECT array_agg(close ORDER BY ts) FROM (SELECT close, ts FROM price_bars b WHERE b.asset_id=a.id AND b.timeframe='1h' ORDER BY ts DESC LIMIT 24) s) AS spark
       FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id JOIN assets a ON a.id=wi.asset_id WHERE w.user_id=$1 ORDER BY wi.added_at DESC`, [u.id]);
  return ok({ watchlists: lists.map((l) => ({ ...l, items: items.filter((i) => i.watchlist_id === l.id) })) });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const { name } = await parse(req, z.object({ name: z.string().min(1).max(60) }));
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM watchlists WHERE user_id=$1", [u.id]);
  if ((n?.n ?? 0) >= 20) throw new HttpError(400, "Maximum 20 watchlists");
  return ok({ watchlist: await one("INSERT INTO watchlists (user_id, name) VALUES ($1,$2) RETURNING *", [u.id, name]) });
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  await q("DELETE FROM watchlists WHERE id=$1 AND user_id=$2", [id, u.id]);
  return ok({ ok: true });
});
