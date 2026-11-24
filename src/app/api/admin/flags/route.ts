import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { listFlags, setFlag } from "@/server/admin/service";

export const GET = route(async () => {
  await requireAdmin();
  return ok({ flags: await listFlags() });
});

/** Toggle a feature flag. Approval-gated flags need a reference + 2FA; real-money flags also need MEROD_ALLOW_LIVE_FLAGS=true. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  await rateLimit(`flags:${admin.id}`, 20, 300);
  const b = await parse(req, z.object({ key: z.string().max(60), enabled: z.boolean(), approvalReference: z.string().max(200).optional(), code: z.string().max(8).optional() }));
  await setFlag(admin.id, b.key, b.enabled, b.approvalReference, b.code);
  return ok({ ok: true });
});
