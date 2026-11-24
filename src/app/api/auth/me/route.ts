import { getSession } from "@/server/auth";
import { ok, route } from "@/server/http";
import { getFlags } from "@/server/flags";
import { one } from "@/server/db";

export const GET = route(async () => {
  const s = await getSession();
  if (!s) return ok({ user: null }, { status: 200 });
  const profile = await one<any>("SELECT avatar_color, theme, ai_provider, ai_model FROM user_profiles WHERE user_id=$1", [s.id]);
  const unread = await one<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL", [s.id]);
  const { sessionId: _s, ...user } = s;
  return ok({ user: { ...user, ...profile }, flags: await getFlags(), unread: unread?.n ?? 0 });
});
