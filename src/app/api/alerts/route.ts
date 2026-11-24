import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";

export const GET = route(async () => {
  const u = await requireUser();
  const alerts = await q(
    `SELECT pa.*, a.symbol, a.name, a.last_price, a.price_source FROM price_alerts pa JOIN assets a ON a.id=pa.asset_id
      WHERE pa.user_id=$1 ORDER BY pa.triggered_at IS NOT NULL, pa.created_at DESC LIMIT 200`, [u.id]);
  return ok({ alerts });
});

const Body = z.object({ assetId: z.string().uuid(), direction: z.enum(["above", "below"]), price: z.number().positive() });
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`alerts:${u.id}`, 60, 3600);
  const b = await parse(req, Body);
  if (!(await one("SELECT 1 FROM assets WHERE id=$1", [b.assetId]))) throw new HttpError(404, "Asset not found");
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM price_alerts WHERE user_id=$1 AND triggered_at IS NULL", [u.id]);
  if ((n?.n ?? 0) >= 100) throw new HttpError(400, "Limit of 100 active alerts reached");
  const alert = await one("INSERT INTO price_alerts (user_id, asset_id, direction, price) VALUES ($1,$2,$3,$4) RETURNING *", [u.id, b.assetId, b.direction, b.price]);
  return ok({ alert });
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  await q("DELETE FROM price_alerts WHERE id=$1 AND user_id=$2", [id, u.id]);
  return ok({ ok: true });
});
