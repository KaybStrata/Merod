import { z } from "zod";
import { requireSuperAdmin } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createFollow, listFollows } from "@/server/copy/service";
import { CopySettings } from "@/server/copy/schema";

/** Copy trading (super admin). GET: follows, recent copied trades, traders who allow copying. */
export const GET = route(async () => {
  const u = await requireSuperAdmin();
  return ok(await listFollows(u.id));
});

const Body = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("user"), handle: z.string().min(1).max(40) }),
    z.object({ kind: z.literal("wallet"), network: z.literal("solana"), address: z.string().min(32).max(44) }),
  ]),
  settings: CopySettings.default({} as any),
});

export const POST = route(async (req) => {
  const u = await requireSuperAdmin();
  await rateLimit(`copy:${u.id}`, 30, 3600);
  const b = await parse(req, Body);
  return ok({ id: await createFollow(u.id, b.target, b.settings as any) });
});
