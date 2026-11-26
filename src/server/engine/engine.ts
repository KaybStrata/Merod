import "@/lib/server-only-shim";
import type { PoolClient } from "pg";
import { one, q, tx, pool } from "../db";
import { audit } from "../audit";
import { publish } from "../realtime";
import { getFlags, countryAllows } from "../flags";
import { HttpError } from "../errors";
import { AssetRow, priceInfo } from "../market/prices";
import { adapterById, adapterContext, EXECUTION_ADAPTERS, paperAdapter, type SubmitResult } from "../providers/execution";
import { EXCHANGE_IDS } from "../providers/exchanges";
import { providerUsable } from "../providers/integrations";
import type { ExecutionQuote, ProviderEnv } from "../providers/types";
import type { Check, EngineContext, OrderIntent } from "./types";
import { computeFee, describeFee, getFeeConfig } from "../fees";

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                 MEROD UNIVERSAL TRADING ENGINE                    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * Pipeline: resolve asset → resolve account/venue → candidate providers → eligibility & permissions
 * → price freshness → size → funds → risk → quote (fees/slippage) → approval decision
 * → idempotent persist → route to ONE provider → monitor → reconcile → portfolio → audit.
 *
 * Invariants:
 *  • One order = one provider. If a provider doesn't confirm, the order goes to `unknown` and is
 *    reconciled against THAT provider; it is never re-sent elsewhere.
 *  • Idempotency key is unique per user; replays return the original order.
 *  • Live orders never use simulated prices.
 *  • AI/bots cannot change permissions; they only submit intents that are checked here.
 */

interface AccountRow { id: string; user_id: string; kind: "paper" | "brokerage" | "wallet"; provider_id: string; label: string; external_ref: string | null; network: string | null; status: string; cash_balance: number; metadata: any }
interface RiskRow { max_order_usd: number; max_daily_spend_usd: number; max_daily_loss_usd: number; max_slippage_bps: number; min_liquidity_usd: number; max_price_age_sec: number; block_risky_tokens: boolean; trading_halted: boolean }
interface PermRow { mode: "manual" | "auto_within_limits" | "auto_until_approval"; auto_max_order_usd: number; auto_daily_cap_usd: number; allow_ai_prompts: boolean; allow_bots: boolean; allow_shortcuts: boolean; allowed_asset_classes: string[] }

export interface Plan {
  ok: boolean;
  isPaper: boolean;
  asset: AssetRow;
  account: Pick<AccountRow, "id" | "label" | "kind" | "provider_id" | "cash_balance">;
  providerId: string;
  providerEnv: ProviderEnv | "paper";
  intent: OrderIntent;
  quantity: number;
  notionalUsd: number;
  quote: ExecutionQuote | null;
  price: { value: number; source: string; simulated: boolean; delayed: boolean; ageSec: number } | null;
  checks: Check[];
  decision: "execute" | "pending_approval" | "rejected";
  decisionReason: string;
  position: { quantity: number; avgCost: number } | null;
  risks: string[];
}

const RISKY_FLAGS = ["honeypot", "unverified", "low_liquidity", "new_listing", "mint_authority", "freeze_authority", "high_tax"];

/* ───────────────────────── Step 1: resolve asset ───────────────────────── */
export async function resolveAsset(ref: OrderIntent["asset"]): Promise<AssetRow> {
  if (ref.assetId) {
    const a = await one<AssetRow>("SELECT * FROM assets WHERE id=$1", [ref.assetId]);
    if (!a) throw new HttpError(404, "Asset not found");
    return a;
  }
  if (ref.identifier) {
    const rows = await q<AssetRow>("SELECT * FROM assets WHERE lower(identifier)=lower($1) AND ($2::text IS NULL OR venue=$2)", [ref.identifier, ref.venue ?? null]);
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) throw new HttpError(409, `Identifier matches ${rows.length} assets on different networks — specify the network`, "ambiguous_asset");
    throw new HttpError(404, "No asset with that contract/mint address. Search Discover to import it.");
  }
  // Symbol lookup: tickers are NOT unique across chains/exchanges. Require disambiguation.
  const rows = await q<AssetRow>(
    `SELECT * FROM assets WHERE upper(symbol)=upper($1) AND ($2::text IS NULL OR venue=$2) AND NOT ('demo_data' = ANY(risk_flags))
     ORDER BY market_cap DESC NULLS LAST`, [ref.symbol, ref.venue ?? null]);
  if (rows.length === 0) throw new HttpError(404, `No asset found for "${ref.symbol}"`, "asset_not_found");
  const top = rows[0];
  // Accept the dominant listing only if it is unambiguous (single match or overwhelmingly larger).
  if (rows.length > 1 && !(top.market_cap && rows[1].market_cap !== null && top.market_cap > 20 * (rows[1].market_cap ?? 0))) {
    throw new HttpError(409, `"${ref.symbol}" matches ${rows.length} assets: ${rows.slice(0, 4).map((r) => `${r.name} on ${r.venue}`).join(", ")}`, "ambiguous_asset");
  }
  return top;
}

/* ───────────────────────── Step 2/3: account & providers ───────────────────────── */
async function resolveAccount(userId: string, accountId: string | undefined, asset: AssetRow, tradingMode: string): Promise<AccountRow> {
  if (accountId) {
    const a = await one<AccountRow>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [accountId, userId]);
    if (!a) throw new HttpError(404, "Trading account not found");
    return a;
  }
  if (tradingMode === "paper") {
    const a = await one<AccountRow>("SELECT * FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId]);
    if (!a) throw new HttpError(400, "No paper account");
    return a;
  }
  const isStock = ["stock", "etf", "option"].includes(asset.asset_class);
  const exchangeIds = [...EXCHANGE_IDS];
  if (!isStock) {
    // Crypto: prefer the user's own exchange account (no wallet signing needed) when that exchange can trade the coin.
    const ex = await q<AccountRow>("SELECT * FROM trading_accounts WHERE user_id=$1 AND status='active' AND kind='brokerage' AND provider_id = ANY($2) ORDER BY created_at", [userId, exchangeIds]);
    const hit = ex.find((x) => adapterById(x.provider_id)?.supports(asset));
    if (hit) return hit;
  }
  const a = await one<AccountRow>(
    `SELECT * FROM trading_accounts WHERE user_id=$1 AND status='active' AND kind=$2 AND ($3::text IS NULL OR network=$3 OR network IS NULL)
       AND NOT (kind='brokerage' AND provider_id = ANY($4)) ORDER BY created_at LIMIT 1`,
    [userId, isStock ? "brokerage" : "wallet", isStock ? null : asset.venue, exchangeIds]);
  if (!a) throw new HttpError(400, isStock ? "Connect a brokerage account to trade stocks live (or switch to paper mode)" : `Connect a crypto exchange account (Broker Keys → Wallet) or a ${asset.venue} wallet to trade this asset live (or switch to paper mode)`, "no_live_account");
  return a;
}

