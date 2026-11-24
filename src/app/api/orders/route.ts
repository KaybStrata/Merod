import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { q } from "@/server/db";
import { OrderIntentSchema } from "@/server/engine/types";
import { place, preview } from "@/server/engine/engine";

/** GET: the user's orders (filters: status=open|all, limit). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const open = sp.get("status") === "open";
  const orders = await q(
    `SELECT o.*, a.symbol, a.name, a.venue, a.asset_class FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 ${open ? "AND o.status IN ('pending_approval','validated','submitted','partially_filled','unknown')" : ""}
      ORDER BY o.created_at DESC LIMIT $2`, [u.id, Math.min(Number(sp.get("limit") ?? 100), 500)]);
  return ok({ orders });
});

const Body = z.object({
  intent: OrderIntentSchema,
  mode: z.enum(["preview", "place"]),
  /** Client-generated per submit; replays return the original order (idempotency). */
  idempotencyKey: z.string().min(8).max(100).optional(),
  source: z.enum(["manual", "shortcut"]).default("manual"),
  sourceRef: z.string().max(100).optional(),
});

/** POST: preview (all engine checks, no side effects) or place (user-confirmed manual order). */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`orders:${u.id}`, 60, 60);
  const b = await parse(req, Body);
  const ctx = { userId: u.id, source: b.source, sourceRef: b.sourceRef, idempotencyKey: b.idempotencyKey ?? randomUUID(), actor: { type: "user" as const, id: u.id }, userConfirmed: b.mode === "place" };
  if (b.mode === "preview") return ok({ plan: await preview(b.intent, ctx) });
  const r = await place(b.intent, ctx);
  return ok({ order: r.order, plan: r.plan, replayed: r.replayed });
});
