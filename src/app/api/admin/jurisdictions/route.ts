import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { deleteJurisdiction, listJurisdictions, upsertJurisdiction } from "@/server/admin/service";

const Key = z.object({ country: z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code"), feature: z.string().min(2).max(60) });

export const GET = route(async () => { await requireAdmin(); return ok({ rules: await listJurisdictions() }); });
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const b = await parse(req, Key.extend({ allowed: z.boolean() }));
  await upsertJurisdiction(admin.id, b.country, b.feature, b.allowed);
  return ok({ ok: true });
});
export const DELETE = route(async (req) => {
  const admin = await requireAdmin();
  const b = await parse(req, Key);
  await deleteJurisdiction(admin.id, b.country, b.feature);
  return ok({ ok: true });
});