/** Live providers able to execute this asset for this account, in preference order. */
export async function candidateProviders(asset: AssetRow, account: AccountRow): Promise<{ id: string; env: ProviderEnv }[]> {
  if (account.kind === "paper") return [{ id: "paper", env: "production" }];
  const mapped = new Set((await q<{ provider_id: string }>("SELECT provider_id FROM asset_providers WHERE asset_id=$1", [asset.id])).map((r) => r.provider_id));
  const out: { id: string; env: ProviderEnv }[] = [];
  for (const ad of EXECUTION_ADAPTERS) {
    if (!ad.supports(asset)) continue;
    // Exchanges list coins by ticker, so the on-chain route map doesn't restrict them.
    if (mapped.size && !mapped.has(ad.id) && !EXCHANGE_IDS.has(ad.id)) continue;
    if (account.kind === "brokerage" && account.provider_id !== ad.id) continue;
    // Solana wallets (Merod Wallet, Phantom, Solflare) swap through Jupiter only.
    if (account.kind === "wallet" && account.network === "solana" && ad.id !== "jupiter") continue;
    const env: ProviderEnv = account.metadata?.environment === "sandbox" ? "sandbox" : "production";
    if (account.metadata?.byo_keys) {
      const ok = await one("SELECT 1 FROM user_provider_secrets WHERE user_id=$1 AND provider_id=$2 AND environment=$3 AND status='connected' LIMIT 1", [account.user_id, ad.id, env]);
      if (ok) out.push({ id: ad.id, env });
    } else if (await providerUsable(ad.id, env)) out.push({ id: ad.id, env });
  }
  return out;
}

/** Tradability shown in the UI: discoverable ≠ tradable. */
export async function effectiveTradability(asset: AssetRow): Promise<{ paper: boolean; live: boolean; providers: string[]; reason: string }> {
  const flags = await getFlags();
  const paper = ["paper_tradable", "live_tradable"].includes(asset.tradability) && flags.paper_trading;
  const providers: string[] = [];
  for (const ad of EXECUTION_ADAPTERS) if (ad.supports(asset) && ((await providerUsable(ad.id, "production")) || (await providerUsable(ad.id, "sandbox")))) providers.push(ad.id);
  const isStock = ["stock", "etf"].includes(asset.asset_class);
  const flagOn = isStock ? flags.live_brokerage_trading : flags.live_crypto_trading;
  const live = providers.length > 0 && flagOn && !asset.risk_flags.includes("demo_data") && asset.tradability !== "restricted";
  const reason = asset.risk_flags.includes("demo_data") ? "Demo data — paper only"
    : asset.tradability === "view_only" ? "View only — no supported execution provider"
    : !providers.length ? "No execution provider connected"
    : !flagOn ? `Live ${isStock ? "brokerage" : "crypto"} trading is disabled pending approval`
    : "Live tradable";
  return { paper, live, providers, reason };
}

