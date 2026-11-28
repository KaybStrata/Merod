import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { tabPnl } from "@/server/talk/tab-scope";

/** GET ?conv= → this Talk tab's own P&L (only what that conversation started). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const conv = new URL(req.url).searchParams.get("conv");
  if (!conv || !/^[0-9a-f-]{36}$/i.test(conv)) throw new HttpError(400, "conv required");
  return ok(await tabPnl(u.id, conv));
});
