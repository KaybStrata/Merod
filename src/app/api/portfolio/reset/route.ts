import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, tx } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";

/** Reset the simulated paper portfolio. Requires typing RESET. Never touches live/brokerage accounts. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`paper-reset:${u.id}`, 5, 3600);
  const b = await parse(req, z.object({ confirm: z.string() }));
  if (b.confirm !== "RESET") throw new HttpError(400, 'Type "RESET" to confirm');
  const acct = await one<any>("SELECT * FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [u.id]);
  if (!acct) throw new HttpError(404, "No paper account");
  const starting = Number(acct.metadata?.starting_balance ?? 100000);
  const result = await tx(async (c) => {
    const cancelled = await c.query(
      `UPDATE orders SET status='cancelled', status_reason='Paper portfolio reset', updated_at=now()
        WHERE account_id=$1 AND provider_id='paper' AND status IN ('pending_approval','validated','submitted','partially_filled','unknown')`, [acct.id]);
    const stopped = await c.query("UPDATE trading_bots SET status='stopped' WHERE account_id=$1 AND status IN ('running','paused')", [acct.id]);
    const deleted = await c.query("DELETE FROM positions WHERE account_id=$1", [acct.id]);
    await c.query("UPDATE trading_accounts SET cash_balance=$2 WHERE id=$1", [acct.id, starting]);
    await c.query(`INSERT INTO transactions (user_id, account_id, kind, amount, amount_usd, status, reference, receipt)
                   VALUES ($1,$2,'reset',$3,$3,'confirmed','paper_reset',$4)`,
      [u.id, acct.id, starting, JSON.stringify({ previous_cash: acct.cash_balance, simulated: true })]);
    await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "paper.reset", target: acct.id,
      data: { cancelledOrders: cancelled.rowCount, stoppedBots: stopped.rowCount, positions: deleted.rowCount, starting } }, c);
    return { cancelledOrders: cancelled.rowCount, stoppedBots: stopped.rowCount, positionsCleared: deleted.rowCount, cash: starting };
  });
  return ok(result);
});
