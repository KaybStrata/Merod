import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";

export const GET = route(async () => {
  const u = await requireUser();
  const sessions = await q(
    `SELECT id, ip, user_agent, mfa_passed, created_at, expires_at, id=$2 AS current FROM sessions WHERE user_id=$1 AND expires_at > now() ORDER BY created_at DESC`,
    [u.id, u.sessionId]);
  return ok({ sessions });
});

/** DELETE ?id=<session> revokes one session; ?all=others revokes every other session. */
export const DELETE = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  if (sp.get("all") === "others") {
    const r = await q("DELETE FROM sessions WHERE user_id=$1 AND id<>$2 RETURNING id", [u.id, u.sessionId]);
    await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "auth.sessions_revoked", data: { count: r.length } });
    return ok({ revoked: r.length });
  }
  const id = sp.get("id");
  if (!id) throw new HttpError(400, "id required");
  if (id === u.sessionId) throw new HttpError(400, "Use Sign out to end the current session");
  await q("DELETE FROM sessions WHERE id=$1 AND user_id=$2", [id, u.id]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "auth.session_revoked", target: id });
  return ok({ revoked: 1 });
});