/* ───────────────────────── Preview (steps 1–10) ───────────────────────── */
export async function preview(intent: OrderIntent, ctx: EngineContext): Promise<Plan> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, message: string, severity: Check["severity"] = "block") => checks.push({ name, ok, message, severity: ok ? undefined : severity });

  const user = await one<{ status: string; trading_mode: string; country: string | null }>("SELECT status, trading_mode, country FROM users WHERE id=$1", [ctx.userId]);
  if (!user) throw new HttpError(404, "User not found");
  const asset = await resolveAsset(intent.asset);
  const account = await resolveAccount(ctx.userId, intent.accountId, asset, user.trading_mode);
  const simulated = account.kind === "paper";
  // Broker sandbox accounts (e.g. Alpaca paper via the user's own paper keys) are not real money.
  const isPaper = simulated || account.metadata?.environment === "sandbox";
  const [risk, perms, flags] = await Promise.all([
    one<RiskRow>("SELECT * FROM risk_settings WHERE user_id=$1", [ctx.userId]),
    one<PermRow>("SELECT * FROM trading_permissions WHERE user_id=$1", [ctx.userId]),
    getFlags(),
  ]);
  if (!risk || !perms) throw new HttpError(500, "Risk settings missing");

  // ── Eligibility, flags, permissions
  add("account_active", user.status === "active" && account.status === "active", "Account active");
  add("global_halt", !flags.global_trading_halt, flags.global_trading_halt ? "Platform-wide trading halt is active" : "No platform halt");
  add("user_halt", !risk.trading_halted, risk.trading_halted ? "Your emergency stop is engaged (Settings → Risk)" : "Emergency stop not engaged");
  if (isPaper) add("paper_enabled", flags.paper_trading, "Paper trading enabled");
  else {
    const isStock = ["stock", "etf", "option"].includes(asset.asset_class);
    add("live_flag", isStock ? flags.live_brokerage_trading : flags.live_crypto_trading,
      isStock ? "Live brokerage trading requires broker commercial approval (feature flag off)" : "Live crypto trading is not activated (feature flag off)");
    add("jurisdiction", await countryAllows(user.country, isStock ? "live_brokerage_trading" : "live_crypto_trading"), "Allowed in your jurisdiction");
    if (ctx.source !== "manual" && !ctx.userConfirmed) add("auto_real_money", flags.automated_real_money, "Automated real-money execution is disabled — manual approval required", "approval");
    add("not_demo", !asset.risk_flags.includes("demo_data"), "Demo assets cannot be traded with real money");
  }
  add("asset_class_permitted", perms.allowed_asset_classes.includes(asset.asset_class), `${asset.asset_class} trading permitted by your settings`);
  const sourcePerm = ctx.source === "prompt" ? perms.allow_ai_prompts : ctx.source === "bot" || ctx.source === "copy" || ctx.source === "auto" || ctx.source === "agent" ? perms.allow_bots : ctx.source === "shortcut" ? perms.allow_shortcuts : true;
  add("source_permitted", sourcePerm, `${ctx.source} trading permitted`);
  add("tradable", simulated ? ["paper_tradable", "live_tradable"].includes(asset.tradability) : asset.tradability !== "restricted" && asset.tradability !== "unsupported" && asset.tradability !== "view_only",
    `Asset is ${asset.tradability.replace("_", " ")}`);

  // ── Price freshness
  const pi = priceInfo(asset);
  const maxAge = risk.max_price_age_sec;
  add("price_available", !!pi, pi ? `Price from ${pi.source}` : "No price available");
  if (pi) {
    add("price_fresh", pi.ageSec <= maxAge, pi.ageSec <= maxAge ? `Price ${Math.round(pi.ageSec)}s old` : `Stale price (${Math.round(pi.ageSec)}s > ${maxAge}s limit)`);
    if (!isPaper) add("price_real", !pi.simulated, "Live orders require a real market price (simulated feed is paper-only)");
  }
  const ref = pi?.price ?? 0;

  // ── Position & size
  const pos = await one<{ quantity: number; avg_cost: number }>("SELECT quantity, avg_cost FROM positions WHERE account_id=$1 AND asset_id=$2", [account.id, asset.id]);
  let quantity = intent.quantity ?? 0;
  if (intent.percentOfPosition) quantity = ((pos?.quantity ?? 0) * intent.percentOfPosition) / 100;
  const pxForSize = intent.orderType === "limit" || intent.orderType === "stop_limit" ? intent.limitPrice! : intent.orderType === "stop" ? intent.stopPrice! : ref;
  if (intent.notionalUsd && pxForSize) quantity = intent.notionalUsd / pxForSize;
  let notional = quantity * (pxForSize || ref);
  add("size_positive", quantity > 0, quantity > 0 ? `Quantity ${fmtQty(quantity)}` : intent.percentOfPosition ? "You have no position to sell" : "Order size is zero");

  // ── Providers & quote
  let providerId = "paper", providerEnv: ProviderEnv | "paper" = "paper";
  let quote: ExecutionQuote | null = null;
  const slippageBps = Math.min(intent.maxSlippageBps ?? risk.max_slippage_bps, ctx.botLimits?.maxSlippageBps ?? Infinity, risk.max_slippage_bps);
  if (quantity > 0 && ref > 0) {
    // Dollar-denominated market orders spend exactly the requested notional (quantity derives from the quote).
    const byNotional = !!intent.notionalUsd && intent.orderType === "market";
    const req = { asset, side: intent.side, quantity: byNotional ? undefined : quantity, notionalUsd: byNotional ? intent.notionalUsd : undefined, refPrice: ref, slippageBps, account };
    if (simulated) {
      quote = await paperAdapter.quote(adapterContext("paper", "production"), req);
    } else {
      const cands = (await candidateProviders(asset, account)).filter((c) => !intent.providerId || c.id === intent.providerId);
      add("provider_available", cands.length > 0, cands.length ? `Route via ${cands.map((c) => c.id).join(" / ")}` : "No connected, enabled execution provider supports this asset");
      for (const c of cands) {
        try { quote = await adapterById(c.id)!.quote(adapterContext(c.id, c.env, account), req); providerId = c.id; providerEnv = c.env; break; }
        catch (e: any) { add(`quote_${c.id}`, false, `Quote failed on ${c.id}: ${e.message}`, "warn"); }
      }
      if (cands.length) add("quote_obtained", !!quote, quote ? `Quote from ${providerId}` : "No provider returned a valid quote");
    }
    if (quote) { quantity = quote.quantity; notional = intent.orderType === "market" ? quote.notionalUsd : notional; }
  }

  // ── Funds
  if (intent.side === "buy") {
    const fc = await getFeeConfig();
    const need = notional + (quote?.feeUsd ?? 0) + (fc.mode === "commission" ? computeFee(fc, { side: "buy", notional, realizedGross: 0 }) : 0);
    const known = simulated || account.metadata?.balance_synced;
    const held = known ? await reservedCash(account.id) : 0;
    const avail = Number(account.cash_balance) - held;
    add("funds", !known || avail >= need, known ? `Need $${need.toFixed(2)}, available $${avail.toFixed(2)}${held > 0 ? ` (after $${held.toFixed(2)} reserved by open orders)` : ""}` : "Balance verified by provider at execution");
  } else {
    add("position", (pos?.quantity ?? 0) + 1e-12 >= quantity, `Holding ${fmtQty(pos?.quantity ?? 0)}, selling ${fmtQty(quantity)}`);
  }

  // ── Risk limits
  const today = await one<{ spend: number; loss: number; auto: number }>(
    `SELECT COALESCE(SUM(CASE WHEN side='buy' AND status IN ('filled','partially_filled','submitted','validated') THEN COALESCE(notional_usd, quantity*avg_fill_price, 0) END),0) AS spend,
            COALESCE(-SUM(LEAST(realized_pnl,0)),0) AS loss,
            COALESCE(SUM(CASE WHEN side='buy' AND auth_info->>'mode' LIKE 'auto%' AND status IN ('filled','partially_filled','submitted') THEN notional_usd END),0) AS auto
       FROM orders WHERE user_id=$1 AND is_paper=$2 AND created_at >= date_trunc('day', now())`, [ctx.userId, isPaper]);
  // A limit of 0 (or empty) means "no limit". Buying power is still always checked (you can't spend money you don't have).
  const lim = (x: unknown) => (Number(x) > 0 ? Number(x) : Infinity);
  const show = (x: number) => (Number.isFinite(x) ? `$${fmtUsd(x)}` : "no limit");
  const maxOrder = Math.min(lim(risk.max_order_usd), lim(intent.spendingLimitUsd), lim(ctx.botLimits?.maxPositionUsd));
  if (intent.side === "buy") {
    add("max_order", notional <= maxOrder + 1e-9, `Order $${notional.toFixed(2)} vs limit ${show(maxOrder)}`);
    add("daily_spend", (today?.spend ?? 0) + notional <= lim(risk.max_daily_spend_usd), `Today $${fmtUsd(today?.spend ?? 0)} + $${notional.toFixed(2)} vs daily limit ${show(lim(risk.max_daily_spend_usd))}`);
  }
  add("daily_loss", (today?.loss ?? 0) < lim(risk.max_daily_loss_usd), `Realized loss today $${fmtUsd(today?.loss ?? 0)} vs limit ${show(lim(risk.max_daily_loss_usd))}`);
  // A bot set to "never reject" lets risk-flag, liquidity and slippage findings through. They stay visible as "allowed".
  const allowRisky = !!ctx.botLimits?.allowRisky && ctx.source === "bot";
  const allowed = (ok: boolean, detail: string) => (ok || !allowRisky ? detail : `${detail} (allowed: bot set to never reject)`);
  if (quote) add("slippage", allowRisky || quote.slippageBps <= slippageBps, allowed(quote.slippageBps <= slippageBps, `Est. slippage ${quote.slippageBps} bps vs max ${slippageBps} bps`));
  // With flagged coins allowed in your Risk settings, a bot's own minimum liquidity doesn't block either (your setting wins).
  const minLiq = risk.block_risky_tokens ? Math.max(risk.min_liquidity_usd, ctx.botLimits?.minLiquidityUsd ?? 0) : Number(risk.min_liquidity_usd) || 0;
  if (asset.asset_class === "crypto" && asset.liquidity_usd != null && intent.side === "buy")
    add("liquidity", allowRisky || asset.liquidity_usd >= minLiq, allowed(asset.liquidity_usd >= minLiq, `Liquidity $${fmtUsd(asset.liquidity_usd)} vs min $${fmtUsd(minLiq)}`), ctx.source === "bot" || ctx.source === "agent" ? "block" : "approval");
  const risky = asset.risk_flags.filter((f) => RISKY_FLAGS.includes(f));
  if (risky.length && intent.side === "buy") add("token_screening", allowRisky || !risk.block_risky_tokens, allowed(!risk.block_risky_tokens, `Risk flags: ${risky.join(", ")}`), ctx.source === "bot" || ctx.source === "agent" ? "block" : "approval");
  if (intent.limitPrice && ref) {
    const dev = Math.abs(intent.limitPrice - ref) / ref;
    add("price_deviation", dev <= 0.5, `Limit ${(dev * 100).toFixed(1)}% from market`, "warn");
  }
  if (intent.takeProfit && ref && intent.side === "buy") add("take_profit_sane", intent.takeProfit > ref, "Take-profit above entry", "warn");
  if (intent.stopLoss && ref && intent.side === "buy") add("stop_loss_sane", intent.stopLoss < ref, "Stop-loss below entry", "warn");

  // ── Approval decision
  const blocking = checks.filter((c) => !c.ok && c.severity === "block");
  const needsApproval = checks.filter((c) => !c.ok && c.severity === "approval");
  let decision: Plan["decision"] = "execute", reason = "All checks passed";
  if (blocking.length) { decision = "rejected"; reason = blocking.map((c) => c.message).join("; "); }
  else if (ctx.userConfirmed) { decision = "execute"; reason = "Approved by you"; }
  else if (ctx.source === "manual") { decision = "pending_approval"; reason = "Confirm to place this order"; }
  else if (needsApproval.length) { decision = "pending_approval"; reason = needsApproval.map((c) => c.message).join("; "); }
  else if (ctx.botLimits?.approvalRequired) { decision = "pending_approval"; reason = "Bot is configured to require approval"; }
  else {
    const within = notional <= lim(perms.auto_max_order_usd) && (today?.auto ?? 0) + notional <= lim(perms.auto_daily_cap_usd);
    if (perms.mode === "manual") { decision = "pending_approval"; reason = "Manual Approval mode: every transaction needs your confirmation"; }
    else if (!within && perms.mode === "auto_within_limits") { decision = "rejected"; reason = `Exceeds automation permissions ($${fmtUsd(perms.auto_max_order_usd)}/order, $${fmtUsd(perms.auto_daily_cap_usd)}/day)`; }
    else if (!within) { decision = "pending_approval"; reason = "Exceeds automation limits — approval required"; }
    else reason = `Auto-approved within permissions (${perms.mode.replace(/_/g, " ")})`;
  }

  const risks: string[] = [];
  if (pi?.simulated) risks.push("Simulated price — paper trading only");
  if (pi?.delayed) risks.push("Market data is delayed");
  if (risky.length) risks.push(`Token risk flags: ${risky.join(", ")}`);
  if (asset.categories.includes("meme")) risks.push("Meme coins are extremely volatile and can lose most of their value quickly");
  if (asset.lifecycle === "bonding_curve") risks.push("Token is still on its pump.fun bonding curve (thin liquidity)");
  if (!isPaper) risks.push("Real money: execution prices can differ from the quote within your slippage limit");
  // Disclose the platform fee on every preview, with an estimate for this order.
  const feeCfg = await getFeeConfig();
  if (feeCfg.pct > 0 && quote) {
    const estGross = intent.side === "sell" && pos ? (quote.price - Number(pos.avg_cost)) * quantity - quote.feeUsd : 0;
    const estFee = computeFee(feeCfg, { side: intent.side, notional: quote.notionalUsd, realizedGross: estGross });
    risks.push(`${describeFee(feeCfg)}${estFee > 0 ? ` — est. $${estFee.toFixed(2)} on this order` : intent.side === "buy" && feeCfg.mode === "performance" ? " — charged later only if you close at a profit" : ""}${isPaper ? " (virtual)" : ""}`);
  }

  return {
    ok: decision !== "rejected", isPaper, asset, account: { id: account.id, label: account.label, kind: account.kind, provider_id: account.provider_id, cash_balance: account.cash_balance },
    providerId, providerEnv, intent, quantity, notionalUsd: notional, quote,
    price: pi ? { value: pi.price, source: pi.source, simulated: pi.simulated, delayed: pi.delayed, ageSec: Math.round(pi.ageSec) } : null,
    checks, decision, decisionReason: reason, position: pos ? { quantity: pos.quantity, avgCost: pos.avg_cost } : null, risks,
  };
}

