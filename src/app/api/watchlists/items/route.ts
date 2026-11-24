import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";

const Body = z.object({
  assetId: z.string().uuid(),
  watchlistId: z.string().uuid().optional(),
  action: z.enum(["add", "remove", "toggle", "target"]).default("toggle"),
  targetPrice: z.number().positive().nullable().optional(),
});

/** Add/remove/toggle an asset on a watchlist (default: the user's first list) or set its target price. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, Body);
  const list = b.watchlistId
    ? await one<any>("SELECT id FROM watchlists WHERE id=$1 AND user_id=$2", [b.watchlistId, u.id])
    : (await one<any>("SELECT id FROM watchlists WHERE user_id=$1 ORDER BY created_at LIMIT 1", [u.id]))
      ?? (await one<any>("INSERT INTO watchlists (user_id, name) VALUES ($1,'My Watchlist') RETURNING id", [u.id]));
  if (!list) throw new HttpError(404, "Watchlist not found");
  if (!(await one("SELECT 1 FROM assets WHERE id=$1", [b.assetId]))) throw new HttpError(404, "Asset not found");
  const exists = await one("SELECT 1 FROM watchlist_items WHERE watchlist_id=$1 AND asset_id=$2", [list.id, b.assetId]);
  let watched = !!exists;
  if (b.action === "add" || (b.action === "toggle" && !exists) || (b.action === "target" && !exists)) {
    await q("INSERT INTO watchlist_items (watchlist_id, asset_id, target_price) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [list.id, b.assetId, b.targetPrice ?? null]);
    watched = true;
  } else if (b.action === "remove" || (b.action === "toggle" && exists)) {
    await q("DELETE FROM watchlist_items WHERE watchlist_id=$1 AND asset_id=$2", [list.id, b.assetId]);
    watched = false;
  }
  if (b.action === "target") await q("UPDATE watchlist_items SET target_price=$3 WHERE watchlist_id=$1 AND asset_id=$2", [list.id, b.assetId, b.targetPrice ?? null]);
  return ok({ watched, watchlistId: list.id });
});
