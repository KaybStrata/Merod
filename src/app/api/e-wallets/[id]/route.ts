import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { moveMoney } from "@/server/ewallets";

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const b = await parse(req, z.object({ name: z.string().min(1).max(40).optional(), goalUsd: z.number().positive().max(1e9).nullable().optional() }));
  const r = await one<any>("UPDATE e_wallets SET name=COALESCE($3,name), goal_usd=CASE WHEN $4::boolean THEN $5 ELSE goal_usd END WHERE id=$1 AND user_id=$2 RETURNING *", [id, u.id, b.name ?? null, b.goalUsd !== undefined, b.goalUsd ?? null]);
  if (!r) throw new HttpError(404, "E-wallet not found");
  return ok({ wallet: r });
});
/** Delete: any paper balance goes back to trading cash first. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const w = await one<any>("SELECT * FROM e_wallets WHERE id=$1 AND user_id=$2", [id, u.id]);
  if (!w) throw new HttpError(404, "E-wallet not found");
  if (Number(w.balance) > 0) await moveMoney(u.id, { from: { wallet: id }, to: { trading: true }, amount: Number(w.balance) });
  await q("DELETE FROM e_wallets WHERE id=$1 AND user_id=$2", [id, u.id]);
  return ok({ ok: true, returned: Number(w.balance) });
});
