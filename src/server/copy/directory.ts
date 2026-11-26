import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { getCredential } from "../providers/credentials";
import { contextFor, providerUsable } from "../providers/integrations";
import { readJson } from "../providers/http";
import { createFollow } from "./service";
import { CopySettings } from "./schema";

/**
 * Trader directory: everyone whose trading is visible to Merod, on and off the platform.
 *  - wallets: public Solana wallets trading the most active coins (Birdeye top traders, on-chain = public), plus any wallet you follow.
 *  - merod:   every Merod trader with a public profile; crypto and stock P&L, trades and win rate (30d). Mimic needs their consent.
 *  - stocks:  Merod traders with stock activity, including consenting traders' linked outside brokers.
 * Off-Merod stock and centralized-exchange trades are private (brokers don't publish who traded), so they can't be listed or mimicked.
 */
const SOL_MINT = "So11111111111111111111111111111111111111112";
const MIMIC = CopySettings.parse({ sizing: "percent", percent: 100, maxTradeUsd: 1_000_000, maxDailyUsd: 1000, copySells: true, includeExternal: false, includePaper: false });
let walletCache: { at: number; key: string; rows: any[] } | null = null;

async function birdeyeWallets(userId: string) {
  const own = await one("SELECT 1 FROM user_provider_secrets WHERE user_id=$1 AND provider_id='birdeye' AND environment='production' AND status='connected'", [userId]);
  if (!own && !(await providerUsable("birdeye", "production"))) return { connected: false, rows: [] as any[] };
  const ck = own ? userId : "platform";
  if (walletCache && walletCache.key === ck && Date.now() - walletCache.at < 120_000) return { connected: true, rows: walletCache.rows };
  const key = await getCredential("birdeye", "production", "BIRDEYE_API_KEY", own ? userId : undefined);
  const ctx = contextFor("birdeye", "production", own ? { userId, userOnly: true } : {});
  const tokens = [{ symbol: "SOL", identifier: SOL_MINT }, ...(await q<any>(
    `SELECT upper(symbol) AS symbol, identifier FROM assets WHERE venue='solana' AND identifier <> 'native' AND last_price IS NOT NULL AND NOT ('demo_data'=ANY(risk_flags))
      ORDER BY volume_24h DESC NULLS LAST LIMIT 5`))];
  const byWallet = new Map<string, any>();
  for (const t of tokens) {
    try {
      const j = await readJson(await ctx.fetch(`https://public-api.birdeye.so/defi/v2/tokens/top_traders?address=${t.identifier}&time_frame=24h&sort_type=desc&sort_by=volume&offset=0&limit=10`,
        { headers: { "X-API-KEY": key!, "x-chain": "solana", accept: "application/json" } }), "birdeye");
      for (const it of j?.data?.items ?? []) {
        const w = it.owner; if (!w) continue;
        const cur = byWallet.get(w) ?? { address: w, tokens: [] as string[], trades: 0, buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, volume: 0, source: "Birdeye (on-chain)" };
        cur.tokens.push(t.symbol); cur.trades += Number(it.trade ?? 0); cur.buys += Number(it.tradeBuy ?? 0); cur.sells += Number(it.tradeSell ?? 0);
        cur.buyUsd += Number(it.volumeBuy ?? 0); cur.sellUsd += Number(it.volumeSell ?? 0); cur.volume += Number(it.volume ?? 0);
        byWallet.set(w, cur);
      }
    } catch { /* quota / endpoint unavailable: skip this token */ }
  }
  const rows = [...byWallet.values()].sort((a, b) => b.volume - a.volume).slice(0, 60);
  walletCache = { at: Date.now(), key: ck, rows };
  return { connected: true, rows };
}