/* ───────────────────────── Buying-power reservations ───────────────────────── */
const OPEN_STATUSES = "('validated','submitted','partially_filled','pending_approval','unknown')";
/** Cash held by this account's open buy orders (remaining unfilled part of each reservation). */
export async function reservedCash(accountId: string, excludeOrderId?: string, c?: PoolClient) {
  const sql = `SELECT COALESCE(SUM(r.amount * CASE WHEN COALESCE(o.quantity,0) > 0 THEN GREATEST(0, 1 - COALESCE(o.filled_quantity,0) / o.quantity) ELSE 1 END),0) AS r
                 FROM cash_reservations r JOIN orders o ON o.id=r.order_id
                WHERE r.account_id=$1 AND o.status IN ${OPEN_STATUSES} AND ($2::uuid IS NULL OR o.id <> $2::uuid)`;
  const row = c ? (await c.query(sql, [accountId, excludeOrderId ?? null])).rows[0] : await one<{ r: string }>(sql, [accountId, excludeOrderId ?? null]);
  return Number(row?.r ?? 0);
}
/**
 * Atomically reserve buying power for an opening order. A per-account advisory lock serialises concurrent sessions,
 * so two strategies can never both spend the same cash. If it doesn't fit, the order is rejected with a reason code.
 */
async function reserveFor(order: any, need: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!(need > 0)) return { ok: true };
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [order.account_id]);
    const acct = (await c.query("SELECT cash_balance, kind, metadata FROM trading_accounts WHERE id=$1", [order.account_id])).rows[0];
    const known = acct?.kind === "paper" || acct?.metadata?.balance_synced;
    if (!known) return { ok: true as const };
    const reserved = await reservedCash(order.account_id, order.id, c);
    const available = Number(acct.cash_balance) - reserved;
    if (available + 1e-9 < need) {
      const reason = `INSUFFICIENT_BUYING_POWER: need $${need.toFixed(2)}, available $${Math.max(0, available).toFixed(2)} ($${reserved.toFixed(2)} reserved by other open orders/sessions)`;
      await c.query("UPDATE orders SET status='rejected', status_reason=$2, updated_at=now() WHERE id=$1", [order.id, reason]);
      return { ok: false as const, reason };
    }
    await c.query("INSERT INTO cash_reservations (order_id, account_id, amount) VALUES ($1,$2,$3) ON CONFLICT (order_id) DO UPDATE SET amount=EXCLUDED.amount", [order.id, order.account_id, need]);
    return { ok: true as const };
  });
}
const buyNeed = (plan: any) => Number(plan.notionalUsd || 0) + Number(plan.quote?.feeUsd ?? 0);

