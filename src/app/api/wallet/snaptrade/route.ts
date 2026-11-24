import { requireUser } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { audit } from "@/server/audit";
import { decrypt, encrypt } from "@/server/crypto";
import { HttpError } from "@/server/errors";
import { contextFor, providerUsable } from "@/server/providers/integrations";
import { snaptradeClient } from "@/server/providers/execution";

async function envOrThrow() {
  const env = (await providerUsable("snaptrade", "production")) ? "production" : (await providerUsable("snaptrade", "sandbox")) ? "sandbox" : null;
  if (!env) throw new HttpError(409, "SnapTrade isn't configured yet — an administrator must add and test SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY in the Integration Center");
  return env;
}

/** Find or register the SnapTrade user for this Merod user. The user secret is stored encrypted. */
async function snapUser(userId: string, st: Awaited<ReturnType<typeof snaptradeClient>>) {
  const existing = await one<any>("SELECT id, metadata FROM trading_accounts WHERE user_id=$1 AND provider_id='snaptrade' AND metadata ? 'snaptrade_user_id' ORDER BY created_at LIMIT 1", [userId]);
  if (existing) return { snapId: existing.metadata.snaptrade_user_id as string, secret: decrypt(existing.metadata.snaptrade_user_secret_enc, `snaptrade:${existing.metadata.snaptrade_user_id}`), enc: existing.metadata.snaptrade_user_secret_enc };
  const snapId = `merod-${userId}`;
  const r = await st.authentication.registerSnapTradeUser({ userId: snapId });
  const secret = (r.data as any).userSecret as string;
  const enc = encrypt(secret, `snaptrade:${snapId}`);
  await q(`INSERT INTO trading_accounts (user_id, kind, provider_id, label, status, metadata) VALUES ($1,'brokerage','snaptrade','SnapTrade connection (pending)','pending',$2)`,
    [userId, JSON.stringify({ snaptrade_user_id: snapId, snaptrade_user_secret_enc: enc })]);
  return { snapId, secret, enc };
}

/** POST: returns the SnapTrade connection-portal URL. */
export const POST = route(async () => {
  const u = await requireUser();
  await rateLimit(`snaptrade:${u.id}`, 10, 3600);
  const env = await envOrThrow();
  const st = await snaptradeClient(contextFor("snaptrade", env));
  const su = await snapUser(u.id, st);
  const login = await st.authentication.loginSnapTradeUser({ userId: su.snapId, userSecret: su.secret, customRedirect: `${process.env.APP_URL ?? ""}/wallet?snaptrade=done` } as any);
  const url = (login.data as any)?.redirectURI;
  if (!url) throw new HttpError(502, "SnapTrade did not return a connection link");
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "wallet.snaptrade_portal" });
  return ok({ url });
});

/** GET: sync connected brokerage accounts from SnapTrade into trading_accounts. */
export const GET = route(async () => {
  const u = await requireUser();
  const env = await envOrThrow();
  const st = await snaptradeClient(contextFor("snaptrade", env));
  const su = await snapUser(u.id, st);
  const r = await st.accountInformation.listUserAccounts({ userId: su.snapId, userSecret: su.secret });
  let n = 0;
  for (const acct of (r.data as any[]) ?? []) {
    const exists = await one("SELECT id FROM trading_accounts WHERE user_id=$1 AND provider_id='snaptrade' AND external_ref=$2", [u.id, acct.id]);
    const cash = Number(acct.balance?.total?.amount ?? 0);
    if (exists) await q("UPDATE trading_accounts SET cash_balance=$2, status='active' WHERE id=$1", [(exists as any).id, cash]);
    else await q(`INSERT INTO trading_accounts (user_id, kind, provider_id, label, external_ref, status, cash_balance, metadata) VALUES ($1,'brokerage','snaptrade',$2,$3,'active',$4,$5)`,
      [u.id, `${acct.institution_name ?? "Brokerage"} ${acct.name ?? ""}`.trim(), acct.id, cash,
       JSON.stringify({ snaptrade_user_id: su.snapId, snaptrade_user_secret_enc: su.enc, environment: env, balance_synced: true })]);
    n++;
  }
  return ok({ synced: n });
});
