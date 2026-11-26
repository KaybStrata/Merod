import { z } from "zod";
import { requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { ok, parse, route } from "@/server/http";

/** Saved workspace layouts (grid/list, card order, expanded agent). */
export const GET = route(async () => {
  const u = await requireUser();
  return ok({ layouts: await q("SELECT name, layout, updated_at FROM agent_layouts WHERE user_id=$1 ORDER BY updated_at DESC", [u.id]) });
});
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ name: z.string().min(1).max(40), layout: z.object({ view: z.enum(["grid", "list"]), order: z.array(z.string().uuid()).max(100), selected: z.string().uuid().nullable().optional(), tab: z.string().max(30).optional() }) }));
  await q("INSERT INTO agent_layouts (user_id, name, layout, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (user_id, name) DO UPDATE SET layout=$3, updated_at=now()", [u.id, b.name, JSON.stringify(b.layout)]);
  return ok({ ok: true });
});
