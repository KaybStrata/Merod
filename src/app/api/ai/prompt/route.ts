import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { handlePrompt } from "@/server/ai/interpret";

const Body = z.object({
  text: z.string().max(2000),
  conversationId: z.string().uuid().nullable().optional(),
  screenAssetId: z.string().uuid().nullable().optional(),
  provider: z.enum(["anthropic", "openai", "merod", "auton"]).optional(),
  model: z.string().max(60).optional(),
  /** Sent from Momo (the Advisor): train Momo on the links in the text. */
  momo: z.boolean().optional(),
  /** Paper or real money for trades and bots from this prompt (Talk composer switch). */
  book: z.enum(["paper", "live"]).optional(),
  /** Files attached in the prompt box (uploaded first via /api/ai/attachments). */
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  /** The browser's IANA time zone, used when a prompt sets up a schedule without naming one. */
  tz: z.string().max(60).optional(),
});

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`prompt:${u.id}`, 30, 60);
  const b = await parse(req, Body);
  const r = await handlePrompt(u.id, { text: b.text, conversationId: b.conversationId ?? undefined, screenAssetId: b.screenAssetId, provider: b.provider === "auton" ? undefined : b.provider, auton: b.provider === "auton", model: b.model, book: b.book, attachmentIds: b.attachmentIds, tz: b.tz, momo: b.momo });
  return ok(r);
});

/** Vercel: allow slow AI / backtest / provider calls. */
export const maxDuration = 120;
