import { z } from "zod";
import { requireAdmin, requireSuperAdmin, verifyStepUp } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { feeStats, getFeeConfig, setFeeConfig, describeFee, MAX_FEE_PCT } from "@/server/fees";

/** GET: current fee config + collected totals (admins can view). */
export const GET = route(async () => {
  const u = await requireAdmin();
  const cfg = await getFeeConfig();
  const history = await q(`SELECT c.created_at, c.reference AS reason, c.details, p.handle FROM compliance_records c LEFT JOIN user_profiles p ON p.user_id=c.created_by
                            WHERE c.kind='fee_change' ORDER BY c.created_at DESC LIMIT 20`);
  return ok({ config: cfg, description: describeFee(cfg), maxPct: MAX_FEE_PCT, stats: await feeStats(), history, canEdit: u.role === "super_admin" });
});

const Body = z.object({
  mode: z.enum(["performance", "commission"]),
  pct: z.number().min(0).max(MAX_FEE_PCT),
  reason: z.string().min(3).max(300),
  code: z.string().max(8),
});

/** PATCH: super admin only, with a fresh 2FA code. */
export const PATCH = route(async (req) => {
  const u = await requireSuperAdmin();
  const b = await parse(req, Body);
  if (!(await verifyStepUp(u.id, b.code))) throw new HttpError(401, "A valid 2FA code is required to change fees (enable 2FA in Settings → Security)");
  const config = await setFeeConfig(u.id, { mode: b.mode, pct: b.pct }, b.reason);
  return ok({ config, description: describeFee(config) });
});
