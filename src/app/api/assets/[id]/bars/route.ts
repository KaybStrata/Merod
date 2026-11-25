import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };
const TF = new Set(["1m", "5m", "1h", "1d"]);

/** OHLCV bars for charts. `source` tells the UI whether bars are simulated or from a provider. */
export const GET = route<Ctx>(async (req, { params }) => {
  await requireUser();
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const tf = TF.has(sp.get("tf") ?? "") ? sp.get("tf")! : "1h";
  const limit = Math.min(Number(sp.get("limit") ?? 500), 2000);
  const since = Number(sp.get("since") ?? 0) || 0; // optional window start (unix seconds)
  const rows = await q<any>(
    `SELECT extract(epoch from ts)::bigint AS time, open, high, low, close, volume, source FROM price_bars WHERE asset_id=$1 AND timeframe=$2 AND ts >= to_timestamp($4) ORDER BY ts DESC LIMIT $3`, [id, tf, limit, since]);
  rows.reverse();
  return ok({ timeframe: tf, bars: rows, source: rows.at(-1)?.source ?? null });
});