/* ───────────────────────── Place (persist + route) ───────────────────────── */
export async function place(intent: OrderIntent, ctx: EngineContext) {
  // Idempotency: replay returns the original order without re-executing.
  const existing = await one<any>("SELECT * FROM orders WHERE user_id=$1 AND idempotency_key=$2", [ctx.userId, ctx.idempotencyKey]);
  if (existing) return { order: existing, plan: null, replayed: true };

  const plan = await preview(intent, ctx);
  const status = plan.decision === "rejected" ? "rejected" : plan.decision === "pending_approval" ? "pending_approval" : "validated";
  const authorization = plan.decision === "execute"
    ? { mode: ctx.userConfirmed ? "user_confirmed" : `auto:${ctx.source}`, by: ctx.actor, at: new Date().toISOString() }
    : null;

  const order = await one<any>(
    `INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, notional_usd,
       limit_price, stop_price, take_profit, stop_loss, trail_percent, time_in_force, spending_limit_usd, max_slippage_bps, expires_at, is_paper,
       status, status_reason, quote, auth_info, checks)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING *`,
    [ctx.userId, plan.account.id, plan.asset.id, plan.providerId, ctx.idempotencyKey, ctx.source, ctx.sourceRef ?? null, intent.side, intent.orderType,
     plan.quantity || null, plan.notionalUsd || null, intent.limitPrice ?? null, intent.stopPrice ?? null, intent.takeProfit ?? null, intent.stopLoss ?? null,
     intent.trailPercent ?? null, intent.timeInForce, intent.spendingLimitUsd ?? null, intent.maxSlippageBps ?? null, intent.expiresAt ?? null, plan.isPaper,
     status, plan.decisionReason, plan.quote ? JSON.stringify(plan.quote) : null, authorization ? JSON.stringify(authorization) : null, JSON.stringify(plan.checks)]);
  if (!order) return { order: await one<any>("SELECT * FROM orders WHERE user_id=$1 AND idempotency_key=$2", [ctx.userId, ctx.idempotencyKey]), plan, replayed: true };

  await audit({ actorType: ctx.actor.type, actorId: ctx.actor.id ?? ctx.userId, userId: ctx.userId, action: `order.${status}`, target: order.id,
    data: { source: ctx.source, asset: plan.asset.symbol, venue: plan.asset.venue, side: intent.side, qty: plan.quantity, notional: plan.notionalUsd, provider: plan.providerId, paper: plan.isPaper, reason: plan.decisionReason }, ip: ctx.ip });
  await publish(`user:${ctx.userId}`, "order", { id: order.id, status });
  if (status === "pending_approval") await notify(ctx.userId, "approval", `Approval needed: ${intent.side} ${plan.asset.symbol}`, plan.decisionReason, `/portfolio?order=${order.id}`);
  if (status === "validated") {
    if (intent.side === "buy") {
      const res = await reserveFor(order, buyNeed(plan));
      if (!res.ok) {
        await audit({ actorType: "system", userId: ctx.userId, action: "order.rejected", target: order.id, data: { code: "INSUFFICIENT_BUYING_POWER", reason: res.reason } });
        await publish(`user:${ctx.userId}`, "order", { id: order.id, status: "rejected" });
        return { order: await one<any>("SELECT * FROM orders WHERE id=$1", [order.id]), plan, replayed: false };
      }
    }
    return { order: await route(order.id), plan, replayed: false };
  }
  return { order, plan, replayed: false };
}

/** User approves a pending order: re-run the full pipeline with fresh price before routing. */
export async function approve(orderId: string, userId: string, ip?: string) {
  const o = await one<any>("SELECT * FROM orders WHERE id=$1 AND user_id=$2", [orderId, userId]);
  if (!o) throw new HttpError(404, "Order not found");
  if (o.status !== "pending_approval") throw new HttpError(409, `Order is ${o.status}`);
  const intent = orderToIntent(o);
  const plan = await preview(intent, { userId, source: o.source, sourceRef: o.source_ref, idempotencyKey: o.idempotency_key, actor: { type: "user", id: userId }, userConfirmed: true });
  if (!plan.ok) {
    await q("UPDATE orders SET status='rejected', status_reason=$2, checks=$3, updated_at=now() WHERE id=$1", [orderId, plan.decisionReason, JSON.stringify(plan.checks)]);
    await audit({ actorType: "user", actorId: userId, userId, action: "order.approval_rejected", target: orderId, data: { reason: plan.decisionReason }, ip });
    throw new HttpError(422, `Re-validation failed: ${plan.decisionReason}`);
  }
  // Price moved beyond slippage tolerance since the preview? Require a new look.
  const prevPx = o.quote?.price, maxSlip = (o.max_slippage_bps ?? 100) / 10_000;
  if (prevPx && plan.quote && Math.abs(plan.quote.price - prevPx) / prevPx > Math.max(maxSlip, 0.005) * 3)
    throw new HttpError(409, `Price moved from ${prevPx} to ${plan.quote.price.toPrecision(6)} — review again`);
  await q(`UPDATE orders SET status='validated', quote=$2, quantity=$3, notional_usd=$4, provider_id=$5, checks=$6, auth_info=$7, status_reason='Approved by user', updated_at=now() WHERE id=$1`,
    [orderId, JSON.stringify(plan.quote), plan.quantity, plan.notionalUsd, plan.providerId, JSON.stringify(plan.checks),
     JSON.stringify({ mode: "user_confirmed", by: { type: "user", id: userId }, at: new Date().toISOString() })]);
  await audit({ actorType: "user", actorId: userId, userId, action: "order.approved", target: orderId, ip });
  if (o.side === "buy") {
    const res = await reserveFor({ ...o, status: "validated" }, buyNeed(plan));
    if (!res.ok) throw new HttpError(422, res.reason);
  }
  return route(orderId);
}

function orderToIntent(o: any): OrderIntent {
  return {
    asset: { assetId: o.asset_id }, side: o.side, orderType: o.order_type, quantity: o.quantity ?? undefined, notionalUsd: o.quantity ? undefined : o.notional_usd ?? undefined,
    limitPrice: o.limit_price ?? undefined, stopPrice: o.stop_price ?? undefined, takeProfit: o.take_profit ?? undefined, stopLoss: o.stop_loss ?? undefined,
    trailPercent: o.trail_percent ?? undefined, timeInForce: o.time_in_force, maxSlippageBps: o.max_slippage_bps ?? undefined, accountId: o.account_id,
    spendingLimitUsd: o.spending_limit_usd ?? undefined, expiresAt: o.expires_at ? new Date(o.expires_at).toISOString() : undefined,
  };
}

