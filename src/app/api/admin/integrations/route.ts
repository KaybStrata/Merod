import { requireAdmin } from "@/server/auth";
import { ok, route } from "@/server/http";
import { listIntegrations } from "@/server/providers/integrations";

/** Integration Center data. Never includes secret values — only presence, source and last4. */
export const GET = route(async () => {
  await requireAdmin();
  return ok({ providers: await listIntegrations(), liveFlagsAllowed: process.env.MEROD_ALLOW_LIVE_FLAGS === "true" });
});
