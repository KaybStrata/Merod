import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { ROLES, AUTONOMY, MODELS, STRATEGY_LABEL, defaultStrategy } from "@/server/agents/catalog";

export const GET = route(async () => {
  await requireUser();
  return ok({ roles: ROLES, autonomy: AUTONOMY, models: MODELS, strategies: Object.entries(STRATEGY_LABEL).map(([id, label]) => ({ id, label, defaults: defaultStrategy(id as any) })) });
});
