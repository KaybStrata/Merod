import { z } from "zod";
import { completeMfa, getSession } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";

export const POST = route(async (req) => {
  const s = await getSession();
  if (s) await rateLimit(`mfa:${s.id}`, 10, 600);
  const { code } = await parse(req, z.object({ code: z.string().min(6).max(8) }));
  await completeMfa(code);
  return ok({ ok: true });
});
