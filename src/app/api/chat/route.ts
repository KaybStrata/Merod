import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { chatStats, listMessages, postMessage } from "@/server/chat/service";

/** GET ?before=<id> (older page) | ?after=<id> (catch-up) — the shared community room. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const num = (k: string) => (sp.get(k) && /^\d+$/.test(sp.get(k)!) ? Number(sp.get(k)) : null);
  const messages = await listMessages({ before: num("before"), after: num("after"), limit: Number(sp.get("limit") ?? 60) });
  return ok({ messages, stats: await chatStats(), me: { id: u.id, role: u.role } });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`chat:${u.id}`, 8, 20);
  const b = await parse(req, z.object({ body: z.string().max(1000), replyTo: z.number().int().positive().nullable().optional() }));
  return ok({ message: await postMessage(u, b.body, b.replyTo) });
});
