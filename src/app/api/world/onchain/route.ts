import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { getCredential } from "@/server/providers/credentials";
import { contextFor, providerUsable } from "@/server/providers/integrations";
import { readJson } from "@/server/providers/http";

/**
 * Live Solana swaps WITH the trader's wallet address (on-chain data is public), for the coins on the World page.
 * Source: Birdeye's token trades endpoint (only when an admin connected Birdeye). Cached ~10s per token to save quota.
 * Centralized exchanges (Coinbase/Kraken/Binance) never reveal who traded, so those can't be identified.
 */
const SOL_MINT = "So11111111111111111111111111111111111111112";
const cache = new Map<string, { at: number; rows: any[] }>();

export const GET = route(async (req) => {
  await requireUser();
  if (!(await providerUsable("birdeye", "production"))) return ok({ connected: false, trades: [] });
  const key = await getCredential("birdeye", "production", "BIRDEYE_API_KEY");
  const syms = (new URL(req.url).searchParams.get("symbols") ?? "SOL").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
  const assets = await q<{ symbol: string; identifier: string }>(
    "SELECT DISTINCT ON (upper(symbol)) upper(symbol) AS symbol, identifier FROM assets WHERE venue='solana' AND upper(symbol) = ANY($1) AND identifier <> 'native' ORDER BY upper(symbol), volume_24h DESC NULLS LAST", [syms]);
  const targets = [...(syms.includes("SOL") ? [{ symbol: "SOL", identifier: SOL_MINT }] : []), ...assets.filter((a) => a.symbol !== "SOL")].slice(0, 6);
  const ctx = contextFor("birdeye", "production");
  const out: any[] = [];
  for (const t of targets) {
    let hit = cache.get(t.identifier);
    if (!hit || Date.now() - hit.at > 10_000) {
      try {
        const j = await readJson(await ctx.fetch(`https://public-api.birdeye.so/defi/txs/token?address=${t.identifier}&offset=0&limit=40&tx_type=swap&sort_type=desc`, {
          headers: { "X-API-KEY": key!, "x-chain": "solana", accept: "application/json" } }), "birdeye");
        const rows = (j?.data?.items ?? []).map((it: any) => {
          const leg = [it.from, it.to, it.base, it.quote].find((x: any) => x?.address === t.identifier) ?? it.base ?? it.to;
          const amount = Number(leg?.uiAmount ?? leg?.ui_amount ?? 0);
          const px = Number(leg?.price ?? leg?.nearestPrice ?? it.pricePair ?? 0);
          const side = it.side === "buy" || it.side === "sell" ? it.side : it.to?.address === t.identifier ? "buy" : "sell";
          return { tx: it.txHash, wallet: it.owner, symbol: t.symbol, side, amount, usd: Number(it.volumeUSD ?? it.volume_usd ?? amount * px) || null, dex: it.source ?? null, at: Number(it.blockUnixTime) * 1000 };
        }).filter((r: any) => r.wallet && r.tx);
        hit = { at: Date.now(), rows };
        cache.set(t.identifier, hit);
      } catch { hit = { at: Date.now(), rows: hit?.rows ?? [] }; cache.set(t.identifier, hit); }
    }
    out.push(...hit.rows);
  }
  out.sort((a, b) => b.at - a.at);
  return ok({ connected: true, trades: out.slice(0, 120) });
});
