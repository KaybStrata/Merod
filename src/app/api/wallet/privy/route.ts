import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one } from "@/server/db";
import { audit } from "@/server/audit";
import { flag } from "@/server/flags";
import { HttpError } from "@/server/errors";
import { contextFor, providerUsable } from "@/server/providers/integrations";
import { readJson } from "@/server/providers/http";

/**
 * Create a Privy embedded (server) wallet: POST https://api.privy.io/v1/wallets {chain_type}.
 * Merod stores only the public address. Signing stays disabled until wallet security review +
 * live_crypto_trading approval; there is no path that exposes keys to Merod or AI.
 */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`privy:${u.id}`, 5, 3600);
  const { chain } = await parse(req, z.object({ chain: z.enum(["ethereum", "solana"]) }));
  if (!(await flag("embedded_wallets"))) throw new HttpError(409, "Embedded wallets are disabled by the administrator");
  const env = (await providerUsable("privy", "production")) ? "production" : (await providerUsable("privy", "sandbox")) ? "sandbox" : null;
  if (!env) throw new HttpError(409, "Privy isn't connected yet — an administrator must configure and test it in the Integration Center");
  if (await one("SELECT 1 FROM trading_accounts WHERE user_id=$1 AND provider_id='privy' AND network=$2 AND status='active'", [u.id, chain]))
    throw new HttpError(409, `You already have a Merod ${chain} embedded wallet`);
  const ctx = contextFor("privy", env);
  const appId = await ctx.cred("PRIVY_APP_ID"), secret = await ctx.cred("PRIVY_APP_SECRET");
  const res = await ctx.fetch("https://api.privy.io/v1/wallets", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`, "privy-app-id": appId!, "content-type": "application/json", "privy-idempotency-key": `merod-${u.id}-${chain}` },
    body: JSON.stringify({ chain_type: chain }),
  });
  const w = await readJson(res, "privy");
  if (!w?.address) throw new HttpError(502, "Privy did not return a wallet address");
  const a = await one<any>(
    `INSERT INTO trading_accounts (user_id, kind, provider_id, label, external_ref, network, status, metadata) VALUES ($1,'wallet','privy',$2,$3,$4,'active',$5) RETURNING id`,
    [u.id, `Merod ${chain === "solana" ? "Solana" : "Ethereum"} wallet`, w.address, chain, JSON.stringify({ privy_wallet_id: w.id, environment: env, signing_enabled: false })]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "wallet.privy_create", target: a.id, data: { chain, address: w.address } });
  return ok({ id: a.id, address: w.address });
});
