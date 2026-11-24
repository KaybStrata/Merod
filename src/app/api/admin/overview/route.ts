import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { overview, setPricing } from "@/server/admin/service";

export const GET = route(async () => {
  await requireAdmin();
  return ok(await overview());
});

/** Set the per-provider pricing used for cost estimates (USD per 1,000 requests; null clears). */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const b = await parse(req, z.object({ providerId: z.string().max(60), costPer1k: z.number().min(0).max(100000).nullable() }));
  await setPricing(admin.id, b.providerId, b.costPer1k);
  return ok({ ok: true });
});