/* ───────────────────────── Route to exactly one provider ───────────────────────── */
async function route(orderId: string) {
  // Claim the order atomically so concurrent workers can't double-submit.
  const o = await one<any>("UPDATE orders SET status='submitted', updated_at=now() WHERE id=$1 AND status='validated' RETURNING *", [orderId]);
  if (!o) return one<any>("SELECT * FROM orders WHERE id=$1", [orderId]);
  const account = await one<AccountRow>("SELECT * FROM trading_accounts WHERE id=$1", [o.account_id]);
  const asset = await one<AssetRow>("SELECT * FROM assets WHERE id=$1", [o.asset_id]);
  const adapter = adapterById(o.provider_id);
  const env: ProviderEnv = account?.metadata?.environment === "sandbox" ? "sandbox" : "production";
  if (!adapter || !account || !asset) return fail(o, "No adapter for provider");
  let result: SubmitResult;
  try {
    result = await adapter.submit(adapterContext(o.provider_id, env, account), o, asset, account);
  } catch (e: any) {
    // Network errors after send are ambiguous: mark unknown and reconcile with THIS provider only.
    const ambiguous = e?.status === 0 && /network|timeout/i.test(e?.message ?? "");
    if (ambiguous) {
      await q("UPDATE orders SET status='unknown', status_reason=$2, updated_at=now() WHERE id=$1", [o.id, `Awaiting confirmation from ${o.provider_id}: ${e.message}`]);
      await audit({ actorType: "system", userId: o.user_id, action: "order.unknown", target: o.id, data: { provider: o.provider_id, error: e.message } });
      return one<any>("SELECT * FROM orders WHERE id=$1", [o.id]);
    }
    return fail(o, e?.message ?? "Submission failed");
  }
  await audit({ actorType: "system", userId: o.user_id, action: "order.routed", target: o.id, data: { provider: o.provider_id, result: result.status } });
  if (result.status === "filled") {
    await q("UPDATE orders SET provider_order_id=$2 WHERE id=$1", [o.id, result.providerOrderId]);
    for (const f of result.fills) await applyFill(o.id, f);
  } else if (result.status === "awaiting_signature") {
    await q("UPDATE orders SET status='pending_approval', status_reason='Awaiting wallet signature', provider_order_id=$2, unsigned_tx=$3, updated_at=now() WHERE id=$1",
      [o.id, result.providerOrderId, JSON.stringify({ tx: result.unsignedTx, network: result.signingNetwork, instructions: result.instructions })]);
    // Merod Wallet: Merod holds the key, so it signs (within the wallet's caps) and submits right away.
    if (account.provider_id === "merod_wallet") await (await import("../wallet/merod-wallet")).autoSign(o.id);
  } else {
    await q("UPDATE orders SET provider_order_id=$2, status_reason=$3, updated_at=now() WHERE id=$1",
      [o.id, result.providerOrderId, o.provider_id === "paper" ? "Resting (simulated) — fills when price reaches your level" : "Working at provider"]);
  }
  const fresh = await one<any>("SELECT * FROM orders WHERE id=$1", [o.id]);
  await publish(`user:${o.user_id}`, "order", { id: o.id, status: fresh.status });
  // Bracket: attach take-profit / stop-loss children once the entry is filled.
  if (fresh.status === "filled") await createBracketChildren(fresh);
  return fresh;
}

async function fail(o: any, reason: string) {
  await q("UPDATE orders SET status='failed', status_reason=$2, updated_at=now() WHERE id=$1", [o.id, reason.slice(0, 500)]);
  await audit({ actorType: "system", userId: o.user_id, action: "order.failed", target: o.id, data: { reason } });
  await notify(o.user_id, "fill", "Order failed", reason, `/portfolio`);
  await publish(`user:${o.user_id}`, "order", { id: o.id, status: "failed" });
  return one<any>("SELECT * FROM orders WHERE id=$1", [o.id]);
}

