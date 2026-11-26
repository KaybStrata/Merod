import { one } from "../db";
import { widgetsFor, sanitizeWidgets, type WidgetData } from "./widgets";
import { agentItems, paperSummary } from "./summary";
import { DEFAULT_TALK_PREFS } from "./prefs";

export type WidgetHint = {
  /** Symbol (or asset id) whose price chart should be shown. */
  chartSymbol?: string | null; chartAssetId?: string | null; chartLines?: { label: string; price: number }[];
  portfolio?: boolean; agents?: boolean;
  alert?: WidgetData["alert"];
  clarify?: WidgetData["clarify"];
};

/**
 * Talk mode: after an assistant message is saved, attach typed widgets under plan.widgets (existing JSONB, no schema change).
 * Deterministic and data-only. The plan's own fields (type, intent, config…) are never changed, so approvals work exactly as before.
 * Returns the updated row, or null when there is nothing to attach.
 */
export async function attachWidgets(userId: string, row: any, intent: string, hint: WidgetHint = {}) {
  const d: WidgetData = {};
  if (hint.chartAssetId || hint.chartSymbol) {
    const a = hint.chartAssetId
      ? await one<any>("SELECT id, symbol FROM assets WHERE id=$1", [hint.chartAssetId])
      : await one<any>("SELECT id, symbol FROM assets WHERE upper(symbol)=upper($1) AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 1", [hint.chartSymbol]);
    if (a) d.chart = { assetId: a.id, symbol: a.symbol, lines: hint.chartLines ?? [] };
  }
  if (hint.portfolio) d.portfolio = await paperSummary(userId);
  if (hint.agents) d.agents = (await agentItems(userId)).map((a: any) => ({ id: a.id, name: a.name, status: a.status, note: a.note }));
  if (hint.alert) d.alert = hint.alert;
  if (hint.clarify) d.clarify = hint.clarify;
  if (row.status === "needs_approval" && row.plan) d.planMessageId = row.id;
  const prefs = await one<any>("SELECT talk_prefs FROM user_profiles WHERE user_id=$1", [userId]);
  const allowed: string[] = Array.isArray(prefs?.talk_prefs?.widgets) ? prefs.talk_prefs.widgets : DEFAULT_TALK_PREFS.widgets;
  const widgets = sanitizeWidgets(widgetsFor(intent, d), allowed);
  if (!widgets.length) return null;
  const plan = { ...(row.plan ?? { type: "info" }), widgets };
  return one<any>("UPDATE trading_prompts SET plan=$2 WHERE id=$1 RETURNING *", [row.id, JSON.stringify(plan)]);
}
