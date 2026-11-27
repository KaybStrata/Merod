import "@/lib/server-only-shim";
import { one, q } from "./db";
import { HttpError } from "./errors";
import { randomToken, sha256 } from "./crypto";
import { place, notify } from "./engine/engine";
import { publish } from "./realtime";
import { audit } from "./audit";

/**
 * Signal bots: any outside program (Freqtrade, Hummingbot / Jesse / OctoBot scripts, TradingView alerts, curl) posts a
 * buy or sell to its personal webhook URL. Merod resolves the coin or stock, sizes the order with the key's limits and
 * places it through the normal order engine, so every risk check, permission and the Real-money switch still applies.
 * Keys are stored as hashes; the full key is shown once at creation.
 */

export type SignalKey = {
  id: string; user_id: string; name: string; key_prefix: string; account_id: string | null; enabled: boolean;
  per_trade_usd: string; max_order_usd: string; max_daily_usd: string; allow_live: boolean; last_used_at: string | null; last_error: string | null;
};

export async function createSignalKey(userId: string, o: { name: string; perTradeUsd?: number; maxOrderUsd?: number; maxDailyUsd?: number; accountId?: string | null }) {
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM signal_keys WHERE user_id=$1", [userId]);
  if ((n?.n ?? 0) >= 50) throw new HttpError(400, "You can have up to 50 signal keys. Delete one first.");
  if (o.accountId) {
    const a = await one("SELECT 1 FROM trading_accounts WHERE id=$1 AND user_id=$2", [o.accountId, userId]);
    if (!a) throw new HttpError(404, "Trading account not found");
  }
  const key = `msk_${randomToken(24)}`;
  const row = await one<SignalKey>(
    `INSERT INTO signal_keys (user_id, name, key_hash, key_prefix, account_id, per_trade_usd, max_order_usd, max_daily_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, user_id, name, key_prefix, account_id, enabled, per_trade_usd, max_order_usd, max_daily_usd, allow_live, last_used_at, last_error`,
    [userId, o.name.slice(0, 80), sha256(key), key.slice(0, 10), o.accountId ?? null, o.perTradeUsd ?? 100, o.maxOrderUsd ?? 0, o.maxDailyUsd ?? 0]);
  await audit({ actorType: "user", actorId: userId, userId, action: "signal_key.created", target: row!.id, data: { name: o.name } });
  return { key, row: row! };
}

/* ───────── Payload parsing (accepts Freqtrade, TradingView, plain text and generic JSON) ───────── */
export type ParsedSignal = { side: "buy" | "sell" | null; ignore?: string; symbol?: string; address?: string; chain?: string; usd?: number; quantity?: number; percent?: number; id?: string };

const QUOTES = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USD", "EUR", "GBP", "PERP"];
/** "BTC/USDT", "BTC/USDT:USDT", "BTC-USD", "BTCUSDT", "BINANCE:BTCUSDT", "$btc" → "BTC" */
export function baseSymbol(raw: string): string {
  let s = String(raw).trim().toUpperCase().replace(/^\$/, "");
  if (s.includes(":") && !s.includes("/")) s = s.split(":").pop()!; // TradingView "EXCHANGE:TICKER"
  s = s.split(/[/\-_ :]/)[0];
  if (!/[/\-_]/.test(raw) && s.length > 4) for (const qt of QUOTES) if (s.endsWith(qt) && s.length > qt.length + 1) { s = s.slice(0, -qt.length); break; }
  return s.replace(/[^A-Z0-9.]/g, "");
}

function sideOf(v: unknown): { side: "buy" | "sell" | null; ignore?: string } {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return { side: null };
  if (/cancel|status|startup|warning|strategy_msg|protection|fill/.test(s)) return { side: null, ignore: `"${s}" messages are informational; only entry/exit signals place orders` };
  if (/^(buy|long|entry|enter|enter_long|open|open_long|bull|accumulate)$/.test(s)) return { side: "buy" };
  if (/^(sell|exit|exit_long|close|close_long|take_profit|stop_loss|stoploss|tp|sl|bear|flat)$/.test(s)) return { side: "sell" };
  return { side: null };
}
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,%\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; };