/* ───────────────────────── Fills → executions, positions, cash ───────────────────────── */
export async function applyFill(orderId: string, f: { quantity: number; price: number; feeUsd: number; fillId: string; txHash?: string }) {
  await tx(async (c: PoolClient) => {
    const o = await one<any>("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId], c);
    if (!o || ["cancelled", "rejected", "expired"].includes(o.status)) return;
    const ins = await one("INSERT INTO executions (order_id, provider_fill_id, quantity, price, fee_usd, tx_hash) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
      [orderId, f.fillId, f.quantity, f.price, f.feeUsd, f.txHash ?? null], c);
    if (!ins) return; // duplicate fill report (reconciliation is idempotent)
    const pos = await one<any>("SELECT * FROM positions WHERE account_id=$1 AND asset_id=$2 FOR UPDATE", [o.account_id, o.asset_id], c);
    const qty0 = Number(pos?.quantity ?? 0), avg0 = Number(pos?.avg_cost ?? 0);
    let realized = 0, qty1 = qty0, avg1 = avg0, cashDelta = 0;
    if (o.side === "buy") { qty1 = qty0 + f.quantity; avg1 = (qty0 * avg0 + f.quantity * f.price + f.feeUsd) / qty1; cashDelta = -(f.quantity * f.price + f.feeUsd); }
    else { realized = (f.price - avg0) * f.quantity - f.feeUsd; qty1 = Math.max(qty0 - f.quantity, 0); cashDelta = f.quantity * f.price - f.feeUsd; if (qty1 < 1e-12) { qty1 = 0; } }
    // Merod platform fee (performance fee on realized profit, or commission on notional) — set by the super admin.
    const platformFee = computeFee(await getFeeConfig(), { side: o.side, notional: f.quantity * f.price, realizedGross: realized });
    if (platformFee > 0) {
      cashDelta -= platformFee;
      if (o.side === "sell") realized -= platformFee; else if (qty1) avg1 += platformFee / qty1;
    }
    await c.query(
      `INSERT INTO positions (account_id, asset_id, user_id, quantity, avg_cost, realized_pnl) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_id, asset_id) DO UPDATE SET quantity=$4, avg_cost=$5, realized_pnl=positions.realized_pnl+$6, updated_at=now()`,
      [o.account_id, o.asset_id, o.user_id, qty1, qty1 ? avg1 : 0, realized]);
    if (o.provider_id === "paper" || (await one<any>("SELECT metadata FROM trading_accounts WHERE id=$1", [o.account_id], c))?.metadata?.balance_synced)
      await c.query("UPDATE trading_accounts SET cash_balance=cash_balance+$2 WHERE id=$1", [o.account_id, cashDelta]);
    const filled = Number(o.filled_quantity) + f.quantity;
    const avgFill = ((Number(o.avg_fill_price ?? 0) * Number(o.filled_quantity)) + f.price * f.quantity) / filled;
    const target = Number(o.quantity ?? filled);
    const status = filled + 1e-12 >= target * 0.999 ? "filled" : "partially_filled";
    await c.query(`UPDATE orders SET filled_quantity=$2, avg_fill_price=$3, fees_usd=fees_usd+$4, realized_pnl=realized_pnl+$5, status=$6,
                     notional_usd=COALESCE(notional_usd, $7), status_reason=$8, updated_at=now() WHERE id=$1`,
      [orderId, filled, avgFill, f.feeUsd, realized, status, filled * avgFill, status === "filled" ? (o.is_paper ? "Simulated fill" : "Confirmed by provider") : "Partially filled"]);
    await c.query(`INSERT INTO transactions (user_id, account_id, kind, asset_id, amount, amount_usd, status, tx_hash, reference, receipt)
                   VALUES ($1,$2,'trade',$3,$4,$5,'confirmed',$6,$7,$8)`,
      [o.user_id, o.account_id, o.asset_id, o.side === "buy" ? f.quantity : -f.quantity, -cashDelta, f.txHash ?? null, orderId,
       JSON.stringify({ price: f.price, fee: f.feeUsd, provider: o.provider_id, simulated: o.is_paper, fillId: f.fillId })]);
    if (platformFee > 0) {
      await c.query("UPDATE orders SET platform_fee_usd=platform_fee_usd+$2 WHERE id=$1", [orderId, platformFee]);
      // Paper: deducted in virtual dollars. Live: recorded as a pending platform charge for billing reconciliation.
      await c.query(`INSERT INTO transactions (user_id, account_id, kind, asset_id, amount, amount_usd, status, reference, receipt)
                     VALUES ($1,$2,'fee',$3,$4,$4,$5,$6,$7)`,
        [o.user_id, o.account_id, o.asset_id, -platformFee, o.is_paper ? "confirmed" : "pending", orderId,
         JSON.stringify({ type: "platform_fee", basis: (await getFeeConfig()).mode, pct: (await getFeeConfig()).pct, simulated: o.is_paper })]);
    }
    // Agent accounting (realized P&L per agent)
    if (o.source === "agent" && o.source_ref) await c.query("UPDATE agents SET realized_pnl_usd=realized_pnl_usd+$2 WHERE id::text=$1", [o.source_ref, realized]);
    // Bot accounting
    if (o.source === "bot" && o.source_ref) {
      await c.query(`UPDATE trading_bots SET pnl_usd=pnl_usd+$2, spent_today_usd=spent_today_usd+$3 WHERE id=$1`, [o.source_ref, realized, o.side === "buy" ? f.quantity * f.price : 0]);
    }
    await audit({ actorType: "system", userId: o.user_id, action: "order.fill", target: orderId, data: { qty: f.quantity, price: f.price, fee: f.feeUsd, simulated: o.is_paper } }, c);
  });
  const o = await one<any>("SELECT o.*, a.symbol FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.id=$1", [orderId]);
  await notify(o.user_id, "fill", `${o.is_paper ? "[Paper] " : ""}${o.side === "buy" ? "Bought" : "Sold"} ${fmtQty(f.quantity)} ${o.symbol}`, `@ $${fmtPrice(f.price)} · fee $${f.feeUsd.toFixed(2)}`, `/terminal/${o.asset_id}`);
  await publish(`user:${o.user_id}`, "fill", { orderId, symbol: o.symbol, side: o.side, quantity: f.quantity, price: f.price, paper: o.is_paper, source: o.source });
  // Platform-wide live tape: anonymized (no user, account or order identifiers).
  await publish("activity", "trade", { assetId: o.asset_id, symbol: o.symbol, side: o.side, quantity: f.quantity, price: f.price, paper: o.is_paper, source: o.source, ts: Date.now() });
  // OCO: when a bracket child fills, cancel its sibling
  if (o.parent_order_id && o.status === "filled") {
    const siblings = await q<any>("SELECT id FROM orders WHERE parent_order_id=$1 AND id<>$2 AND status IN ('submitted','validated','pending_approval')", [o.parent_order_id, o.id]);
    for (const s of siblings) await cancel(s.id, o.user_id, "OCO sibling filled");
  }
}

async function createBracketChildren(parent: any) {
  if (parent.side !== "buy" || (!parent.take_profit && !parent.stop_loss)) return;
  const legs: { type: string; limit?: number; stop?: number; tag: string }[] = [];
  if (parent.take_profit) legs.push({ type: "limit", limit: parent.take_profit, tag: "tp" });
  if (parent.stop_loss) legs.push({ type: "stop", stop: parent.stop_loss, tag: "sl" });
  for (const l of legs) {
    const r = await one<any>(
      `INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, source_ref, side, order_type, quantity, limit_price, stop_price,
         time_in_force, is_paper, status, status_reason, parent_order_id, auth_info, quote)
       VALUES ($1,$2,$3,$4,$5,'conditional',$6::text,'sell',$7,$8,$9,$10,'gtc',$11,'validated',$12,$15::uuid,$13,$14) ON CONFLICT DO NOTHING RETURNING id`,
      [parent.user_id, parent.account_id, parent.asset_id, parent.provider_id, `${parent.id}:${l.tag}`, parent.id, l.type, parent.filled_quantity,
       l.limit ?? null, l.stop ?? null, parent.is_paper, l.tag === "tp" ? "Take-profit leg" : "Stop-loss leg",
       JSON.stringify({ mode: "bracket_of_approved_parent", parent: parent.id }), JSON.stringify(parent.quote), parent.id]);
    if (r) await route(r.id);
  }
}

/* ───────────────────────── Cancel ───────────────────────── */
export async function cancel(orderId: string, userId: string, reason = "Cancelled by user") {
  const o = await one<any>("SELECT * FROM orders WHERE id=$1 AND user_id=$2", [orderId, userId]);
  if (!o) throw new HttpError(404, "Order not found");
  if (!["pending_approval", "validated", "submitted", "partially_filled", "draft"].includes(o.status)) throw new HttpError(409, `Cannot cancel a ${o.status} order`);
  if (!o.is_paper && o.status !== "pending_approval" && o.provider_order_id) {
    const ad = adapterById(o.provider_id);
    const account = await one<any>("SELECT * FROM trading_accounts WHERE id=$1", [o.account_id]);
    if (!ad?.cancel) throw new HttpError(409, `${o.provider_id} orders cannot be cancelled once submitted`);
    await ad.cancel(adapterContext(o.provider_id, account?.metadata?.environment === "sandbox" ? "sandbox" : "production", account), o, account);
  }
  await q("UPDATE orders SET status='cancelled', status_reason=$2, updated_at=now() WHERE id=$1", [orderId, reason]);
  await audit({ actorType: "user", actorId: userId, userId, action: "order.cancelled", target: orderId, data: { reason } });
  await publish(`user:${userId}`, "order", { id: orderId, status: "cancelled" });
}
export async function cancelAll(userId: string) {
  const open = await q<{ id: string }>("SELECT id FROM orders WHERE user_id=$1 AND status IN ('pending_approval','validated','submitted','partially_filled')", [userId]);
  const results = [];
  for (const o of open) { try { await cancel(o.id, userId, "Cancel all"); results.push({ id: o.id, ok: true }); } catch (e: any) { results.push({ id: o.id, ok: false, error: e.message }); } }
  return results;
}

/** Called after the user's wallet signed the unsigned transaction returned for a DEX swap. */
export async function submitSigned(orderId: string, userId: string, signed: { signedTransaction?: string; txHash?: string }) {
  const o = await one<any>("SELECT * FROM orders WHERE id=$1 AND user_id=$2", [orderId, userId]);
  if (!o || o.status !== "pending_approval" || !o.unsigned_tx) throw new HttpError(409, "Order is not awaiting a signature");
  const ad = adapterById(o.provider_id);
  if (!ad?.submitSigned) throw new HttpError(400, "Provider does not accept signed transactions");
  await q("UPDATE orders SET status='submitted', status_reason='Signed transaction submitted', updated_at=now() WHERE id=$1", [orderId]);
  const r = await ad.submitSigned(adapterContext(o.provider_id, "production"), o, signed);
  if (r.status === "filled") for (const f of r.fills) await applyFill(orderId, f);
  else await q("UPDATE orders SET provider_order_id=$2 WHERE id=$1", [orderId, r.providerOrderId]);
  await audit({ actorType: "user", actorId: userId, userId, action: "order.signed", target: orderId });
  return one<any>("SELECT * FROM orders WHERE id=$1", [orderId]);
}

/* ───────────────────────── Worker loops ───────────────────────── */

/** Paper limit/stop/trailing matching against the current simulated or real price. */
export async function processPaperTriggers() {
  const open = await q<any>(
    `SELECT o.*, a.last_price, a.price_updated_at FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.provider_id='paper' AND o.status='submitted' AND o.order_type <> 'market'`);
  let filled = 0;
  for (const o of open) {
    if (o.expires_at && new Date(o.expires_at) < new Date()) {
      await q("UPDATE orders SET status='expired', status_reason='Expired', updated_at=now() WHERE id=$1", [o.id]); continue;
    }
    const p = Number(o.last_price);
    if (!p) continue;
    let trigger = false, fillPx = p;
    const lim = Number(o.limit_price), stp = Number(o.stop_price);
    switch (o.order_type) {
      case "limit": trigger = o.side === "buy" ? p <= lim : p >= lim; fillPx = o.side === "buy" ? Math.min(p, lim) : Math.max(p, lim); break;
      case "stop": trigger = o.side === "buy" ? p >= stp : p <= stp; break;
      case "stop_limit": {
        const armed = o.quote?.stop_armed || (o.side === "buy" ? p >= stp : p <= stp);
        if (armed && !o.quote?.stop_armed) await q("UPDATE orders SET quote = COALESCE(quote,'{}'::jsonb) || '{\"stop_armed\":true}' WHERE id=$1", [o.id]);
        trigger = armed && (o.side === "buy" ? p <= lim : p >= lim); fillPx = lim; break;
      }
      case "trailing_stop": {
        const hw = Math.max(Number(o.quote?.trail_high ?? 0), p);
        if (hw !== Number(o.quote?.trail_high ?? 0)) await q("UPDATE orders SET quote = COALESCE(quote,'{}'::jsonb) || jsonb_build_object('trail_high',$2::numeric) WHERE id=$1", [o.id, hw]);
        trigger = o.side === "sell" && p <= hw * (1 - Number(o.trail_percent) / 100); break;
      }
    }
    if (!trigger) continue;
    const pos = o.side === "sell" ? await one<any>("SELECT quantity FROM positions WHERE account_id=$1 AND asset_id=$2", [o.account_id, o.asset_id]) : null;
    const qty = o.side === "sell" ? Math.min(Number(o.quantity), Number(pos?.quantity ?? 0)) : Number(o.quantity);
    if (qty <= 0) { await q("UPDATE orders SET status='cancelled', status_reason='No position remaining' WHERE id=$1", [o.id]); continue; }
    const fee = qty * fillPx * (o.quote?.feeUsd && o.quote?.notionalUsd ? o.quote.feeUsd / o.quote.notionalUsd : 0);
    if (o.side === "buy") {
      const acct = await one<any>("SELECT cash_balance FROM trading_accounts WHERE id=$1", [o.account_id]);
      // This order's own reservation is excluded; other open orders keep theirs.
      if (Number(acct.cash_balance) - (await reservedCash(o.account_id, o.id)) < qty * fillPx + fee) { await q("UPDATE orders SET status='rejected', status_reason='INSUFFICIENT_BUYING_POWER at trigger (cash reserved by other open orders)' WHERE id=$1", [o.id]); continue; }
    }
    await applyFill(o.id, { quantity: qty, price: fillPx, feeUsd: fee, fillId: `paper-trigger-${o.id}` });
    const fresh = await one<any>("SELECT * FROM orders WHERE id=$1", [o.id]);
    if (fresh?.status === "filled") await createBracketChildren(fresh);
    filled++;
  }
  return filled;
}

/** Poll live providers for submitted/unknown orders and reconcile fills. */
export async function reconcileLiveOrders() {
  const open = await q<any>("SELECT * FROM orders WHERE provider_id <> 'paper' AND status IN ('submitted','partially_filled','unknown') AND provider_order_id IS NOT NULL");
  for (const o of open) {
    const ad = adapterById(o.provider_id);
    if (!ad?.status) continue;
    const account = await one<any>("SELECT * FROM trading_accounts WHERE id=$1", [o.account_id]);
    try {
      const s = await ad.status(adapterContext(o.provider_id, account?.metadata?.environment === "sandbox" ? "sandbox" : "production", account), o, account);
      for (const f of s.fills) {
        const already = Number(o.filled_quantity);
        if (f.quantity > already) await applyFill(o.id, { ...f, quantity: f.quantity - already });
      }
      if (["cancelled", "rejected", "expired"].includes(s.status)) await q("UPDATE orders SET status=$2, status_reason=$3, updated_at=now() WHERE id=$1", [o.id, s.status, s.reason ?? `Provider reports ${s.status}`]);
    } catch (e: any) {
      await pool.query("INSERT INTO system_events (source, level, message, data) VALUES ('reconciler','warn',$1,$2)", [`Reconcile failed for ${o.id}`, JSON.stringify({ provider: o.provider_id, error: e.message })]);
    }
  }
}

export async function notify(userId: string, kind: string, title: string, body = "", link?: string) {
  const r = await one<any>("INSERT INTO notifications (user_id, kind, title, body, link) VALUES ($1,$2,$3,$4,$5) RETURNING *", [userId, kind, title, body, link ?? null]);
  await publish(`user:${userId}`, "notification", r);
}

export const fmtQty = (n: number) => (n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(4).replace(/\.?0+$/, "") : n.toPrecision(4));
export const fmtUsd = (n: number) => (n === Infinity ? "∞" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));
export const fmtPrice = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toPrecision(4));

/** The user's real-money account that would trade this asset (exchange, wallet or broker), as the engine would choose it. */
export async function liveAccountFor(userId: string, assetId: string): Promise<AccountRow> {
  const asset = await one<AssetRow>("SELECT * FROM assets WHERE id=$1", [assetId]);
  if (!asset) throw new HttpError(404, "Asset not found");
  return resolveAccount(userId, undefined, asset, "live");
}
