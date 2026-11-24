import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { STRATEGIES } from "@/server/bots/strategies";

export const GET = route(async () => {
  await requireUser();
  return ok({ strategies: STRATEGIES.map(({ decide: _d, ...s }) => s) });
});
