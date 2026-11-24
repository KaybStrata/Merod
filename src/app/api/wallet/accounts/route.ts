import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { audit } from "@/server/audit";
import { getFlags } from "@/server/flags";
import { HttpError } from "@/server/errors";
import { ADDRESS_RULES, alpacaBalance, walletCapabilities, BYO_ACCOUNT_PROVIDERS } from "@/server/wallet/service";

export const GET = route(async () => {
  const u = await requireUser();
  const accounts = await q(
    `SELECT t.id, t.kind, t.provider_id, t.label, t.external_ref, t.network, t.status, t.cash_balance, t.currency, t.created_at,
            t.metadata->>'environment' AS environment, (t.metadata->>'byo_keys')::boolean AS byo_keys, (t.metadata->>'watch_only')::boolean AS watch_only,
            (t.metadata->>'balance_synced')::boolean AS balance_synced,
            (SELECT count(*)::int FROM positions p WHERE p.account_id=t.id AND p.quantity>0) AS positions
       FROM trading_accounts t WHERE t.user_id=$1 ORDER BY t.kind='paper' DESC, t.created_at`, [u.id]);
  const flags = await getFlags();
  return ok({
    accounts, networks: Object.entries(ADDRESS_RULES).map(([id, r]) => ({ id, label: r.label })),
    capabilities: await walletCapabilities(u.id),
    flags: { embedded_wallets: flags.embedded_wallets, funding: flags.funding, withdrawals: flags.withdrawals, live_crypto_trading: flags.live_crypto_trading, live_brokerage_trading: flags.live_brokerage_trading },
  });
});

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("external_wallet"), network: z.string(), address: z.string().trim().min(10).max(100), label: z.string().trim().max(60).optional() }),
  z.object({ type: z.literal("byo_broker"), providerId: z.string().refine((p) => p in BYO_ACCOUNT_PROVIDERS, "Unsupported provider"), environment: z.enum(["sandbox", "production"]),
    label: z.string().trim().max(60).optional(), externalRef: z.string().trim().max(60).optional() }),
]);

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`wallet-connect:${u.id}`, 20, 3600);
  const b = await parse(req, Body);
  if (b.type === "external_wallet") {
    const rule = ADDRESS_RULES[b.network];
    if (!rule) throw new HttpError(400, "Unsupported network");
    if (!rule.re.test(b.address)) throw new HttpError(400, `That doesn't look like a valid ${rule.label} address`);
    if (await one("SELECT 1 FROM trading_accounts WHERE user_id=$1 AND kind='wallet' AND network=$2 AND lower(external_ref)=lower($3) AND status<>'disconnected'", [u.id, b.network, b.address]))
      throw new HttpError(409, "This wallet is already connected");
    const a = await one<any>(
      `INSERT INTO trading_accounts (user_id, kind, provider_id, label, external_ref, network, status, metadata)
       VALUES ($1,'wallet','external',$2,$3,$4,'active',$5) RETURNING id`,
      [u.id, b.label || `${rule.label} wallet ${b.address.slice(0, 4)}…${b.address.slice(-4)}`, b.address, b.network, JSON.stringify({ watch_only: true, environment: "production" })]);
    await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "wallet.connect_external", target: a.id, data: { network: b.network, address: b.address } });
    return ok({ id: a.id });
  }
  // User's own brokerage account via their own pasted keys. Keys are tested first; production stays blocked by live flags in the engine.
  const st = await one<{ status: string }>("SELECT min(status) AS status FROM user_provider_secrets WHERE user_id=$1 AND provider_id=$2 AND environment=$3", [u.id, b.providerId, b.environment]);
  if (!st?.status) throw new HttpError(400, `Paste your ${BYO_ACCOUNT_PROVIDERS[b.providerId]} ${b.environment} keys on the Broker Keys page first`);
  if (st.status !== "connected") throw new HttpError(400, "Test your keys on the Broker Keys page first (they must pass the key check)");
  if (b.providerId === "tradier" && !b.externalRef) throw new HttpError(400, "Enter your Tradier account number");
  let cash = 0, ref = b.externalRef ?? null, synced = false;
  if (b.providerId === "alpaca_trading") {
    try { const bal = await alpacaBalance(u.id, b.environment); cash = bal.cash; ref = bal.accountNumber; synced = true; }
    catch (e: any) { throw new HttpError(502, `Couldn't reach Alpaca with your keys: ${e.message}`); }
  }
  const label = b.label || `${BYO_ACCOUNT_PROVIDERS[b.providerId]} ${b.environment === "sandbox" ? "paper" : "live"} (my account)`;
  const a = await one<any>(
    `INSERT INTO trading_accounts (user_id, kind, provider_id, label, external_ref, status, cash_balance, metadata) VALUES ($1,'brokerage',$2,$3,$4,'active',$5,$6) RETURNING id`,
    [u.id, b.providerId, label, ref, cash, JSON.stringify({ byo_keys: true, environment: b.environment, balance_synced: synced })]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "wallet.connect_byo_broker", target: a.id, data: { provider: b.providerId, environment: b.environment } });
  return ok({ id: a.id });
});
