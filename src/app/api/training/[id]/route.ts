import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { revertAdjustment } from "@/server/training/trainer";
import { HttpError } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** POST: revert one auto-training adjustment. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  try { await revertAdjustment(u.id, (await params).id); }
  catch (e: any) { throw new HttpError(409, e.message); }
  return ok({ ok: true });
});
