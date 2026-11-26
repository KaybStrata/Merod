import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { listListings, publishListing } from "@/server/agents/extras";

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  return ok({ listings: await listListings(u.id, { q: sp.get("q"), category: sp.get("category") }), payments: "disabled", paymentsNote: "Purchases, rentals and subscriptions are off until compliance review. All templates are free to install." });
});
/** Publish one of your agents as a template (config only). */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`publish:${u.id}`, 10, 60);
  const b = await parse(req, z.object({ agentId: z.string().uuid(), visibility: z.enum(["private", "public"]), description: z.string().max(500).optional(), category: z.string().max(40).optional() }));
  return ok({ listing: await publishListing(u.id, b.agentId, b) });
});
