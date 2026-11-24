import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { modoState, recentIdeas } from "@/server/modo/engine";

/** Modo's recent ideas (with how they turned out) and what it has learned. */
export const GET = route(async () => {
  const u = await requireUser();
  const [ideas, state] = await Promise.all([recentIdeas(u.id), modoState(u.id)]);
  return ok({ ideas, state });
});
