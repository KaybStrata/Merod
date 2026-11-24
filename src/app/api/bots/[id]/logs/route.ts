import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** GET ?after=<logId>&level=... — activity log (observations, triggers, instructions, orders, results). */
export const GET = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  if (!(await one("SELECT 1 FROM trading_bots WHERE id=$1 AND user_id=$2", [id, u.id]))) throw new HttpError(404, "Bot not found");
  const sp = new URL(req.url).searchParams;
  const after = Number(sp.get("after") ?? 0);
  const level = sp.get("level");
  const logs = await q(
    `SELECT id, level, message, data, created_at FROM bot_activity_logs WHERE bot_id=$1 AND id > $2 AND ($3::text IS NULL OR level=$3) ORDER BY id DESC LIMIT 300`,
    [id, after, level]);
  return ok({ logs });
});