export function parseSignal(body: unknown): ParsedSignal {
  if (typeof body === "string") {
    const t = body.trim();
    // Plain text, e.g. a TradingView alert: "buy BTC 50", "sell SOL 50%", "BTCUSDT buy", "{{strategy.order.action}} {{ticker}}"
    const m = t.match(/\b(buy|sell|long|exit|close|entry)\b/i);
    if (!m) return { side: null, ignore: "No buy/sell action found in the message" };
    const words = t.replace(m[0], " ").split(/\s+/).filter(Boolean);
    const sym = words.find((w) => /^[$A-Za-z][A-Za-z0-9.\-/:]{0,24}$/.test(w) && !/^(usd|of|at|for|with|worth|now|market)$/i.test(w));
    const pct = t.match(/(\d+(?:\.\d+)?)\s*%/), usd = t.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:usd|dollars?)\b/i) ?? t.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
    return { side: sideOf(m[1]).side, symbol: sym ? baseSymbol(sym) : undefined, percent: pct ? num(pct[1]) : undefined, usd: !pct && usd ? num(usd[1] ?? usd[2]) : undefined };
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, any>;
  const actionRaw = b.action ?? b.side ?? b.signal ?? b.order_action ?? b.direction ?? b.type;
  const s = sideOf(actionRaw);
  const symRaw = b.pair ?? b.symbol ?? b.ticker ?? b.asset ?? b.market ?? b.coin ?? b.base;
  const address = typeof (b.address ?? b.mint ?? b.contract) === "string" ? String(b.address ?? b.mint ?? b.contract) : undefined;
  return {
    side: s.side, ignore: s.ignore ?? (actionRaw == null ? "Missing \"action\" (buy or sell)" : s.side ? undefined : `Unknown action "${actionRaw}" (use buy or sell)`),
    symbol: symRaw ? baseSymbol(String(symRaw)) : undefined,
    address, chain: address ? String(b.chain ?? b.network ?? "solana").toLowerCase() : undefined,
    usd: num(b.amount_usd ?? b.usd ?? b.notional ?? b.notional_usd ?? b.size_usd ?? b.stake_amount ?? b.amount),
    quantity: num(b.quantity ?? b.qty ?? b.contracts),
    percent: num(b.percent ?? b.percent_of_position ?? b.pct),
    id: b.id ?? b.trade_id ?? b.signal_id ?? b.order_id ? String(b.id ?? b.trade_id ?? b.signal_id ?? b.order_id) : undefined,
  };
}

/* ───────── Asset resolution: pick the most liquid listing of a ticker; contract addresses import from DEX Screener ───────── */
async function resolve(p: ParsedSignal) {
  if (p.address) {
    const known = await one<any>("SELECT id, symbol FROM assets WHERE lower(identifier)=lower($1) LIMIT 1", [p.address]);
    if (known) return known;
    const { importDexToken } = await import("./market/prices");
    return importDexToken(p.chain ?? "solana", p.address);
  }
  if (!p.symbol) return null;
  return one<any>(
    `SELECT id, symbol FROM assets WHERE upper(symbol)=upper($1) AND NOT ('demo_data' = ANY(risk_flags))
      ORDER BY (last_price IS NOT NULL) DESC, market_cap DESC NULLS LAST, liquidity_usd DESC NULLS LAST LIMIT 1`, [p.symbol]);
}

