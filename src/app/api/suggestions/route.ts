import { requireUser } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { suggestionsFor } from "@/server/suggestions/engine";

/** Live suggested trades, prompts and shortcut buttons for the user (optionally for one asset). */
export const GET = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`suggest:${u.id}`, 60, 60);
  const assetId = new URL(req.url).searchParams.get("assetId");
  const valid = assetId && /^[0-9a-f-]{36}$/i.test(assetId) ? assetId : null;
  return ok(await suggestionsFor(u.id, valid));
});
