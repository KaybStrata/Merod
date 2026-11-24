import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { q, one } from "@/server/db";
import { refreshLearnings, applyLearning } from "@/server/learning/engine";

/** GET: personal + platform learnings, applied history and stats. */
export const GET = route(async () => {
  const u = await requireUser();
  const [personal, platform, applied, stats] = await Promise.all([
    q("SELECT * FROM ai_learnings WHERE user_id=$1 AND status='new' ORDER BY (proposed_update IS NOT NULL) DESC, updated_at DESC LIMIT 50", [u.id]),
    q("SELECT id, key, category, title, insight, evidence, confidence, sample_size, updated_at FROM ai_learnings WHERE scope='platform' AND status='new' ORDER BY updated_at DESC LIMIT 10"),
    q("SELECT id, title, status, applied_at, updated_at, adjustment_id, proposed_update FROM ai_learnings WHERE user_id=$1 AND status IN ('applied','dismissed') ORDER BY updated_at DESC LIMIT 30", [u.id]),
    one(`SELECT count(*) FILTER (WHERE status='new')::int AS active, count(*) FILTER (WHERE status='new' AND proposed_update IS NOT NULL)::int AS updatable,
                count(*) FILTER (WHERE status='applied')::int AS applied, max(updated_at) AS last_learned FROM ai_learnings WHERE user_id=$1`, [u.id]),
  ]);
  return ok({ personal, platform, applied, stats });
});

/** POST {action:"refresh"} recomputes now · {action:"apply_all"} applies every pending update. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ action: z.enum(["refresh", "apply_all"]) }));
  if (b.action === "refresh") {
    await rateLimit(`learn-refresh:${u.id}`, 6, 60);
    return ok({ fresh: await refreshLearnings(u.id) });
  }
  const pending = await q<{ id: string }>("SELECT id FROM ai_learnings WHERE user_id=$1 AND status='new' AND proposed_update IS NOT NULL ORDER BY created_at", [u.id]);
  const results = [];
  for (const p of pending) {
    try { await applyLearning(u.id, p.id); results.push({ id: p.id, ok: true }); }
    catch (e: any) { results.push({ id: p.id, ok: false, error: e.message }); }
  }
  return ok({ results, applied: results.filter((r) => r.ok).length });
});

/** Vercel: allow slow AI / backtest / provider calls. */
export const maxDuration = 60;
