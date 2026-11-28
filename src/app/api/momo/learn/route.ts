import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";

/** Train Momo (the Advisor) with links: POST { text } (one or more links, plus optional words like "train my bots on it"). */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`momo-learn:${u.id}`, 40, 3600);
  const b = await parse(req, z.object({ text: z.string().min(4).max(4000) }));
  const { linkCommand } = await import("@/server/link-learn");
  const r = await linkCommand(u.id, b.text, { momo: true });
  if (!r) throw new HttpError(400, "Paste or drop a link (YouTube, a news article, a strategy page…) for Momo to learn from.");
  const { runAdvisor } = await import("@/server/advisor");
  await runAdvisor(u.id).catch(() => {});
  return ok({ summary: r.summary, followUp: r.followUp ?? null });
});
export const maxDuration = 120;
