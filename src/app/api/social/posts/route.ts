import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, tx } from "@/server/db";
import { audit } from "@/server/audit";
import { flag } from "@/server/flags";
import { HttpError } from "@/server/errors";
import { publish } from "@/server/realtime";
import { feed, verifyTaggedOrder } from "@/server/social/service";

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const posts = await feed(u.id, { tab: sp.get("tab") ?? "all", before: sp.get("before"), limit: Number(sp.get("limit") ?? 30) });
  return ok({ posts });
});

const Body = z.object({
  kind: z.enum(["post", "trade", "analysis", "strategy"]),
  body: z.string().trim().min(1).max(2000),
  visibility: z.enum(["public", "followers", "private"]).default("public"),
  tags: z.array(z.string().trim().min(1).max(30).regex(/^[\w$.-]+$/)).max(8).default([]),
  assetId: z.string().uuid().nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
});

export const POST = route(async (req) => {
  const u = await requireUser();
  if (!(await flag("social_trading"))) throw new HttpError(403, "Social trading is disabled");
  await rateLimit(`post:${u.id}`, 20, 3600);
  const b = await parse(req, Body);
  // Verification is derived server-side; the client cannot claim a verified trade.
  const { verification, order } = await verifyTaggedOrder(u.id, b.orderId);
  if (b.orderId && !order) throw new HttpError(400, "You can only tag your own orders");
  const assetId = order?.asset_id ?? b.assetId ?? null;
  if (assetId && !(await one("SELECT 1 FROM assets WHERE id=$1", [assetId]))) throw new HttpError(400, "Unknown asset");
  const post = await tx(async (c) => {
    const p = await one<any>("INSERT INTO social_posts (user_id, kind, body, visibility, tags) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [u.id, b.kind, b.body, b.visibility, b.tags.map((t) => t.replace(/^#/, ""))], c);
    if (assetId) await c.query("INSERT INTO tagged_trades (post_id, order_id, asset_id, verification, side, entry_price) VALUES ($1,$2,$3,$4,$5,$6)",
      [p.id, order?.id ?? null, assetId, verification, order?.side ?? null, order?.avg_fill_price ?? null]);
    return p;
  });
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "social.post", target: post.id, data: { kind: b.kind, visibility: b.visibility, verification } });
  if (b.visibility === "public") await publish("social", "post", { id: post.id, handle: u.handle });
  return ok({ post });
});
