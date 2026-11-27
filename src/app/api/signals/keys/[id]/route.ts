import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { audit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const b = await parse(req, z.object({ name: z.string().min(1).max(80).optional(), enabled: z.boolean().optional(), perTradeUsd: z.number().min(1).max(1e7).optional(), maxOrderUsd: z.number().min(0).max(1e8).optional(), maxDailyUsd: z.number().min(0).max(1e9).optional(), accountId: z.string().uuid().nullable().optional(), allowLive: z.boolean().optional() }));
  const k = await one<any>("SELECT * FROM signal_keys WHERE id=$1 AND user_id=$2", [id, u.id]);
  if (!k) throw new HttpError(404, "Signal bot not found");
  if (b.accountId && !(await one("SELECT 1 FROM trading_accounts WHERE id=$1 AND user_id=$2", [b.accountId, u.id]))) throw new HttpError(404, "Trading account not found");
  if (b.allowLive) {
    // Real money for an outside bot needs two-factor auth; the order engine still applies the live-trading flags and
    // the automated real-money switch (otherwise each live order waits for approval).
    const s = await one<any>("SELECT totp_enabled FROM users WHERE id=$1", [u.id]);
    if (!s?.totp_enabled) throw new HttpError(400, "Turn on two-factor authentication before letting an outside bot trade real money.");
  }
  await q(`UPDATE signal_keys SET name=COALESCE($3,name), enabled=COALESCE($4,enabled), per_trade_usd=COALESCE($5,per_trade_usd), max_order_usd=COALESCE($6,max_order_usd),
             max_daily_usd=COALESCE($7,max_daily_usd), account_id=CASE WHEN $8::boolean THEN $9::uuid ELSE account_id END, allow_live=COALESCE($10,allow_live)
           WHERE id=$1 AND user_id=$2`,
    [id, u.id, b.name ?? null, b.enabled ?? null, b.perTradeUsd ?? null, b.maxOrderUsd ?? null, b.maxDailyUsd ?? null, b.accountId !== undefined, b.accountId ?? null, b.allowLive ?? null]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "signal_key.updated", target: id, data: b });
  return ok({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const r = await q<any>("DELETE FROM signal_keys WHERE id=$1 AND user_id=$2 RETURNING id", [id, u.id]);
  if (!r.length) throw new HttpError(404, "Signal bot not found");
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "signal_key.deleted", target: id });
  return ok({ ok: true });
});
