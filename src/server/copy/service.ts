import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { publish } from "../realtime";
import { place, notify } from "../engine/engine";
import { contextFor } from "../providers/integrations";
import { getCredential } from "../providers/credentials";
import { readJson } from "../providers/http";
import { coinbaseFetch, krakenPrivate } from "../providers/exchanges";

/**
 * COPY TRADING
 * A follower (today: the super admin) mirrors a leader's trades into their own account, automatically.
 * Sources a leader's trades come from:
 *  1. Trades the leader makes on Merod (paper and/or real).
 *  2. Trades the leader makes OUTSIDE Merod in their own Alpaca, Kraken or Coinbase account, read with the keys
 *     the leader connected to Merod.
 *  Both require the leader's explicit consent ("Let others copy my trades"). Their keys were given for their own
 *  use; reading their private activity for someone else without consent is not allowed.
 *  3. A public Solana wallet's swaps (public on-chain data, no consent needed), read via Helius.
 * Every copy is an ordinary Merod order: same risk checks, limits, approval mode and live-trading flags.
 * Real-money copies additionally need the "automated real money" flag, like bots.
 */

export interface FollowSettings {
  accountId?: string | null; sizing: "fixed" | "percent"; fixedUsd: number; percent: number; maxTradeUsd: number; maxDailyUsd: number;
  copySells: boolean; includeExternal: boolean; includePaper: boolean;
}
type Follow = { id: string; follower_id: string; kind: "user" | "wallet"; leader_user_id: string | null; wallet_network: string | null; wallet_address: string | null; label: string;
  account_id: string | null; sizing: string; fixed_usd: string; percent: string; max_trade_usd: string; max_daily_usd: string; copy_sells: boolean; include_external: boolean;
  include_paper: boolean; status: string; cursor: Record<string, any>; created_at: string; mode: "copy" | "watch"; scope?: MimicScope | null };
type LeaderTrade = { ref: string; origin: "merod" | "broker" | "onchain"; venue: string; side: "buy" | "sell"; symbol?: string; assetId?: string | null; mint?: string;
  qty: number; price: number | null; at: Date; leaderPositionAfter?: number | null };

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/* ───────────────────────── Follows ───────────────────────── */
/** Limit a mimic bot to part of the market (set by prompt-made bots, e.g. "Solana meme coins"). */
export type MimicScope = { label: string; assetClasses?: string[]; venue?: string; meme?: boolean; symbol?: string };

