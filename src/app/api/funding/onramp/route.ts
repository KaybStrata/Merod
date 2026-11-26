import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";
import { buildWidgetUrl, destinations, onrampConfig, supportedCoins } from "@/server/funding/onramp";

/**
 * Card / Apple Pay on-ramp into the user's own Solana wallet.
 * GET: which provider is configured, the coins it sells, and the user's receiving wallets.
 * POST {accountId, currency, amountUsd}: a prefilled (and, for MoonPay, signed) hosted-widget URL.
 */
export const GET = route(async () => {
  const u = await requireUser();
  const cfg = await onrampConfig();
  return ok({
    configured: !!cfg, provider: cfg?.provider ?? null, env: cfg?.env ?? null, signed: !!cfg?.secretKey,
    coins: await supportedCoins(cfg),
    wallets: (await destinations(u.id)).map((w) => ({ id: w.id, label: w.label, address: w.address, merod: w.provider_id === "merod_wallet" })),
    missing: cfg ? [] : ["MOONPAY_PUBLISHABLE_KEY (+ MOONPAY_SECRET_KEY) or TRANSAK_API_KEY"],
  });
});

const Body = z.object({
  accountId: z.string().uuid(),
  currency: z.string().regex(/^[a-z0-9_]{2,24}$/i),
  amountUsd: z.number().min(1).max(1_000_000).optional(),
});
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`onramp:${u.id}`, 30, 60);
  const b = await parse(req, Body);
  const cfg = await onrampConfig();
  if (!cfg) throw new HttpError(400, "No card on-ramp is set up yet. Add a MoonPay or Transak key in Broker & AI keys → Platform APIs (or Admin → Integrations).");
  const w = (await destinations(u.id)).find((d) => d.id === b.accountId);
  if (!w) throw new HttpError(404, "Pick one of your Solana wallets to receive the coins");
  const origin = new URL(req.url).origin;
  const url = buildWidgetUrl(cfg, { address: w.address, currency: b.currency, amountUsd: b.amountUsd, redirectUrl: `${origin}/wallet?onramp=done` });
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "funding.onramp_opened", target: w.id, data: { provider: cfg.provider, env: cfg.env, currency: b.currency, amountUsd: b.amountUsd ?? null } });
  return ok({ url, provider: cfg.provider, env: cfg.env });
});
