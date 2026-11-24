import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { getNews } from "@/server/news/service";

/** GET ?category=stocks|crypto&q=&symbol= — latest headlines from public publisher feeds (links to the originals). */
export const GET = route(async (req) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const c = sp.get("category");
  return ok(await getNews({ category: c === "stocks" || c === "crypto" ? c : null, query: sp.get("q"), symbol: sp.get("symbol"), limit: Number(sp.get("limit") ?? 60) }));
});
