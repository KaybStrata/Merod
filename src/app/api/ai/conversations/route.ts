import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/** GET ?c=<id> returns messages for one conversation, otherwise the conversation list. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const c = new URL(req.url).searchParams.get("c");
  if (c) {
    const messages = await q("SELECT id, role, content, ai_provider, ai_model, plan, status, created_at FROM trading_prompts WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at", [u.id, c]);
    return ok({ messages });
  }
  const conversations = await q(
    `SELECT c.id, c.title, c.created_at, (SELECT max(created_at) FROM trading_prompts p WHERE p.conversation_id=c.id) AS last_at
       FROM ai_conversations c WHERE c.user_id=$1 ORDER BY last_at DESC NULLS LAST LIMIT 50`, [u.id]);
  return ok({ conversations });
});
