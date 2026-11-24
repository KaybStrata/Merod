import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";
import { alpacaBalance } from "@/server/wallet/service";

type Ctx = { params: Promise<{ id: string }> };

/** Refresh balance for a connected account (Alpaca BYO only for now). */
export const POST = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const a = await one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [id, u.id]);
  if (!a) throw new HttpError(404, "Account not found");
  if (a.provider_id === "alpaca_trading" && a.metadata?.byo_keys) {
    const bal = await alpacaBalance(u.id, a.metadata.environment === "sandbox" ? "sandbox" : "production");
    await q("UPDATE trading_accounts SET cash_balance=$2, metadata = metadata || '{\"balance_synced\":true}'::jsonb WHERE id=$1", [id, bal.cash]);
    return ok({ cash: bal.cash });
  }
  throw new HttpError(400, "Balance sync isn't available for this account type");
});

/** Disconnect. Paper accounts can't be removed; open orders must be cancelled first. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const a = await one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [id, u.id]);
  if (!a) throw new HttpError(404, "Account not found");
  if (a.kind === "paper") throw new HttpError(400, "The paper account can't be disconnected (use Reset paper in Portfolio)");
  const open = await one<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE account_id=$1 AND status IN ('pending_approval','validated','submitted','partially_filled','unknown')", [id]);
  if (open?.n) throw new HttpError(409, `Cancel the ${open.n} open order(s) on this account first`);
  await q("UPDATE trading_bots SET status='stopped' WHERE account_id=$1 AND status IN ('running','paused')", [id]);
  await q("UPDATE trading_accounts SET status='disconnected' WHERE id=$1", [id]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "wallet.disconnect", target: id, data: { provider: a.provider_id } });
  return ok({ ok: true });
});
