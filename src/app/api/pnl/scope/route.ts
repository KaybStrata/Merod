import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { scopePnl, SCOPES, type Scope } from "@/server/pnl-scope";

/** GET ?scope=trades|bot|auto|modo|copy|auton|prompt|manual&range=<seconds>&conv=<tab> → that group's own P&L and the previous period. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const scope = (sp.get("scope") ?? "trades") as Scope;
  if (!SCOPES.includes(scope)) throw new HttpError(400, "Unknown scope");
  const r = Number(sp.get("range"));
  const conv = sp.get("conv");
  if (conv && !/^[0-9a-f-]{36}$/i.test(conv)) throw new HttpError(400, "Bad tab");
  const ref = sp.get("ref");
  if (ref && !/^[0-9a-f-]{36}$/i.test(ref)) throw new HttpError(400, "Bad bot");
  return ok(await scopePnl(u.id, scope, Number.isFinite(r) && r >= 60 ? Math.min(r, 10 * 365 * 86_400) : null, conv, ref));
});
