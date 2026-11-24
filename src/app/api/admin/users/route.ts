import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { listUsers, updateUser } from "@/server/admin/service";

export const GET = route(async (req) => {
  await requireAdmin();
  const sp = new URL(req.url).searchParams;
  return ok({ users: await listUsers(sp.get("q") ?? "", Math.min(Number(sp.get("limit") ?? 50), 200), Number(sp.get("offset") ?? 0)) });
});

export const PATCH = route(async (req) => {
  const admin = await requireAdmin();
  const b = await parse(req, z.object({
    userId: z.string().uuid(),
    role: z.enum(["user", "admin", "compliance", "support"]).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  }));
  await updateUser(admin.id, b.userId, { role: b.role, status: b.status });
  return ok({ ok: true });
});