async function record(k: SignalKey, p: ParsedSignal, status: string, reason: string | null, extra: { orderId?: string; notional?: number; payload?: unknown; symbol?: string } = {}) {
  const payload = extra.payload === undefined ? null : JSON.stringify(typeof extra.payload === "string" ? { text: extra.payload.slice(0, 2000) } : extra.payload).slice(0, 8000);
  await q(`INSERT INTO signal_events (key_id, user_id, action, symbol, status, reason, order_id, notional, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [k.id, k.user_id, p.side, extra.symbol ?? p.symbol ?? p.address ?? null, status, reason, extra.orderId ?? null, extra.notional ?? null, payload]);
  await q("UPDATE signal_keys SET last_used_at=now(), last_error=$2 WHERE id=$1", [k.id, status === "failed" || status === "rejected" ? reason : null]);
  return { status, reason, orderId: extra.orderId ?? null, symbol: extra.symbol ?? p.symbol ?? null, notional: extra.notional ?? null };
}

/** Handle one incoming signal. Throws HttpError(401) for a bad key; everything else is recorded and returned. */
export async function handleSignal(rawKey: string, body: unknown) {
  if (!rawKey || !rawKey.startsWith("msk_")) throw new HttpError(401, "Missing or invalid signal key. Add ?key=msk_… to the URL or send it as the X-Merod-Key header.");
  const k = await one<SignalKey>("SELECT * FROM signal_keys WHERE key_hash=$1", [sha256(rawKey)]);
  if (!k) throw new HttpError(401, "Unknown signal key");
  const p = parseSignal(body);
  if (!k.enabled) return record(k, p, "ignored", "This signal bot is turned off in Merod", { payload: body });
  if (!p.side) return record(k, p, "ignored", p.ignore ?? "No buy/sell action", { payload: body });
  if (!p.symbol && !p.address) return record(k, p, "failed", "Missing coin or stock (send \"pair\", \"symbol\" or \"ticker\")", { payload: body });

  const asset = await resolve(p);
  if (!asset) return record(k, p, "failed", `Merod couldn't find "${p.symbol ?? p.address}"`, { payload: body });

  const account = k.account_id
    ? await one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [k.account_id, k.user_id])
    : await one<any>("SELECT * FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [k.user_id]);
  if (!account) return record(k, p, "failed", "No trading account for this signal bot", { payload: body, symbol: asset.symbol });
  if (account.kind !== "paper" && !k.allow_live) return record(k, p, "rejected", "Real money is off for this signal bot. Turn it on for this key in Mimic → Signal bots.", { payload: body, symbol: asset.symbol });

  let intent: any;
  let notional: number | undefined;
  if (p.side === "buy") {
    if (p.quantity && !p.usd) intent = { quantity: p.quantity };
    else {
      notional = p.usd ?? Number(k.per_trade_usd);
      const cap = Number(k.max_order_usd);
      if (cap > 0 && notional > cap) notional = cap;
      if (!(notional >= 1)) return record(k, p, "failed", "Order size is under $1", { payload: body, symbol: asset.symbol });
      const daily = Number(k.max_daily_usd);
      if (daily > 0) {
        const spent = await one<{ s: string }>("SELECT COALESCE(sum(notional),0) AS s FROM signal_events WHERE key_id=$1 AND action='buy' AND status IN ('filled','submitted','pending_approval') AND created_at > now() - interval '24 hours'", [k.id]);
        if (Number(spent?.s ?? 0) + notional > daily) return record(k, p, "rejected", `Daily limit of $${daily} reached for this signal bot`, { payload: body, symbol: asset.symbol });
      }
      intent = { notionalUsd: +notional.toFixed(2) };
    }
  } else {
    const pos = await one<{ q: string }>("SELECT COALESCE(sum(quantity),0) AS q FROM positions WHERE account_id=$1 AND asset_id=$2", [account.id, asset.id]);
    if (!(Number(pos?.q ?? 0) > 0)) return record(k, p, "ignored", `Nothing to sell: no ${asset.symbol} in that account`, { payload: body, symbol: asset.symbol });
    intent = p.quantity ? { quantity: Math.min(p.quantity, Number(pos!.q)) } : { percentOfPosition: Math.min(100, p.percent ?? 100) };
  }

  // Retries of the same signal (same id, or the same body within a minute) never place a second order.
  const ref = p.id ? `id:${p.id}:${p.side}` : `${sha256(JSON.stringify(body ?? "")).slice(0, 20)}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const { order, replayed } = await place({ asset: { assetId: asset.id }, side: p.side, orderType: "market", timeInForce: "gtc", accountId: account.id, ...intent } as any, {
      userId: k.user_id, source: "signal", sourceRef: k.id, idempotencyKey: `signal:${k.id}:${ref}`,
      actor: { type: "bot", id: k.id },
      // Paper signals run on their own; real-money signals still need the platform's automated real-money switch (else approval).
      userConfirmed: account.kind === "paper",
    });
    if (replayed) return { status: "duplicate", reason: "Already handled this signal", orderId: order?.id ?? null, symbol: asset.symbol, notional: null };
    const st = ["filled", "partially_filled"].includes(order.status) ? "filled" : order.status === "pending_approval" ? "pending_approval" : order.status === "rejected" ? "rejected" : "submitted";
    const res = await record(k, p, st, st === "rejected" ? order.status_reason : null, { orderId: order.id, notional: notional ?? Number(order.notional_usd ?? 0), payload: body, symbol: asset.symbol });
    await publish(`user:${k.user_id}`, "signal", { keyId: k.id, symbol: asset.symbol, side: p.side, status: st });
    if (st !== "rejected") await notify(k.user_id, "signal", `${k.name}: ${p.side === "buy" ? "bought" : "sold"} ${asset.symbol}`, st === "pending_approval" ? "Waiting for your approval in Portfolio → Orders." : `Signal from ${k.name}${account.kind === "paper" ? " (paper)" : ""}.`, "/signals").catch(() => {});
    return res;
  } catch (e: any) {
    return record(k, p, "failed", String(e?.message ?? e).slice(0, 300), { payload: body, symbol: asset.symbol });
  }
}