export async function createFollow(followerId: string, target: { kind: "user"; handle: string } | { kind: "wallet"; network: "solana"; address: string }, s: FollowSettings, mode: "copy" | "watch" = "copy", scope: MimicScope | null = null) {
  await validateAccount(followerId, s.accountId);
  if (target.kind === "user") {
    const leader = await one<{ user_id: string; handle: string; display_name: string; allow_copy_trading: boolean }>(
      "SELECT user_id, handle, display_name, allow_copy_trading FROM user_profiles WHERE lower(handle)=lower($1)", [target.handle.replace(/^@/, "")]);
    if (!leader) throw new HttpError(404, "Trader not found");
    if (leader.user_id === followerId) throw new HttpError(400, "You can't copy yourself");
    if (!leader.allow_copy_trading) throw new HttpError(403, `@${leader.handle} hasn't allowed copy trading. They can turn it on in Settings → Privacy.`);
    const row = await one<{ id: string }>(
      `INSERT INTO copy_follows (follower_id, kind, leader_user_id, label, account_id, sizing, fixed_usd, percent, max_trade_usd, max_daily_usd, copy_sells, include_external, include_paper, scope)
       VALUES ($1,'user',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (follower_id, leader_user_id) WHERE kind = 'user' DO UPDATE SET status='active', mode='copy',
         sizing=EXCLUDED.sizing, fixed_usd=EXCLUDED.fixed_usd, percent=EXCLUDED.percent, max_trade_usd=EXCLUDED.max_trade_usd, max_daily_usd=EXCLUDED.max_daily_usd,
         copy_sells=EXCLUDED.copy_sells, include_external=EXCLUDED.include_external, include_paper=EXCLUDED.include_paper, account_id=EXCLUDED.account_id, scope=EXCLUDED.scope RETURNING id`,
      [followerId, leader.user_id, `@${leader.handle}`, s.accountId ?? null, s.sizing, s.fixedUsd, s.percent, s.maxTradeUsd, s.maxDailyUsd, s.copySells, s.includeExternal, s.includePaper, scope ? JSON.stringify(scope) : null]);
    await notify(leader.user_id, "copy", "Someone is copying your trades", "A trader started copy trading you. You can turn copy trading off any time in Settings → Privacy.", "/settings?tab=privacy").catch(() => {});
    await audit({ actorType: "user", actorId: followerId, userId: followerId, action: "copy.follow", target: row!.id, data: { leader: leader.user_id } });
    return row!.id;
  }
  if (target.network !== "solana" || !SOL_ADDR.test(target.address.trim())) throw new HttpError(400, "Paste a valid Solana wallet address");
  const address = target.address.trim();
  const row = await one<{ id: string }>(
    `INSERT INTO copy_follows (follower_id, kind, wallet_network, wallet_address, label, account_id, sizing, fixed_usd, percent, max_trade_usd, max_daily_usd, copy_sells, include_external, include_paper, mode)
     VALUES ($1,'wallet','solana',$2,$3,$4,$5,$6,$7,$8,$9,$10,false,false,$11)
     ON CONFLICT (follower_id, wallet_network, wallet_address) WHERE kind = 'wallet' DO UPDATE SET status='active', mode=EXCLUDED.mode,
       sizing=EXCLUDED.sizing, fixed_usd=EXCLUDED.fixed_usd, percent=EXCLUDED.percent, max_trade_usd=EXCLUDED.max_trade_usd, max_daily_usd=EXCLUDED.max_daily_usd,
       copy_sells=EXCLUDED.copy_sells, account_id=EXCLUDED.account_id RETURNING id`,
    [followerId, address, `Solana ${address.slice(0, 4)}…${address.slice(-4)}`, s.accountId ?? null, s.sizing, s.fixedUsd, s.percent, s.maxTradeUsd, s.maxDailyUsd, s.copySells, mode]);
  await audit({ actorType: "user", actorId: followerId, userId: followerId, action: "copy.follow_wallet", target: row!.id, data: { address } });
  return row!.id;
}

async function validateAccount(userId: string, accountId?: string | null) {
  if (!accountId) return;
  const a = await one("SELECT 1 FROM trading_accounts WHERE id=$1 AND user_id=$2 AND status='active'", [accountId, userId]);
  if (!a) throw new HttpError(400, "That trading account isn't yours or isn't active");
}

export async function updateFollow(followerId: string, id: string, patch: Partial<FollowSettings> & { status?: "active" | "paused" }) {
  if (patch.accountId !== undefined) await validateAccount(followerId, patch.accountId);
  const cols: Record<string, unknown> = {
    status: patch.status, account_id: patch.accountId, sizing: patch.sizing, fixed_usd: patch.fixedUsd, percent: patch.percent, max_trade_usd: patch.maxTradeUsd,
    max_daily_usd: patch.maxDailyUsd, copy_sells: patch.copySells, include_external: patch.includeExternal, include_paper: patch.includePaper,
  };
  const sets: string[] = [], vals: unknown[] = [id, followerId];
  for (const [k, v] of Object.entries(cols)) if (v !== undefined) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  if (!sets.length) return;
  const r = await one(`UPDATE copy_follows SET ${sets.join(", ")} WHERE id=$1 AND follower_id=$2 RETURNING id`, vals);
  if (!r) throw new HttpError(404, "Not found");
}
export async function deleteFollow(followerId: string, id: string) {
  const r = await one("DELETE FROM copy_follows WHERE id=$1 AND follower_id=$2 RETURNING id", [id, followerId]);
  if (!r) throw new HttpError(404, "Not found");
}

