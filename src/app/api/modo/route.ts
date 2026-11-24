import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { modoState, recentIdeas, newsFacts } from "@/server/modo/engine";

/** Modo's recent ideas (with how they turned out), relevant news facts and what it has learned. */
export const GET = route(async () => {
  const u = await requireUser();
  const [ideas, state, news] = await Promise.all([recentIdeas(u.id), modoState(u.id), newsFacts(u.id, 8).catch(() => [])]);
  return ok({ ideas, state, news });
});
