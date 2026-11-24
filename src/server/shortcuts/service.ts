import "@/lib/server-only-shim";
import { z } from "zod";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { preview, place, cancelAll, resolveAsset } from "../engine/engine";
import type { OrderIntent } from "../engine/types";
import { pauseAllBots, setBotStatus } from "../bots/runner";
import { createBot } from "../bots/service";
import { parsePrompt } from "../ai/parser";

/**
 * Shortcut buttons. Every financial action is converted into a standard engine OrderIntent and goes
 * through preview → explicit confirmation → place. Shortcuts never bypass engine risk controls.
 */
export const ACTION_TYPES = [
  "buy_usd", "buy_qty", "sell_pct", "close_position", "cancel_open_orders", "set_stop_loss_pct", "set_take_profit_pct",
  "start_recurring_buy", "pause_all_bots", "activate_bot", "open_watchlist", "analyze_asset",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  amount: z.number().positive().nullable().optional(),        // USD, qty or percent depending on type
  orderType: z.enum(["market", "limit"]).default("market"),
  limitOffsetPct: z.number().min(-50).max(50).nullable().optional(), // limit price = market × (1 + offset%)
  frequency: z.enum(["hourly", "daily", "weekly", "monthly"]).nullable().optional(),
  botId: z.string().uuid().nullable().optional(),
});
export type ShortcutAction = z.infer<typeof ActionSchema>;

export const ConditionSchema = z.object({ type: z.enum(["price_below", "price_above", "position_open", "no_position"]), value: z.number().nullable().optional() });

export const ShortcutSchema = z.object({
  name: z.string().min(1).max(40),
  icon: z.string().max(30).default("zap"),
  color: z.string().max(20).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  assetId: z.string().uuid().nullable().optional(),
  assetCategory: z.string().max(30).nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  actions: z.array(ActionSchema).min(1).max(8),
  maxSpendUsd: z.number().positive().nullable().optional(),
  maxSlippageBps: z.number().int().min(1).max(5000).nullable().optional(),
  requireConfirmation: z.boolean().default(true),
  conditions: z.array(ConditionSchema).max(5).default([]),
  expiresAt: z.string().datetime().nullable().optional(),
  placement: z.array(z.enum(["terminal", "dashboard"])).min(1).default(["terminal"]),
});
export type ShortcutInput = z.infer<typeof ShortcutSchema>;

const FINANCIAL: ActionType[] = ["buy_usd", "buy_qty", "sell_pct", "close_position", "set_stop_loss_pct", "set_take_profit_pct"];
const CLIENT: ActionType[] = ["open_watchlist", "analyze_asset"];

export function describeAction(a: ShortcutAction, symbol = "asset"): string {
  const lim = a.orderType === "limit" && a.limitOffsetPct != null ? ` (limit ${a.limitOffsetPct > 0 ? "+" : ""}${a.limitOffsetPct}%)` : "";
  switch (a.type) {
    case "buy_usd": return `Buy $${a.amount} of ${symbol}${lim}`;
    case "buy_qty": return `Buy ${a.amount} ${symbol}${lim}`;
    case "sell_pct": return `Sell ${a.amount}% of ${symbol}${lim}`;
    case "close_position": return `Close ${symbol} position`;
    case "cancel_open_orders": return "Cancel all open orders";
    case "set_stop_loss_pct": return `Stop-loss ${a.amount}% below avg cost`;
    case "set_take_profit_pct": return `Take-profit ${a.amount}% above avg cost`;
    case "start_recurring_buy": return `Start ${a.frequency ?? "weekly"} $${a.amount} buy of ${symbol}`;
    case "pause_all_bots": return "Pause all bots";
    case "activate_bot": return "Activate saved bot";
    case "open_watchlist": return "Open watchlist";
    case "analyze_asset": return `Analyze ${symbol}`;
  }
}

