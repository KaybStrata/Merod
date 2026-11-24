import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { applyLearning, dismissLearning } from "@/server/learning/engine";

type Ctx = { params: Promise<{ id: string }> };

/** POST {action:"apply"} = the user's "Update" button; {action:"dismiss"} hides it. */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const b = await parse(req, z.object({ action: z.enum(["apply", "dismiss"]) }));
  if (b.action === "apply") return ok(await applyLearning(u.id, id));
  await dismissLearning(u.id, id);
  return ok({ ok: true });
});