export async function listFollows(followerId: string) {
  const follows = await q(
    `SELECT f.*, p.handle AS leader_handle, p.display_name AS leader_name, p.allow_copy_trading AS leader_allows, t.label AS account_label, t.kind AS account_kind,
            (SELECT count(*)::int FROM copy_trade_events e WHERE e.follow_id=f.id AND e.status='copied') AS copied,
            (SELECT count(*)::int FROM copy_trade_events e WHERE e.follow_id=f.id AND e.status IN ('skipped','failed')) AS skipped,
            (SELECT COALESCE(sum(copy_notional),0) FROM copy_trade_events e WHERE e.follow_id=f.id AND e.status IN ('copied','pending_approval') AND e.created_at > now() - interval '24 hours') AS spent_today
       FROM copy_follows f LEFT JOIN user_profiles p ON p.user_id=f.leader_user_id LEFT JOIN trading_accounts t ON t.id=f.account_id
      WHERE f.follower_id=$1 ORDER BY f.created_at DESC`, [followerId]);
  const events = await q(
    `SELECT e.*, f.label FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id WHERE f.follower_id=$1 ORDER BY e.created_at DESC LIMIT 60`, [followerId]);
  const leaders = await q(
    `SELECT p.handle, p.display_name, p.avatar_color,
            (SELECT COALESCE(sum(o.realized_pnl),0) FROM orders o WHERE o.user_id=p.user_id AND o.status='filled' AND o.updated_at > now() - interval '30 days') AS pnl_30d,
            (SELECT count(*)::int FROM orders o WHERE o.user_id=p.user_id AND o.status='filled' AND o.updated_at > now() - interval '30 days') AS trades_30d
       FROM user_profiles p WHERE p.allow_copy_trading AND p.user_id <> $1 ORDER BY pnl_30d DESC LIMIT 25`, [followerId]);
  return { follows, events, leaders };
}

/* ───────────────────────── Reading a leader's trades ───────────────────────── */
async function merodTrades(f: Follow, since: Date): Promise<LeaderTrade[]> {
  const rows = await q<any>(
    `SELECT e.id, e.executed_at, e.quantity, e.price, o.side, o.asset_id, o.is_paper, a.symbol,
            (SELECT COALESCE(sum(p.quantity),0) FROM positions p WHERE p.user_id=o.user_id AND p.asset_id=o.asset_id) AS pos_after
       FROM executions e JOIN orders o ON o.id=e.order_id JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.source <> 'copy' AND e.executed_at > $2 AND ($3 OR NOT o.is_paper)
        AND NOT EXISTS (SELECT 1 FROM copy_trade_events c WHERE c.follow_id=$4 AND c.leader_ref = 'exec:' || e.id::text)
      ORDER BY e.executed_at LIMIT 25`, [f.leader_user_id, since, f.include_paper, f.id]);
  return rows.map((r) => ({ ref: `exec:${r.id}`, origin: "merod", venue: r.is_paper ? "Merod (paper)" : "Merod", side: r.side, symbol: r.symbol, assetId: r.asset_id,
    qty: Number(r.quantity), price: Number(r.price), at: new Date(r.executed_at), leaderPositionAfter: Number(r.pos_after) }));
}

const KRAKEN_BASE: Record<string, string> = { XXBT: "BTC", XBT: "BTC", XETH: "ETH", XXDG: "DOGE", XDG: "DOGE", XXRP: "XRP", XLTC: "LTC", XXLM: "XLM", XETC: "ETC", XZEC: "ZEC", XXMR: "XMR" };
function krakenSymbol(pair: string) {
  const base = pair.replace(/(ZUSD|USD|USDT|USDC|ZEUR|EUR)$/, "");
  return KRAKEN_BASE[base] ?? (base.length === 4 && base.startsWith("X") ? base.slice(1) : base);
}

