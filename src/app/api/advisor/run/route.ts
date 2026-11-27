import { requireUser } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { runAdvisor } from "@/server/advisor";

/** "Check now": one Advisor pass right away. */
export const POST = route(async () => {
  const u = await requireUser();
  await rateLimit(`advisor-run:${u.id}`, 20, 3600);
  const fresh = await runAdvisor(u.id);
  return ok({ added: fresh.length });
});
