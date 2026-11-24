import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { signRealtimeToken } from "@/server/realtime-token";

/** Issues a short-lived token for the worker's WebSocket gateway. url=null → UI falls back to polling. */
export const GET = route(async () => {
  const u = await requireUser();
  const url = process.env.NEXT_PUBLIC_REALTIME_URL || null;
  return ok({ token: signRealtimeToken(u.id, u.role), url });
});
