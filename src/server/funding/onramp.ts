import "@/lib/server-only-shim";
import { createHmac } from "node:crypto";
import { q } from "../db";
import { getCredential } from "../providers/credentials";
import { HttpError } from "../errors";

/**
 * Card / Apple Pay on-ramp. The user pays the provider (MoonPay or Transak) directly; the coins are delivered
 * on-chain to the user's OWN Solana wallet (a Merod Wallet or a connected Phantom/Solflare). Money never passes
 * through Merod: we only build the provider's hosted-widget URL, prefilled and (MoonPay) signed.
 */
export type OnrampProvider = "moonpay" | "transak";
export interface OnrampConfig { provider: OnrampProvider; env: "sandbox" | "production"; publishableKey: string; secretKey?: string }

/** MoonPay currency codes for Solana-network coins we always offer (more are added from MoonPay's live list). */
export const BASE_COINS = [
  { code: "sol", symbol: "SOL", name: "Solana" },
  { code: "usdc_sol", symbol: "USDC", name: "USD Coin (Solana)" },
  { code: "usdt_sol", symbol: "USDT", name: "Tether (Solana)" },
];

/** Which on-ramp is configured (Integrations / Platform APIs), production first, then sandbox. */
export async function onrampConfig(): Promise<OnrampConfig | null> {
  for (const env of ["production", "sandbox"] as const) {
    const pk = await getCredential("moonpay", env, "MOONPAY_PUBLISHABLE_KEY");
    if (pk) return { provider: "moonpay", env: pk.startsWith("pk_test_") ? "sandbox" : env, publishableKey: pk, secretKey: await getCredential("moonpay", env, "MOONPAY_SECRET_KEY") };
  }
  for (const env of ["production", "sandbox"] as const) {
    const k = await getCredential("transak", env, "TRANSAK_API_KEY");
    if (k) return { provider: "transak", env, publishableKey: k };
  }
  return null;
}

/** Sign a MoonPay widget URL: base64(HMAC-SHA256(secret, "?query")), appended as &signature=… */
export function signMoonpay(url: string, secret: string) {
  const u = new URL(url);
  const sig = createHmac("sha256", secret).update(u.search).digest("base64");
  u.searchParams.append("signature", sig);
  return u.toString();
}

export interface WidgetInput { address: string; currency: string; amountUsd?: number | null; email?: string | null; redirectUrl?: string | null }

/** Build the hosted widget URL (pure: unit-tested). */
export function buildWidgetUrl(cfg: OnrampConfig, w: WidgetInput): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w.address)) throw new HttpError(400, "Not a Solana address");
  const amount = w.amountUsd && w.amountUsd > 0 ? String(Math.round(w.amountUsd * 100) / 100) : null;
  if (cfg.provider === "moonpay") {
    const u = new URL(cfg.env === "sandbox" ? "https://buy-sandbox.moonpay.com" : "https://buy.moonpay.com");
    u.searchParams.set("apiKey", cfg.publishableKey);
    u.searchParams.set("currencyCode", w.currency.toLowerCase());
    u.searchParams.set("walletAddress", w.address);
    u.searchParams.set("baseCurrencyCode", "usd");
    if (amount) u.searchParams.set("baseCurrencyAmount", amount);
    u.searchParams.set("colorCode", "#d6b37a");
    u.searchParams.set("theme", "dark");
    if (w.redirectUrl) u.searchParams.set("redirectURL", w.redirectUrl);
    return cfg.secretKey ? signMoonpay(u.toString(), cfg.secretKey) : u.toString();
  }
  const u = new URL(cfg.env === "sandbox" ? "https://global-stg.transak.com" : "https://global.transak.com");
  u.searchParams.set("apiKey", cfg.publishableKey);
  u.searchParams.set("network", "solana");
  u.searchParams.set("cryptoCurrencyCode", w.currency.replace(/_sol$/i, "").toUpperCase());
  u.searchParams.set("walletAddress", w.address);
  u.searchParams.set("disableWalletAddressForm", "true");
  u.searchParams.set("fiatCurrency", "USD");
  if (amount) u.searchParams.set("fiatAmount", amount);
  u.searchParams.set("themeColor", "d6b37a");
  if (w.redirectUrl) u.searchParams.set("redirectURL", w.redirectUrl);
  return u.toString();
}

let coinCache: { at: number; key: string; coins: { code: string; symbol: string; name: string }[] } | null = null;
/** Solana-network coins the provider currently sells (MoonPay live list, cached 1h; Transak: the base set). */
export async function supportedCoins(cfg: OnrampConfig | null) {
  if (!cfg || cfg.provider !== "moonpay") return BASE_COINS;
  if (coinCache && coinCache.key === cfg.publishableKey && Date.now() - coinCache.at < 3_600_000) return coinCache.coins;
  try {
    const r = await fetch(`https://api.moonpay.com/v3/currencies?apiKey=${encodeURIComponent(cfg.publishableKey)}`, { signal: AbortSignal.timeout(8000) });
    const list = r.ok ? await r.json() : [];
    const sol = (Array.isArray(list) ? list : [])
      .filter((c: any) => c?.type === "crypto" && c?.metadata?.networkCode === "solana" && !c.isSuspended && (cfg.env === "sandbox" || c.supportsLiveMode !== false))
      .map((c: any) => ({ code: String(c.code), symbol: String(c.code).replace(/_sol$/, "").toUpperCase(), name: String(c.name ?? c.code).slice(0, 60) }));
    const coins = [...BASE_COINS, ...sol.filter((c) => !BASE_COINS.some((b) => b.code === c.code))];
    coinCache = { at: Date.now(), key: cfg.publishableKey, coins };
    return coins;
  } catch { return BASE_COINS; }
}

/** The user's Solana wallets that can receive coins: Merod Wallets and connected Phantom/Solflare/addresses. */
export async function destinations(userId: string) {
  return q<{ id: string; label: string; address: string; provider_id: string }>(
    `SELECT id, label, external_ref AS address, provider_id FROM trading_accounts
      WHERE user_id=$1 AND kind='wallet' AND network='solana' AND external_ref IS NOT NULL AND status <> 'disconnected'
      ORDER BY (provider_id='merod_wallet') DESC, created_at`, [userId]);
}