/** Leader's own account activity outside Merod (consented). Fills that Merod itself placed are skipped. */
async function brokerTrades(f: Follow, since: Date): Promise<LeaderTrade[]> {
  const keys = await q<{ provider_id: string; environment: string }>(
    "SELECT DISTINCT provider_id, environment FROM user_provider_secrets WHERE user_id=$1 AND status='connected' AND provider_id IN ('alpaca_trading','kraken','coinbase_advanced')", [f.leader_user_id]);
  const out: LeaderTrade[] = [];
  for (const k of keys) {
    const env = k.environment as "sandbox" | "production";
    const ctx = contextFor(k.provider_id, env, { userId: f.leader_user_id!, userOnly: true });
    try {
      if (k.provider_id === "alpaca_trading") {
        const base = env === "sandbox" ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
        const headers = { "APCA-API-KEY-ID": (await ctx.cred("ALPACA_API_KEY"))!, "APCA-API-SECRET-KEY": (await ctx.cred("ALPACA_API_SECRET"))! };
        const acts = await readJson(await ctx.fetch(`${base}/v2/account/activities/FILL?direction=asc&page_size=50&after=${encodeURIComponent(since.toISOString())}`, { headers }), "alpaca_trading");
        for (const a of acts as any[]) out.push({ ref: `alpaca:${a.id}`, origin: "broker", venue: env === "sandbox" ? "Alpaca (paper)" : "Alpaca", side: a.side === "buy" ? "buy" : "sell",
          symbol: String(a.symbol).replace("/USD", ""), qty: Number(a.qty), price: Number(a.price), at: new Date(a.transaction_time), _order: a.order_id } as any);
      } else if (k.provider_id === "kraken") {
        const res = await krakenPrivate(ctx, "/0/private/TradesHistory", { start: String(Math.floor(since.getTime() / 1000)) });
        for (const [id, t] of Object.entries<any>(res?.trades ?? {})) out.push({ ref: `kraken:${id}`, origin: "broker", venue: "Kraken", side: t.type === "buy" ? "buy" : "sell",
          symbol: krakenSymbol(t.pair), qty: Number(t.vol), price: Number(t.price), at: new Date(Number(t.time) * 1000), _order: t.ordertxid } as any);
      } else if (k.provider_id === "coinbase_advanced") {
        const res = await coinbaseFetch(ctx, "GET", `/api/v3/brokerage/orders/historical/fills?start_sequence_timestamp=${encodeURIComponent(since.toISOString())}&limit=50`);
        for (const t of res?.fills ?? []) out.push({ ref: `coinbase:${t.trade_id ?? t.entry_id}`, origin: "broker", venue: "Coinbase", side: t.side === "BUY" ? "buy" : "sell",
          symbol: String(t.product_id).split("-")[0], qty: Number(t.size), price: Number(t.price), at: new Date(t.trade_time), _order: t.order_id } as any);
      }
    } catch (e: any) {
      await q("UPDATE copy_follows SET last_error=$2 WHERE id=$1", [f.id, `${k.provider_id}: ${String(e.message).slice(0, 200)}`]);
    }
  }
  // Skip fills of orders Merod placed (those arrive through merodTrades already), and anything already handled.
  const fresh: LeaderTrade[] = [];
  for (const t of out.filter((x) => x.at > since)) {
    const ord = (t as any)._order;
    if (ord && await one("SELECT 1 FROM orders WHERE user_id=$1 AND provider_order_id LIKE '%' || $2", [f.leader_user_id, ord])) continue;
    if (await one("SELECT 1 FROM copy_trade_events WHERE follow_id=$1 AND leader_ref=$2", [f.id, t.ref])) continue;
    fresh.push(t);
  }
  return fresh.sort((a, b) => +a.at - +b.at).slice(0, 25);
}

