import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { autonPnl } from "@/server/auton/pnl";

/** GET ?range=<seconds> (omit for all time) → Auton's own P&L for the period, the previous period, and the running line. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const r = Number(new URL(req.url).searchParams.get("range"));
  return ok(await autonPnl(u.id, Number.isFinite(r) && r >= 60 ? Math.min(r, 10 * 365 * 86_400) : null));
});
