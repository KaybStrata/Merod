import { z } from "zod";

/**
 * Talk mode widgets: typed data the client renders with known components. Never AI-authored markup.
 * Unknown kinds are dropped here and ignored on the client. Widgets only display data or call existing
 * endpoints after a human click; none of them executes anything by itself.
 */
export const WIDGET_KINDS = ["chart", "portfolio", "agents", "alert", "clarify", "plan"] as const;
/** Widget names a user may switch off in Settings › Interface (the plan widget is always on: it carries approvals). */
export const TOGGLEABLE_WIDGETS = ["chart", "plan", "alert", "agents", "portfolio"] as const;

const text = (max: number) => z.string().max(max);
export const AlertDraft = z.object({
  assetId: z.string().uuid(), symbol: text(40), direction: z.enum(["above", "below"]), price: z.number().positive(),
  created: z.boolean().default(false), alertId: z.string().uuid().nullable().optional(), lastPrice: z.number().nullable().optional(),
}).strict();

export const Widget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chart"), assetId: z.string().uuid(), symbol: text(40), range: z.enum(["1W", "1M", "3M"]),
    lines: z.array(z.object({ label: text(60), price: z.number() }).strict()).max(4) }).strict(),
  z.object({ kind: z.literal("portfolio"), total: z.number(), dayPnl: z.number(), cash: z.number(), riskUsedPct: z.number().nullable() }).strict(),
  z.object({ kind: z.literal("agents"), items: z.array(z.object({ id: z.string(), name: text(80), state: z.enum(["running", "watching", "paused"]), note: text(80) }).strict()).max(6) }).strict(),
  z.object({ kind: z.literal("alert"), draft: AlertDraft }).strict(),
  z.object({ kind: z.literal("clarify"), question: text(300), options: z.array(z.object({ label: text(60), reply: text(300) }).strict()).max(4) }).strict(),
  z.object({ kind: z.literal("plan"), planMessageId: z.string().uuid() }).strict(),
]);
export type Widget = z.infer<typeof Widget>;

/** Keep only valid widgets (unknown kinds / bad shapes are dropped), optionally limited to the user's allowed kinds. */
export function sanitizeWidgets(raw: unknown, allowed?: readonly string[]): Widget[] {
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  for (const w of raw.slice(0, 8)) {
    const p = Widget.safeParse(w);
    if (!p.success) continue;
    if (allowed && p.data.kind !== "plan" && p.data.kind !== "clarify" && !allowed.includes(p.data.kind)) continue;
    out.push(p.data);
  }
  return out;
}

export type WidgetData = {
  chart?: { assetId: string; symbol: string; lines?: { label: string; price: number }[] } | null;
  portfolio?: { total: number; dayPnl: number; cash: number; riskUsedPct: number | null } | null;
  agents?: { id: string; name: string; status: string; note?: string | null }[];
  alert?: z.input<typeof AlertDraft> | null;
  clarify?: { question: string; options: { label: string; reply: string }[] } | null;
  planMessageId?: string | null;
};

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const agentState = (s: string): "running" | "watching" | "paused" => (s === "running" ? "running" : ["paused", "halted", "stopped", "blocked", "error", "archived"].includes(s) ? "paused" : "watching");

/**
 * Pure, deterministic builder: the interpreted intent + data the server already fetched → widgets.
 * No model output is ever used as markup; all strings are plain text and length-capped.
 */
export function widgetsFor(intent: string, d: WidgetData): Widget[] {
  const w: unknown[] = [];
  if (d.chart && (intent === "research" || intent === "price_alert" || intent === "trade"))
    w.push({ kind: "chart", assetId: d.chart.assetId, symbol: cut(d.chart.symbol, 40), range: "1M", lines: (d.chart.lines ?? []).slice(0, 4).map((l) => ({ label: cut(l.label, 60), price: l.price })) });
  if (d.portfolio && (intent === "portfolio_question" || intent === "research_portfolio"))
    w.push({ kind: "portfolio", ...d.portfolio });
  if (d.agents?.length && (intent === "agents" || intent === "portfolio_question"))
    w.push({ kind: "agents", items: d.agents.slice(0, 6).map((a) => ({ id: a.id, name: cut(a.name, 80), state: agentState(a.status), note: cut(a.note ?? a.status, 80) })) });
  if (d.alert) w.push({ kind: "alert", draft: d.alert });
  if (d.clarify) w.push({ kind: "clarify", question: cut(d.clarify.question, 300), options: d.clarify.options.slice(0, 4).map((o) => ({ label: cut(o.label, 60), reply: cut(o.reply, 300) })) });
  if (d.planMessageId) w.push({ kind: "plan", planMessageId: d.planMessageId });
  return sanitizeWidgets(w);
}
