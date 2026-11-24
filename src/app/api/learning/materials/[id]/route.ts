import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { removeMaterial, retry, setActive } from "@/server/learning/materials";

type Ctx = { params: Promise<{ id: string }> };
const Id = z.string().uuid();

/** PATCH { active } toggles "use in trading"; { retry: true } learns again. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = Id.parse((await params).id);
  const b = await parse(req, z.object({ active: z.boolean().optional(), retry: z.boolean().optional() }));
  if (b.active !== undefined) await setActive(u.id, id, b.active);
  if (b.retry) await retry(u.id, id);
  return ok({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  await removeMaterial(u.id, Id.parse((await params).id));
  return ok({ ok: true });
});