export async function directory(userId: string) {
  const [bird, follows] = await Promise.all([
    birdeyeWallets(userId),
    q<any>(`SELECT f.id, f.kind, f.wallet_address, f.leader_user_id, f.status, f.mode, f.sizing, f.label,
                   (SELECT count(*)::int FROM copy_trade_events e WHERE e.follow_id=f.id AND e.created_at > now() - interval '7 days') AS seen_7d,
                   (SELECT max(e.leader_at) FROM copy_trade_events e WHERE e.follow_id=f.id) AS last_at
              FROM copy_follows f WHERE f.follower_id=$1`, [userId]),
  ]);
  const wallets = [...bird.rows];
  for (const f of follows.filter((x) => x.kind === "wallet" && !wallets.some((w) => w.address === x.wallet_address)))
    wallets.push({ address: f.wallet_address, tokens: [], trades: f.seen_7d, buys: null, sells: null, buyUsd: null, sellUsd: null, volume: null, source: "Followed by you", lastAt: f.last_at });
  const traders = await q<any>(
    `SELECT p.user_id, p.handle, p.display_name, p.avatar_color, p.allow_copy_trading,
            COUNT(o.*) FILTER (WHERE o.status='filled')::int AS trades,
            COUNT(o.*) FILTER (WHERE o.status='filled' AND o.side='sell' AND o.realized_pnl > 0)::int AS wins,
            COUNT(o.*) FILTER (WHERE o.status='filled' AND o.side='sell' AND o.realized_pnl <> 0)::int AS closes,
            COALESCE(SUM(o.realized_pnl) FILTER (WHERE a.asset_class='crypto'),0) AS crypto_pnl,
            COALESCE(SUM(o.realized_pnl) FILTER (WHERE a.asset_class IN ('stock','etf')),0) AS stock_pnl,
            COUNT(o.*) FILTER (WHERE o.status='filled' AND a.asset_class='crypto')::int AS crypto_trades,
            COUNT(o.*) FILTER (WHERE o.status='filled' AND a.asset_class IN ('stock','etf'))::int AS stock_trades,
            COALESCE(SUM(o.filled_quantity*o.avg_fill_price) FILTER (WHERE o.status='filled'),0) AS volume,
            BOOL_OR(NOT o.is_paper) AS has_live, MAX(o.updated_at) AS last_at,
            EXISTS (SELECT 1 FROM user_provider_secrets s WHERE s.user_id=p.user_id AND s.status='connected' AND s.provider_id IN ('alpaca_trading','kraken','coinbase_advanced')) AS outside_broker
       FROM user_profiles p
       LEFT JOIN orders o ON o.user_id=p.user_id AND o.updated_at > now() - interval '30 days' AND o.source <> 'copy'
       LEFT JOIN assets a ON a.id=o.asset_id
      WHERE p.user_id <> $1 AND COALESCE(p.is_public, true)
      GROUP BY p.user_id, p.handle, p.display_name, p.avatar_color, p.allow_copy_trading
      ORDER BY (COALESCE(SUM(o.realized_pnl),0)) DESC, COUNT(o.*) DESC LIMIT 200`, [userId]).catch(async () => q<any>(
    `SELECT p.user_id, p.handle, p.display_name, p.avatar_color, p.allow_copy_trading, 0 AS trades, 0 AS wins, 0 AS closes, 0 AS crypto_pnl, 0 AS stock_pnl, 0 AS crypto_trades, 0 AS stock_trades, 0 AS volume, false AS has_live, NULL AS last_at, false AS outside_broker
       FROM user_profiles p WHERE p.user_id <> $1 LIMIT 200`, [userId]));
  const userFollow = new Map(follows.filter((f) => f.kind === "user").map((f) => [f.leader_user_id, f]));
  const walletFollow = new Map(follows.filter((f) => f.kind === "wallet").map((f) => [f.wallet_address, f]));
  const mimicking = (f: any) => !!f && f.status === "active" && f.mode !== "watch" && f.sizing !== "fixed";
  const merod = traders.map((t) => ({
    handle: t.handle, name: t.display_name, color: t.avatar_color, copyable: !!t.allow_copy_trading, trades: t.trades, winRate: t.closes ? (t.wins / t.closes) * 100 : null,
    cryptoPnl: Number(t.crypto_pnl), stockPnl: Number(t.stock_pnl), cryptoTrades: t.crypto_trades, stockTrades: t.stock_trades, volume: Number(t.volume), live: !!t.has_live,
    outsideBroker: !!t.outside_broker && !!t.allow_copy_trading, lastAt: t.last_at, follow: userFollow.get(t.user_id) ?? null, mimic: mimicking(userFollow.get(t.user_id)),
  }));
  return {
    wallets: wallets.map((w) => ({ ...w, follow: walletFollow.get(w.address) ?? null, mimic: mimicking(walletFollow.get(w.address)) })),
    birdeye: bird.connected,
    merod: merod.filter((m) => m.cryptoTrades > 0 || m.stockTrades === 0),
    stocks: merod.filter((m) => m.stockTrades > 0 || m.outsideBroker),
    limits: "Off-Merod stock trades and centralized-exchange (Coinbase, Kraken, Binance) trades are private, so they can't be listed or mimicked. Public Solana wallets and Merod traders who allow copying can be.",
  };
}

/** Mimic switch for many targets at once. On = create/resume a mimic follow for each; Off = pause them. */
export async function mimicMany(userId: string, group: "wallets" | "merod" | "stocks", on: boolean, targets: string[]) {
  const list = [...new Set(targets)].slice(0, 60);
  if (!list.length) throw new HttpError(400, "Nothing to mimic in this list");
  let done = 0; const skipped: string[] = [];
  for (const t of list) {
    try {
      if (group === "wallets") {
        if (on) await createFollow(userId, { kind: "wallet", network: "solana", address: t }, MIMIC as any, "copy");
        else await q("UPDATE copy_follows SET status='paused' WHERE follower_id=$1 AND kind='wallet' AND wallet_address=$2", [userId, t]);
      } else {
        if (on) await createFollow(userId, { kind: "user", handle: t }, MIMIC as any, "copy");
        else await q("UPDATE copy_follows SET status='paused' WHERE follower_id=$1 AND kind='user' AND leader_user_id=(SELECT user_id FROM user_profiles WHERE lower(handle)=lower($2))", [userId, t.replace(/^@/, "")]);
      }
      done++;
    } catch (e: any) { skipped.push(`${t.slice(0, 12)}: ${String(e.message).slice(0, 80)}`); }
  }
  await audit({ actorType: "user", actorId: userId, userId, action: on ? "copy.mimic_all_on" : "copy.mimic_all_off", data: { group, count: done } }).catch(() => {});
  return { done, skipped };
}

/** Single Merod trader mimic switch. */
export async function mimicTrader(userId: string, handle: string, on: boolean) {
  return mimicMany(userId, "merod", on, [handle]);
}