const QUOTE_MINTS = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
/** A public Solana wallet's swaps via Helius' documented Enhanced Transactions API. */
async function walletTrades(f: Follow, since: Date): Promise<LeaderTrade[]> {
  // The follower's own pasted Helius key first (Broker & AI Keys), else the platform key.
  const key = await getCredential("helius", "production", "HELIUS_API_KEY", f.follower_id);
  if (!key) throw new Error("Paste a Helius API key on Broker & AI Keys (or connect it in Admin → Integrations) to follow Solana wallets");
  const ctx = contextFor("helius", "production", { userId: f.follower_id });
  const txs = await readJson(await ctx.fetch(`https://api.helius.xyz/v0/addresses/${f.wallet_address}/transactions?api-key=${key}&type=SWAP&limit=25`), "helius");
  const out: LeaderTrade[] = [];
  for (const tx of (txs as any[]) ?? []) {
    const at = new Date(Number(tx.timestamp) * 1000);
    if (at <= since || await one("SELECT 1 FROM copy_trade_events WHERE follow_id=$1 AND leader_ref LIKE $2", [f.id, `sol:${tx.signature}%`])) continue;
    const net = new Map<string, number>();
    for (const t of tx.tokenTransfers ?? []) {
      if (t.toUserAccount === f.wallet_address) net.set(t.mint, (net.get(t.mint) ?? 0) + Number(t.tokenAmount));
      if (t.fromUserAccount === f.wallet_address) net.set(t.mint, (net.get(t.mint) ?? 0) - Number(t.tokenAmount));
    }
    for (const [mint, amt] of net) {
      if (QUOTE_MINTS.has(mint) || !amt) continue;
      out.push({ ref: `sol:${tx.signature}:${mint}`, origin: "onchain", venue: "Solana wallet", side: amt > 0 ? "buy" : "sell", mint, qty: Math.abs(amt), price: null, at });
    }
  }
  return out.sort((a, b) => +a.at - +b.at);
}

/* ───────────────────────── Mirroring ───────────────────────── */
async function resolveAssetFor(t: LeaderTrade) {
  if (t.assetId) return one<any>("SELECT id, symbol, last_price, asset_class FROM assets WHERE id=$1", [t.assetId]);
  if (t.mint) {
    const known = await one<any>("SELECT id, symbol, last_price, asset_class FROM assets WHERE identifier=$1 AND venue='solana' LIMIT 1", [t.mint]);
    if (known) return known;
    // A coin Merod hasn't listed yet (typical for top-gainer meme wallets): add it from DEX Screener so it can be copied.
    const { importDexToken } = await import("../market/prices");
    return importDexToken("solana", t.mint).catch(() => null);
  }
  if (t.symbol) return one<any>(
    `SELECT id, symbol, last_price, asset_class FROM assets WHERE upper(symbol)=upper($1) AND NOT ('demo_data' = ANY(risk_flags))
      ORDER BY (asset_class IN ('stock','etf')) = $2 DESC, market_cap DESC NULLS LAST LIMIT 1`, [t.symbol, t.venue.startsWith("Alpaca")]);
  return null;
}

async function record(f: Follow, t: LeaderTrade, status: string, reason: string | null, extra: { assetId?: string | null; symbol?: string | null; orderId?: string | null; notional?: number | null } = {}) {
  await q(`INSERT INTO copy_trade_events (follow_id, leader_ref, origin, venue, symbol, asset_id, side, leader_qty, leader_price, leader_at, status, reason, follower_order_id, copy_notional)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (follow_id, leader_ref) DO NOTHING`,
    [f.id, t.ref, t.origin, t.venue, extra.symbol ?? t.symbol ?? null, extra.assetId ?? null, t.side, t.qty, t.price, t.at, status, reason?.slice(0, 300) ?? null, extra.orderId ?? null, extra.notional ?? null]);
}

