import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { approvePlan, rejectPlan } from "@/server/ai/interpret";

type Ctx = { params: Promise<{ id: string }> };

/** Human approval of an AI-generated plan. The AI itself can never call this. */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  let overrides: any;
  try { overrides = await req.json(); } catch { overrides = undefined; }
  return ok({ result: await approvePlan(u.id, id, overrides) });
});
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  await rejectPlan(u.id, (await params).id);
  return ok({ ok: true });
});

/** Vercel: allow slow AI / backtest / provider calls. */
export const maxDuration = 60;
