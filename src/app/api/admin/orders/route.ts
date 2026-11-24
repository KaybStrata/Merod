import { requireAdmin } from "@/server/auth";
import { ok, route } from "@/server/http";
import { tradingActivity } from "@/server/admin/service";

export const GET = route(async () => {
  await requireAdmin();
  return ok(await tradingActivity());
});
