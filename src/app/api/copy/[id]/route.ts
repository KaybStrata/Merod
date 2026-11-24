import { z } from "zod";
import { requireSuperAdmin } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { deleteFollow, updateFollow } from "@/server/copy/service";
import { CopySettingsPatch } from "@/server/copy/schema";

type Ctx = { params: Promise<{ id: string }> };
const Patch = CopySettingsPatch;

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireSuperAdmin();
  const id = z.string().uuid().parse((await params).id);
  await updateFollow(u.id, id, await parse(req, Patch) as any);
  return ok({ ok: true });
});
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireSuperAdmin();
  await deleteFollow(u.id, z.string().uuid().parse((await params).id));
  return ok({ ok: true });
});
