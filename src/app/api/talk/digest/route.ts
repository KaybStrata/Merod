import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { buildDigest } from "@/server/talk/digest";

/** GET ?since= — Talk mode's "while you were away" digest for the signed-in user only; marks those events as seen. */
export const GET = route(async (req) => {
  const u = await requireUser();
  return ok(await buildDigest(u.id, new URL(req.url).searchParams.get("since")));
});
