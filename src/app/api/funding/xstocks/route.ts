import { requireUser } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { listXStocks } from "@/server/funding/xstocks";

/** Tokenized stocks (xStocks) a Merod Wallet can buy via Jupiter. Mints come from Jupiter's verified token list at runtime. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  if (force) await rateLimit(`xstocks:${u.id}`, 6, 60);
  return ok(await listXStocks(force));
});