async function mirror(f: Follow, t: LeaderTrade) {
  const asset = await resolveAssetFor(t);
  if (f.mode === "watch") {
    // Follow (watch-only): record and notify, never trade.
    await record(f, t, "watched", null, { assetId: asset?.id ?? null, symbol: asset?.symbol ?? t.symbol ?? t.mint?.slice(0, 6) ?? null });
    await notify(f.follower_id, "copy", `${f.label} ${t.side === "buy" ? "bought" : "sold"} ${asset?.symbol ?? t.symbol ?? "a token"}`, `${t.qty ? `${+t.qty.toPrecision(6)} ` : ""}on ${t.venue}`, "/copy").catch(() => {});
    return;
  }
  if (!asset) return record(f, t, "skipped", `${t.symbol ?? t.mint?.slice(0, 8) ?? "This token"} has no trading pair on DEX Screener (can't be priced or bought)`);
  const account = f.account_id
    ? await one<any>("SELECT id, kind FROM trading_accounts WHERE id=$1 AND user_id=$2 AND status='active'", [f.account_id, f.follower_id])
    : await one<any>("SELECT id, kind FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [f.follower_id]);
  if (!account) return record(f, t, "failed", "Your copy-trading account is missing or inactive", { assetId: asset.id, symbol: asset.symbol });
  const px = t.price ?? Number(asset.last_price ?? 0);

  let intent: any;
  let notional: number | null = null;
  if (t.side === "buy") {
    const leaderNotional = t.qty * px;
    notional = f.sizing === "fixed" ? Number(f.fixed_usd) : leaderNotional * Number(f.percent) / 100;
    if (Number(f.max_trade_usd) > 0) notional = Math.min(notional, Number(f.max_trade_usd)); // 0 = no limit
    // "Same size as the wallet" can be far more than you hold (top wallets trade $10k–$1M). Rather than failing, a copy that
    // doesn't fit is scaled to 10% of the cash available in the account, and the event says so.
    let scaledNote: string | null = null;
    if (f.sizing !== "fixed") {
      const cash = Number((await one<any>("SELECT cash_balance FROM trading_accounts WHERE id=$1", [account.id]))?.cash_balance ?? 0);
      if (notional > cash * 0.98) { const was = notional; notional = Math.max(0, cash * 0.1); scaledNote = `Scaled down: the wallet traded $${was.toFixed(0)}; copied $${notional.toFixed(2)} (10% of your $${cash.toFixed(0)} cash)`; }
    }
    // Also fit your own max-order limit (0 = no limit) instead of being refused by it.
    const lim = Number((await one<any>("SELECT max_order_usd FROM risk_settings WHERE user_id=$1", [f.follower_id]))?.max_order_usd ?? 0);
    if (lim > 0 && notional > lim) { scaledNote = `${scaledNote ? `${scaledNote}; ` : ""}capped at your $${lim} max order`; notional = lim; }
    (t as any).scaledNote = scaledNote;
    if (!(notional >= 1)) return record(f, t, "skipped", scaledNote ? "Not enough cash left to copy this trade" : "Copy size is under $1", { assetId: asset.id, symbol: asset.symbol });
    const spent = await one<{ s: string }>("SELECT COALESCE(sum(copy_notional),0) AS s FROM copy_trade_events WHERE follow_id=$1 AND status IN ('copied','pending_approval') AND created_at > now() - interval '24 hours'", [f.id]);
    if (Number(f.max_daily_usd) > 0 && Number(spent?.s ?? 0) + notional > Number(f.max_daily_usd)) return record(f, t, "skipped", `Daily copy limit of $${Number(f.max_daily_usd)} reached`, { assetId: asset.id, symbol: asset.symbol });
    intent = { asset: { assetId: asset.id }, side: "buy", orderType: "market", notionalUsd: +notional.toFixed(2), timeInForce: "gtc" };
  } else {
    if (!f.copy_sells) return record(f, t, "skipped", "Copying sells is turned off", { assetId: asset.id, symbol: asset.symbol });
    const pos = await one<{ q: string }>("SELECT COALESCE(sum(quantity),0) AS q FROM positions WHERE account_id=$1 AND asset_id=$2", [account.id, asset.id]);
    if (!(Number(pos?.q ?? 0) > 0)) return record(f, t, "skipped", `You don't hold ${asset.symbol} in that account`, { assetId: asset.id, symbol: asset.symbol });
    // Sell the same fraction the leader sold when we know it; otherwise close the copied position.
    const after = t.leaderPositionAfter;
    const pct = after != null && after >= 0 ? Math.min(100, (t.qty / (t.qty + after)) * 100) : 100;
    intent = { asset: { assetId: asset.id }, side: "sell", orderType: "market", percentOfPosition: +pct.toFixed(2), timeInForce: "gtc" };
  }
  try {
    const { order } = await place({ ...intent, accountId: account.id }, {
      userId: f.follower_id, source: "copy", sourceRef: f.id, idempotencyKey: `copy:${f.id}:${t.ref}`,
      actor: { type: "system", id: "copy-trading" },
      // Paper copies run automatically; real-money copies also need the platform's "automated real money" flag.
      userConfirmed: account.kind === "paper",
    } as any);
    const status = order.status === "filled" || order.status === "submitted" || order.status === "partially_filled" ? "copied"
      : order.status === "pending_approval" ? "pending_approval" : "failed";
    await record(f, t, status, status === "copied" ? ((t as any).scaledNote ?? null) : order.status_reason ?? order.status, { assetId: asset.id, symbol: asset.symbol, orderId: order.id, notional: notional ?? Number(order.notional_usd ?? 0) });
    await publish(`user:${f.follower_id}`, "copy", { followId: f.id, symbol: asset.symbol, side: t.side, status });
    if (status !== "failed") await notify(f.follower_id, "copy", `Copied ${f.label}: ${t.side === "buy" ? "bought" : "sold"} ${asset.symbol}`, status === "pending_approval" ? "Waiting for your approval in Portfolio → Orders." : `From their ${t.venue} trade.`, "/copy").catch(() => {});
  } catch (e: any) {
    await record(f, t, "failed", String(e?.message ?? e), { assetId: asset.id, symbol: asset.symbol });
  }
}

/** Worker loop: check every active follow for new leader trades and mirror them. */
/** Keep only the trades inside a bot's scope; a trade whose asset Merod can't identify is skipped. */
async function inScope(trades: LeaderTrade[], scope: MimicScope) {
  const ids = [...new Set(trades.map((t) => t.assetId).filter(Boolean))] as string[];
  const assets = new Map((ids.length ? await q<any>("SELECT id, symbol, asset_class, venue, categories FROM assets WHERE id = ANY($1::uuid[])", [ids]) : []).map((a) => [a.id, a]));
  return trades.filter((t) => { const a = t.assetId ? assets.get(t.assetId) : null; return !!a && assetInScope(a, scope); });
}
export function assetInScope(a: { symbol: string; asset_class: string; venue: string; categories?: string[] | null }, scope: MimicScope) {
  if (scope.symbol && a.symbol.toUpperCase() !== scope.symbol.toUpperCase()) return false;
  if (scope.assetClasses?.length && !scope.assetClasses.includes(a.asset_class)) return false;
  if (scope.venue && a.venue.toLowerCase() !== scope.venue) return false;
  if (scope.meme && !(a.categories ?? []).some((c) => /meme/i.test(c))) return false;
  return true;
}

export async function processCopyTrading() {
  const follows = await q<Follow>(
    `SELECT f.* FROM copy_follows f LEFT JOIN user_profiles p ON p.user_id=f.leader_user_id JOIN users fu ON fu.id=f.follower_id AND fu.role='super_admin'
      WHERE f.status='active' AND (f.kind='wallet' OR p.allow_copy_trading) AND (f.last_checked_at IS NULL OR f.last_checked_at < now() - interval '8 seconds')
      ORDER BY f.last_checked_at NULLS FIRST LIMIT 20`);
  let copied = 0;
  for (const f of follows) {
    await q("UPDATE copy_follows SET last_checked_at=now() WHERE id=$1", [f.id]);
    // Only trades after the follow started (never back-copy history); look back at most 1 day after downtime.
    const since = new Date(Math.max(new Date(f.created_at).getTime(), Date.now() - 86_400_000));
    try {
      const trades = f.kind === "wallet" ? await walletTrades(f, since)
        : [...await merodTrades(f, since), ...(f.include_external ? await brokerTrades(f, since) : [])].sort((a, b) => +a.at - +b.at);
      for (const t of f.scope ? await inScope(trades, f.scope) : trades) { await mirror(f, t); copied++; }
      if (f.kind === "wallet") await q("UPDATE copy_follows SET last_error=NULL WHERE id=$1", [f.id]);
    } catch (e: any) {
      await q("UPDATE copy_follows SET last_error=$2 WHERE id=$1", [f.id, String(e?.message ?? e).slice(0, 300)]);
    }
  }
  return copied;
}
