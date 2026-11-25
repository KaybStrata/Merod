import "@/lib/server-only-shim";
import { q, one } from "./db";

/** Production feature flags. None of these turn on just because an API key exists. */
export const FLAG_DEFS = {
  live_crypto_trading: "Real-money crypto swaps via connected/embedded wallets",
  live_brokerage_trading: "Real-money stock trading via brokerage providers (requires broker commercial approval)",
  automated_real_money: "Bots, shortcuts and prompts may execute real-money orders automatically",
  copy_trading: "Copy-trading infrastructure (requires compliance approval)",
  funding: "Deposits / brokerage funding flows",
  withdrawals: "Crypto withdrawals and brokerage withdrawals",
  embedded_wallets: "Privy embedded wallet creation",
  ai_trading: "Prompt-to-trade through AI providers",
  social_trading: "Social feed, profiles and trade sharing",
  paper_trading: "Simulated trading environment",
  auto_enable_integrations: "Automatically switch on (and test) every integration that has its keys saved, including ones added later",
  simulated_prices: "TESTING ONLY: make up prices and chart history for assets with no real data feed (off = real market data only)",
  global_trading_halt: "EMERGENCY: halt all order submission platform-wide",
} as const;
export type FlagKey = keyof typeof FLAG_DEFS;

// Convenience switches an admin can flip without an approval reference.
const NO_APPROVAL: FlagKey[] = ["auto_enable_integrations"];
const SAFE_DEFAULT_ON: FlagKey[] = ["paper_trading", "social_trading", "ai_trading", "embedded_wallets"];

export async function ensureFlags() {
  for (const [key, description] of Object.entries(FLAG_DEFS)) {
    await q(
      `INSERT INTO feature_flags (key, enabled, description, requires_approval) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`,
      [key, key === "simulated_prices" ? process.env.NODE_ENV !== "production" && process.env.MEROD_ENV !== "production" : SAFE_DEFAULT_ON.includes(key as FlagKey), description, !SAFE_DEFAULT_ON.includes(key as FlagKey) && !NO_APPROVAL.includes(key as FlagKey) && key !== "global_trading_halt"],
    );
  }
}

let cache: { at: number; flags: Record<string, boolean> } | null = null;
export async function getFlags(fresh = false): Promise<Record<FlagKey, boolean>> {
  if (!fresh && cache && Date.now() - cache.at < 3000) return cache.flags as Record<FlagKey, boolean>;
  const rows = await q<{ key: string; enabled: boolean }>("SELECT key, enabled FROM feature_flags");
  const flags: Record<string, boolean> = {};
  for (const k of Object.keys(FLAG_DEFS)) flags[k] = false;
  for (const r of rows) flags[r.key] = r.enabled;
  cache = { at: Date.now(), flags };
  return flags as Record<FlagKey, boolean>;
}
export async function flag(key: FlagKey) { return (await getFlags())[key]; }
export function invalidateFlags() { cache = null; }

export async function countryAllows(country: string | null | undefined, feature: string): Promise<boolean> {
  if (!country) return true; // no jurisdiction restriction configured
  const r = await one<{ allowed: boolean }>("SELECT allowed FROM jurisdiction_rules WHERE country=$1 AND feature=$2", [country, feature]);
  return r ? r.allowed : true;
}
