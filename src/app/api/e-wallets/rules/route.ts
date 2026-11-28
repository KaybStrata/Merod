import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q } from "@/server/db";
import { addRule } from "@/server/ewallets";

/** POST → add/update a profit rule. PATCH { id, active?, percent? } → change one. DELETE ?id= → remove it. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ walletId: z.string().uuid(), percent: z.number().min(0.1).max(100), scope: z.enum(["all", "bot", "agent", "source"]).default("all"), scopeRef: z.string().max(80).nullable().optional(), scopeLabel: z.string().max(80).nullable().optional() }));
  return ok({ rule: await addRule(u.id, b.walletId, b) });
});
export const PATCH = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ id: z.string().uuid(), active: z.boolean().optional(), percent: z.number().min(0.1).max(100).optional() }));
  await q("UPDATE e_wallet_rules SET active=COALESCE($3,active), percent=COALESCE($4,percent) WHERE id=$1 AND user_id=$2", [b.id, u.id, b.active ?? null, b.percent ?? null]);
  return ok({ ok: true });
});
export const DELETE = route(async (req) => {
  const u = await requireUser();
  const id = new URL(req.url).searchParams.get("id");
  if (id) await q("DELETE FROM e_wallet_rules WHERE id=$1 AND user_id=$2", [id, u.id]);
  return ok({ ok: true });
});
