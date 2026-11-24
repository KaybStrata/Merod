import "@/lib/server-only-shim";
import { one } from "../db";
import { providerUsable, contextFor } from "../providers/integrations";
import { readJson } from "../providers/http";

/** Public address formats per network (format check only — never asks for keys or seed phrases). */
export const ADDRESS_RULES: Record<string, { label: string; re: RegExp }> = {
  solana: { label: "Solana", re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
  ethereum: { label: "Ethereum", re: /^0x[a-fA-F0-9]{40}$/ },
  base: { label: "Base", re: /^0x[a-fA-F0-9]{40}$/ },
  polygon: { label: "Polygon", re: /^0x[a-fA-F0-9]{40}$/ },
  arbitrum: { label: "Arbitrum", re: /^0x[a-fA-F0-9]{40}$/ },
  avalanche: { label: "Avalanche C-Chain", re: /^0x[a-fA-F0-9]{40}$/ },
  bsc: { label: "BNB Chain", re: /^0x[a-fA-F0-9]{40}$/ },
  bitcoin: { label: "Bitcoin", re: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
  sui: { label: "Sui", re: /^0x[a-fA-F0-9]{64}$/ },
  aptos: { label: "Aptos", re: /^0x[a-fA-F0-9]{1,64}$/ },
};

export async function walletCapabilities(userId: string) {
  const [privy, snaptrade] = await Promise.all([providerUsable("privy", "production").then(async (p) => p || providerUsable("privy", "sandbox")), providerUsable("snaptrade", "production").then(async (p) => p || providerUsable("snaptrade", "sandbox"))]);
  const keyStatus = async (pid: string) => {
    const rows = await one<any>(`SELECT json_object_agg(environment, status) AS s FROM (SELECT environment, min(status) AS status FROM user_provider_secrets WHERE user_id=$1 AND provider_id=$2 GROUP BY environment) x`, [userId, pid]);
    return rows?.s ?? {};
  };
  return { privy, snaptrade, byo: { alpaca_trading: await keyStatus("alpaca_trading"), tradier: await keyStatus("tradier") } };
}

/** Fetch the cash balance of a user's own Alpaca account with THEIR keys only. */
export async function alpacaBalance(userId: string, env: "sandbox" | "production") {
  const ctx = contextFor("alpaca_trading", env, { userId, userOnly: true });
  const k = await ctx.cred("ALPACA_API_KEY"), s = await ctx.cred("ALPACA_API_SECRET");
  if (!k || !s) throw new Error("Paste your Alpaca keys in Settings → API keys first");
  const base = env === "sandbox" ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
  const j = await readJson(await ctx.fetch(`${base}/v2/account`, { headers: { "APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s } }), "alpaca_trading");
  return { cash: Number(j.cash ?? 0), accountNumber: String(j.account_number ?? j.id ?? ""), status: String(j.status ?? "") };
}
