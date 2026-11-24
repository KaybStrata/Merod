import { requireAdmin } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { listAudit, verifyChain } from "@/server/admin/service";

/** GET: paginated audit log (filters: action, userId, before=<id>). */
export const GET = route(async (req) => {
  await requireAdmin();
  const sp = new URL(req.url).searchParams;
  const userId = sp.get("userId");
  return ok({
    entries: await listAudit({
      action: sp.get("action") || undefined,
      userId: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : undefined,
      before: sp.get("before") ? Number(sp.get("before")) : undefined,
      limit: Number(sp.get("limit") ?? 50),
    }),
  });
});

/** POST: verify the tamper-evident hash chain. */
export const POST = route(async () => {
  const admin = await requireAdmin();
  await rateLimit(`audit-verify:${admin.id}`, 5, 60);
  return ok({ result: await verifyChain(admin.id) });
});
