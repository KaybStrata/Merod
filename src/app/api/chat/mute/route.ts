import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { muteUser } from "@/server/chat/service";

/** Admins: mute a user in the community chat for N minutes. */
export const POST = route(async (req) => {
  const a = await requireAdmin();
  const b = await parse(req, z.object({ userId: z.string().uuid(), minutes: z.number().int().min(1).max(60 * 24 * 365), reason: z.string().max(300).optional() }));
  await muteUser(a.id, b.userId, b.minutes, b.reason);
  return ok({ ok: true });
});
