import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { AI_MODELS } from "@/server/ai/llm";

export const PUT = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ provider: z.enum(["anthropic", "openai", "merod"]), model: z.string().max(60) }));
  const models = (AI_MODELS as Record<string, readonly { id: string }[]>)[b.provider];
  if (!models.some((m) => m.id === b.model)) throw new HttpError(400, "Unknown model for this provider");
  await q("UPDATE user_profiles SET ai_provider=$2, ai_model=$3 WHERE user_id=$1", [u.id, b.provider, b.model]);
  return ok({ ok: true });
});
