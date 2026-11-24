import { requireSuperAdmin } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";
import { listFlags } from "@/server/admin/service";

/** Owner view of everything real-money trading needs: server unlock, 2FA, live accounts, and the switches. */
export const GET = route(async () => {
  const u = await requireSuperAdmin();
  const flags = (await listFlags()).filter((f: any) => ["live_crypto_trading", "live_brokerage_trading", "automated_real_money"].includes(f.key));
  const me = await one<{ totp_enabled: boolean }>("SELECT totp_enabled FROM users WHERE id=$1", [u.id]);
  const liveAccounts = await q<any>("SELECT id, label, kind, provider_id, status FROM trading_accounts WHERE user_id=$1 AND kind <> 'paper' AND status='active' ORDER BY created_at", [u.id]);
  return ok({ envUnlocked: process.env.MEROD_ALLOW_LIVE_FLAGS === "true", twoFactor: !!me?.totp_enabled, liveAccounts, flags });
});