export async function getShortcut(userId: string, id: string) {
  const s = await one<any>("SELECT * FROM trading_shortcuts WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!s) throw new HttpError(404, "Shortcut not found");
  return s;
}

interface ActionPlan {
  index: number; type: ActionType; kind: "order" | "control" | "client"; description: string;
  intent?: OrderIntent; plan?: any; error?: string; blocked?: boolean;
  /** Protective order that depends on an earlier buy in the same shortcut; planned after that buy fills. */
  deferred?: boolean;
}

/** Build the per-action plans for a shortcut against a (possibly dynamic) asset. No side effects. */
async function buildPlans(userId: string, s: any, dynamicAssetId: string | null | undefined) {
  if (s.expires_at && new Date(s.expires_at) < new Date()) throw new HttpError(410, "This shortcut has expired");
  const perms = await one<any>("SELECT allow_shortcuts FROM trading_permissions WHERE user_id=$1", [userId]);
  if (!perms?.allow_shortcuts) throw new HttpError(403, "Shortcut trading is disabled in your automation permissions (Settings → Automation)");
  const actions: ShortcutAction[] = (s.actions ?? []).map((a: unknown) => ActionSchema.parse(a));
  const assetId = s.asset_id ?? dynamicAssetId ?? null;
  const needsAsset = actions.some((a) => FINANCIAL.includes(a.type) || a.type === "start_recurring_buy" || a.type === "analyze_asset");
  if (needsAsset && !assetId) throw new HttpError(400, "Open an asset to use this shortcut — it applies to the asset on screen");
  const asset = assetId ? await resolveAsset({ assetId }) : null;
  if (asset && s.asset_category && !asset.categories.includes(s.asset_category) && asset.asset_class !== s.asset_category)
    throw new HttpError(400, `This shortcut only applies to ${s.asset_category} assets`);
  const price = asset?.last_price ? Number(asset.last_price) : null;

  // Execution conditions
  const condErrors: string[] = [];
  const pos = asset ? await one<any>(
    `SELECT p.quantity, p.avg_cost, p.account_id FROM positions p JOIN trading_accounts t ON t.id=p.account_id
      WHERE p.user_id=$1 AND p.asset_id=$2 AND p.quantity>0 AND ($3::uuid IS NULL OR p.account_id=$3) ORDER BY p.quantity DESC LIMIT 1`,
    [userId, asset.id, s.account_id ?? null]) : null;
  for (const c of (s.conditions ?? []) as z.infer<typeof ConditionSchema>[]) {
    if (c.type === "price_below" && !(price != null && c.value != null && price < c.value)) condErrors.push(`Condition not met: price below ${c.value}`);
    if (c.type === "price_above" && !(price != null && c.value != null && price > c.value)) condErrors.push(`Condition not met: price above ${c.value}`);
    if (c.type === "position_open" && !pos) condErrors.push("Condition not met: you have no open position");
    if (c.type === "no_position" && pos) condErrors.push("Condition not met: you already hold a position");
  }

  const plans: ActionPlan[] = [];
  let buySpend = 0;
  for (const [index, a] of actions.entries()) {
    const description = describeAction(a, asset?.symbol);
    if (CLIENT.includes(a.type)) { plans.push({ index, type: a.type, kind: "client", description }); continue; }
    if (!FINANCIAL.includes(a.type)) { plans.push({ index, type: a.type, kind: "control", description, ...(condErrors.length ? { blocked: true, error: condErrors.join("; ") } : {}) }); continue; }
    if (condErrors.length) { plans.push({ index, type: a.type, kind: "order", description, blocked: true, error: condErrors.join("; ") }); continue; }
    const limitPrice = a.orderType === "limit" && price ? +(price * (1 + (a.limitOffsetPct ?? 0) / 100)).toPrecision(8) : undefined;
    const common = {
      asset: { assetId: asset!.id }, timeInForce: "gtc" as const, ...(s.account_id ? { accountId: s.account_id } : {}),
      ...(s.max_slippage_bps ? { maxSlippageBps: s.max_slippage_bps } : {}), ...(s.max_spend_usd ? { spendingLimitUsd: Number(s.max_spend_usd) } : {}),
    };
    let intent: OrderIntent | null = null;
    if (a.type === "buy_usd" || a.type === "buy_qty") {
      const notional = a.type === "buy_usd" ? a.amount! : (a.amount ?? 0) * (limitPrice ?? price ?? 0);
      buySpend += notional;
      intent = { ...common, side: "buy", orderType: limitPrice ? "limit" : "market", ...(limitPrice ? { limitPrice } : {}),
        ...(a.type === "buy_usd" ? { notionalUsd: a.amount! } : { quantity: a.amount! }) } as OrderIntent;
    } else if (a.type === "sell_pct" || a.type === "close_position") {
      intent = { ...common, side: "sell", orderType: limitPrice && a.type === "sell_pct" ? "limit" : "market", ...(limitPrice && a.type === "sell_pct" ? { limitPrice } : {}),
        percentOfPosition: a.type === "close_position" ? 100 : Math.min(a.amount ?? 0, 100) } as OrderIntent;
    } else if (a.type === "set_stop_loss_pct" || a.type === "set_take_profit_pct") {
      if (!pos) {
        const earlierBuy = actions.slice(0, index).some((x) => x.type === "buy_usd" || x.type === "buy_qty");
        plans.push(earlierBuy ? { index, type: a.type, kind: "order", description: `${description} (placed after the buy fills)`, deferred: true }
          : { index, type: a.type, kind: "order", description, blocked: true, error: "No position to protect" });
        continue;
      }
      const avg = Number(pos.avg_cost);
      const target = +(avg * (1 + ((a.type === "set_stop_loss_pct" ? -1 : 1) * (a.amount ?? 0)) / 100)).toPrecision(8);
      intent = { ...common, accountId: pos.account_id, side: "sell", quantity: Number(pos.quantity),
        ...(a.type === "set_stop_loss_pct" ? { orderType: "stop", stopPrice: target } : { orderType: "limit", limitPrice: target }) } as OrderIntent;
    }
    plans.push({ index, type: a.type, kind: "order", description, intent: intent! });
  }
  if (s.max_spend_usd && buySpend > Number(s.max_spend_usd) + 1e-9) {
    for (const p of plans) if (p.kind === "order" && p.intent?.side === "buy") { p.blocked = true; p.error = `Total buys $${buySpend.toFixed(2)} exceed this shortcut's max spend $${s.max_spend_usd}`; }
  }
  return { plans, asset, actions };
}

/** Preview: run every financial action through engine.preview and record a 'previewed' execution. */
export async function previewShortcut(userId: string, shortcutId: string, dynamicAssetId?: string | null) {
  const s = await getShortcut(userId, shortcutId);
  const { plans, asset } = await buildPlans(userId, s, dynamicAssetId);
  const exec = await one<{ id: string }>(
    "INSERT INTO shortcut_executions (shortcut_id, user_id, asset_id, status, detail) VALUES ($1,$2,$3,'previewed',$4) RETURNING id",
    [s.id, userId, asset?.id ?? null, JSON.stringify({ dynamicAssetId: dynamicAssetId ?? null })]);
  for (const p of plans) {
    if (p.kind !== "order" || p.blocked || p.deferred || !p.intent) continue;
    try {
      p.plan = await preview(p.intent, { userId, source: "shortcut", sourceRef: s.id, idempotencyKey: `shortcut:${exec!.id}:${p.index}`, actor: { type: "shortcut", id: s.id } });
    } catch (e: any) { p.blocked = true; p.error = e.message; }
  }
  return { executionId: exec!.id, shortcut: { id: s.id, name: s.name, requireConfirmation: s.require_confirmation }, asset: asset && { id: asset.id, symbol: asset.symbol, name: asset.name, venue: asset.venue }, plans };
}

/**
 * Execute a previewed shortcut. `confirmed` must be true when the shortcut requires confirmation.
 * With confirmation, orders are user-approved; without, the user's permission mode decides (auto or pending approval).
 */
export async function executeShortcut(userId: string, shortcutId: string, executionId: string, confirmed: boolean) {
  const s = await getShortcut(userId, shortcutId);
  const ex = await one<any>("SELECT * FROM shortcut_executions WHERE id=$1 AND shortcut_id=$2 AND user_id=$3", [executionId, s.id, userId]);
  if (!ex) throw new HttpError(404, "Preview not found — preview the shortcut first");
  if (ex.status !== "previewed") throw new HttpError(409, `This execution is already ${ex.status}`);
  if (Date.now() - new Date(ex.created_at).getTime() > 5 * 60_000) throw new HttpError(410, "Preview expired — preview again to get fresh prices");
  if (s.require_confirmation && !confirmed) throw new HttpError(400, "This shortcut requires explicit confirmation");
  await q("UPDATE shortcut_executions SET status='executing' WHERE id=$1 AND status='previewed'", [executionId]);

  const { plans } = await buildPlans(userId, s, ex.detail?.dynamicAssetId ?? ex.asset_id);
  const results: { index: number; description: string; ok: boolean; message: string; orderId?: string; status?: string; client?: string }[] = [];
  const orderIds: string[] = [];
  for (let p of plans) {
    if (p.deferred) {
      // Re-plan now that earlier buys in this shortcut have filled.
      const fresh = (await buildPlans(userId, s, ex.detail?.dynamicAssetId ?? ex.asset_id)).plans[p.index];
      p = fresh.deferred ? { ...fresh, blocked: true, error: "Earlier buy has not filled yet — protective order not placed" } : fresh;
    }
    if (p.blocked) { results.push({ index: p.index, description: p.description, ok: false, message: p.error ?? "Blocked" }); continue; }
    try {
      if (p.kind === "order") {
        const { order } = await place(p.intent!, {
          userId, source: "shortcut", sourceRef: s.id, idempotencyKey: `shortcut:${executionId}:${p.index}`,
          actor: { type: confirmed ? "user" : "shortcut", id: confirmed ? userId : s.id }, userConfirmed: confirmed && s.require_confirmation,
        });
        orderIds.push(order.id);
        results.push({ index: p.index, description: p.description, ok: !["rejected", "failed"].includes(order.status), message: order.status_reason ?? order.status, orderId: order.id, status: order.status });
      } else if (p.kind === "client") {
        results.push({ index: p.index, description: p.description, ok: true, message: "Handled in browser", client: p.type });
      } else {
        const action = (s.actions as ShortcutAction[])[p.index];
        if (p.type === "cancel_open_orders") { const r = await cancelAll(userId); results.push({ index: p.index, description: p.description, ok: true, message: `Cancelled ${r.filter((x) => x.ok).length} orders` }); }
        else if (p.type === "pause_all_bots") { const n = await pauseAllBots(userId); results.push({ index: p.index, description: p.description, ok: true, message: `Paused ${n} bots` }); }
        else if (p.type === "activate_bot") {
          if (!action.botId) throw new Error("No bot selected for this shortcut");
          await setBotStatus(userId, action.botId, "start");
          results.push({ index: p.index, description: p.description, ok: true, message: "Bot started" });
        } else if (p.type === "start_recurring_buy") {
          const assetId = s.asset_id ?? ex.detail?.dynamicAssetId ?? ex.asset_id;
          const bot = await createBot(userId, {
            name: `Recurring $${action.amount} (${action.frequency ?? "weekly"})`, description: `Created by shortcut “${s.name}”`, strategyId: "recurring_buy",
            params: { amount_usd: action.amount, frequency: action.frequency ?? "weekly", weekday: "monday" }, assetIds: [assetId], markets: [],
            isPaper: true, budgetUsd: (action.amount ?? 50) * 12, maxPositionUsd: action.amount ?? 50, maxDailySpendUsd: (action.amount ?? 50) * 2,
            maxDailyLossUsd: 100, maxTradesPerDay: 5, minLiquidityUsd: 0, maxSlippageBps: s.max_slippage_bps ?? 100, maxPriceDeviationPct: 5,
            schedule: "every_5m", approvalRequired: false, notify: { trades: true, errors: true }, start: true,
          });
          results.push({ index: p.index, description: p.description, ok: true, message: `Recurring buy bot ${bot.status}` });
        }
      }
    } catch (e: any) {
      results.push({ index: p.index, description: p.description, ok: false, message: e.message });
    }
  }
  const status = results.every((r) => r.ok) ? "executed" : results.some((r) => r.ok) ? "partial" : "failed";
  await q("UPDATE shortcut_executions SET status=$2, order_ids=$3, detail = detail || $4::jsonb WHERE id=$1", [executionId, status, orderIds, JSON.stringify({ results, confirmed })]);
  await audit({ actorType: "shortcut", actorId: s.id, userId, action: "shortcut.execute", target: executionId, data: { status, orders: orderIds.length, confirmed } });
  return { status, results };
}

/** Turn a natural-language description into shortcut actions using the deterministic parser. */
export async function actionsFromPrompt(text: string) {
  const ins = parsePrompt(text);
  const actions: ShortcutAction[] = [];
  const leg = ins.trades[0];
  let assetId: string | null = null, symbol: string | null = null;
  if (leg?.symbol || leg?.contract_address) {
    try { const a = await resolveAsset({ symbol: leg.symbol ?? undefined, identifier: leg.contract_address ?? undefined }); assetId = a.id; symbol = a.symbol; } catch { /* stays dynamic */ }
  }
  const ot = leg?.order_type === "limit" ? "limit" : "market";
  switch (ins.kind) {
    case "trade":
      if (leg.side === "buy") actions.push({ type: leg.amount_type === "quantity" ? "buy_qty" : "buy_usd", amount: leg.amount, orderType: ot });
      else if (leg.amount_type === "percent_position" && leg.amount === 100) actions.push({ type: "close_position", orderType: "market" });
      else actions.push({ type: "sell_pct", amount: leg.amount_type === "percent_position" ? leg.amount : 100, orderType: ot });
      if (leg.stop_loss_pct) actions.push({ type: "set_stop_loss_pct", amount: leg.stop_loss_pct, orderType: "market" });
      if (leg.take_profit_pct) actions.push({ type: "set_take_profit_pct", amount: leg.take_profit_pct, orderType: "market" });
      break;
    case "recurring_buy": actions.push({ type: "start_recurring_buy", amount: leg?.amount ?? 50, frequency: ins.schedule?.frequency ?? "weekly", orderType: "market" }); break;
    case "cancel_all_orders": actions.push({ type: "cancel_open_orders", orderType: "market" }); break;
    case "pause_all_bots": actions.push({ type: "pause_all_bots", orderType: "market" }); break;
    case "research": actions.push({ type: "analyze_asset", orderType: "market" }); break;
  }
  if (!actions.length) throw new HttpError(422, ins.clarification_question ?? "Couldn't turn that into shortcut actions. Try e.g. “Buy $50” or “Sell 25%”.");
  const name = actions.length === 1 ? describeAction(actions[0], symbol ?? "").replace(/ of $| $/, "").slice(0, 40) : ins.summary.slice(0, 40);
  return { name, actions, assetId, symbol, summary: ins.summary };
}

export async function insertShortcut(userId: string, b: ShortcutInput) {
  if (b.folderId && !(await one("SELECT 1 FROM shortcut_folders WHERE id=$1 AND user_id=$2", [b.folderId, userId]))) throw new HttpError(400, "Folder not found");
  if (b.accountId && !(await one("SELECT 1 FROM trading_accounts WHERE id=$1 AND user_id=$2", [b.accountId, userId]))) throw new HttpError(400, "Account not found");
  for (const a of b.actions) if (a.type === "activate_bot" && (!a.botId || !(await one("SELECT 1 FROM trading_bots WHERE id=$1 AND user_id=$2", [a.botId, userId])))) throw new HttpError(400, "Select one of your bots for “Activate bot”");
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM trading_shortcuts WHERE user_id=$1", [userId]);
  if ((count?.n ?? 0) >= 100) throw new HttpError(400, "Shortcut limit reached (100)");
  return one<any>(
    `INSERT INTO trading_shortcuts (user_id, folder_id, name, icon, color, asset_id, asset_category, account_id, actions, max_spend_usd, max_slippage_bps,
       require_confirmation, conditions, expires_at, placement, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [userId, b.folderId ?? null, b.name, b.icon, b.color ?? null, b.assetId ?? null, b.assetCategory ?? null, b.accountId ?? null, JSON.stringify(b.actions),
     b.maxSpendUsd ?? null, b.maxSlippageBps ?? null, b.requireConfirmation, JSON.stringify(b.conditions), b.expiresAt ?? null, b.placement, count?.n ?? 0]);
}

