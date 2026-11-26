import "@/lib/server-only-shim";
import { createHash } from "node:crypto";
import { z } from "zod";
import { one, q } from "../db";
import { HttpError } from "../errors";
import { getFlags } from "../flags";
import { parsePrompt } from "../ai/parser";
import { ensureParserCatalog } from "../ai/interpret";
import { reservedCash } from "../engine/engine";

/**
 * CANONICAL STRATEGY CONTRACT (spec §05).
 * Prompts and the visual editor both produce this one typed shape. It is strict: unknown fields are rejected, numbers
 * are bounded, there is no place for executable code, and compiling never places an order. Every saved version is
 * immutable and identified by a SHA-256 content hash; editing creates a new version.
 */
export const SCHEMA_VERSION = 1;

const Universe = z.object({
  assetIds: z.array(z.string().uuid()).max(50).default([]),
  scanner: z.object({ assetClass: z.enum(["crypto", "stock", "etf"]).nullable().default(null), venue: z.string().max(20).nullable().default(null), meme: z.boolean().default(false), limit: z.number().int().min(1).max(1000).default(20) }).strict().nullable().default(null),
}).strict();

const Entry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dip_pct"), value: z.number().positive().max(90) }).strict(),
  z.object({ type: z.literal("price_above"), value: z.number().positive() }).strict(),
  z.object({ type: z.literal("price_below"), value: z.number().positive() }).strict(),
  z.object({ type: z.literal("sma_cross_up"), fast: z.number().int().min(2).max(200), slow: z.number().int().min(3).max(400), timeframe: z.enum(["5m", "1h", "1d"]).default("1h") }).strict(),
  z.object({ type: z.literal("schedule"), frequency: z.enum(["hourly", "daily", "weekly", "monthly"]), weekday: z.number().int().min(0).max(6).nullable().default(null) }).strict(),
]);

export const StrategyRules = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string().min(1).max(80),
  template: z.enum(["dip_loop", "momentum", "sma_cross", "dca", "price_trigger", "scanner"]),
  universe: Universe,
  environment: z.enum(["paper", "live"]).default("paper"),
  cadence: z.enum(["15s", "1m", "5m", "1h", "1d"]).default("1m"),
  timezone: z.string().max(40).default("UTC"),
  entryRules: z.array(Entry).max(5),
  exitRules: z.object({
    takeProfitPct: z.number().positive().max(1000).nullable().default(null),
    stopLossPct: z.number().positive().max(100).nullable().default(null),
    trailingPct: z.number().positive().max(50).nullable().default(null),
    maxHoldHours: z.number().positive().max(24 * 365).nullable().default(null),
  }).strict(),
  sizingRules: z.object({ usdPerTrade: z.number().positive().max(10_000_000).nullable(), maxPositionUsd: z.number().positive().max(10_000_000).nullable().default(null) }).strict(),
  orderPolicy: z.object({ type: z.enum(["market", "limit"]).default("market"), timeInForce: z.enum(["gtc", "day", "ioc"]).default("gtc"), maxSlippageBps: z.number().int().min(1).max(2000).default(100) }).strict(),
  riskPolicy: z.object({ budgetUsd: z.number().positive().max(100_000_000).nullable().default(null), dailyLossUsd: z.number().positive().max(10_000_000).nullable().default(null), maxOpenPositions: z.number().int().min(1).max(100).default(5) }).strict(),
  approvalPolicy: z.enum(["manual", "approval", "semi_auto", "auto", "observation"]).default("approval"),
  repeat: z.boolean().default(true),
}).strict();
export type StrategyRulesT = z.infer<typeof StrategyRules>;

/** Stable JSON (sorted keys) so the same rules always hash the same. */
function stable(v: any): any { return Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v; }
export const contentHash = (rules: StrategyRulesT) => createHash("sha256").update(JSON.stringify(stable(rules))).digest("hex");

const CODE_LIKE = /(=>|\bfunction\s*\(|\beval\s*\(|<script|\bimport\s+[\w{*]|\brequire\s*\(|\bprocess\.|\bwhile\s*\(\s*true|\bfor\s*\(\s*;;)/i;

export function summarize(r: StrategyRulesT): string {
  const where = r.universe.scanner ? `the top ${r.universe.scanner.limit} ${r.universe.scanner.venue ? r.universe.scanner.venue + " " : ""}${r.universe.scanner.meme ? "meme coins" : r.universe.scanner.assetClass ?? "assets"}` : `${r.universe.assetIds.length} asset${r.universe.assetIds.length === 1 ? "" : "s"}`;
  const entry = r.entryRules.map((e) => e.type === "dip_pct" ? `buy after a ${e.value}% dip` : e.type === "price_above" ? `buy above ${e.value}` : e.type === "price_below" ? `buy below ${e.value}` : e.type === "sma_cross_up" ? `buy when SMA${e.fast} crosses above SMA${e.slow} (${e.timeframe})` : `buy ${e.frequency}`).join(" and ");
  const exit = [r.exitRules.takeProfitPct ? `take profit at +${r.exitRules.takeProfitPct}%` : null, r.exitRules.stopLossPct ? `stop at −${r.exitRules.stopLossPct}%` : null, r.exitRules.trailingPct ? `trail ${r.exitRules.trailingPct}%` : null, r.exitRules.maxHoldHours ? `exit after ${r.exitRules.maxHoldHours}h` : null].filter(Boolean).join(", ");
  const size = r.sizingRules.usdPerTrade ? `$${r.sizingRules.usdPerTrade} per trade` : "size not set";
  return `${r.template === "scanner" ? "Watch" : "Trade"} ${where}: ${entry || "no entry rule"}${exit ? `; ${exit}` : ""}; ${size}; ${r.environment} · ${r.approvalPolicy}${r.repeat ? " · repeats" : ""}.`;
}

export type CompileResult = { ok: boolean; draft: StrategyRulesT | null; summary: string | null; warnings: string[]; missing: string[]; errors: string[]; schemaVersion: number };

/** Prompt or JSON → validated draft (never an order). */
export async function compile(input: { text?: string; rules?: unknown }): Promise<CompileResult> {
  const warnings: string[] = [], missing: string[] = [], errors: string[] = [];
  const out = (draft: StrategyRulesT | null): CompileResult => ({ ok: !!draft && !errors.length, draft, summary: draft ? summarize(draft) : null, warnings, missing, errors, schemaVersion: SCHEMA_VERSION });
  if (input.rules !== undefined) {
    const raw = JSON.stringify(input.rules);
    if (CODE_LIKE.test(raw)) { errors.push("Strategies can't contain code. Use the rule fields only."); return out(null); }
    const p = StrategyRules.safeParse(input.rules);
    if (!p.success) { for (const i of p.error.issues) errors.push(`${i.path.join(".") || "rules"}: ${i.message}`); return out(null); }
    return finish(p.data, warnings, missing, errors);
  }
  const text = (input.text ?? "").trim();
  if (!text) { errors.push("Describe the strategy, e.g. “buy $50 of SOL after a 5% dip and sell at +8%, repeat”."); return out(null); }
  if (CODE_LIKE.test(text)) { errors.push("Strategies can't contain code. Describe what you want in words."); return out(null); }
  await ensureParserCatalog();
  const ins = parsePrompt(text);
  const leg = ins.trades?.[0];
  let assetIds: string[] = [];
  if (leg?.symbol) {
    const a = await one<{ id: string }>("SELECT id FROM assets WHERE upper(symbol)=upper($1) AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 1", [leg.symbol]);
    if (a) assetIds = [a.id]; else warnings.push(`Couldn't find “${leg.symbol}”; pick the asset in the editor.`);
  }
  const usd = leg?.amount_type === "usd" ? leg.amount : null;
  const scope = ins.swing?.scope ?? null;
  const base = {
    schemaVersion: SCHEMA_VERSION as 1, name: ins.summary.slice(0, 80) || "New strategy",
    universe: { assetIds, scanner: scope ? { assetClass: "crypto" as const, venue: scope.venue, meme: scope.meme, limit: Math.min(1000, scope.top ?? 20) } : null },
    environment: "paper" as const, cadence: "1m" as const, timezone: "UTC",
    exitRules: { takeProfitPct: null, stopLossPct: null, trailingPct: null, maxHoldHours: null },
    sizingRules: { usdPerTrade: usd, maxPositionUsd: usd },
    orderPolicy: { type: "market" as const, timeInForce: "gtc" as const, maxSlippageBps: 100 },
    riskPolicy: { budgetUsd: usd ? usd * 5 : null, dailyLossUsd: usd ? usd * 2 : null, maxOpenPositions: scope ? 10 : 5 },
    approvalPolicy: "approval" as const, repeat: true,
  };
  let draft: any;
  if (ins.kind === "swing_loop" && ins.swing) {
    draft = { ...base, template: "dip_loop", cadence: "15s", entryRules: [{ type: "dip_pct", value: ins.swing.dip_pct }], repeat: ins.swing.repeat,
      exitRules: { ...base.exitRules, takeProfitPct: ins.swing.take_profit_pct, stopLossPct: ins.swing.stop_loss_pct } };
  } else if (ins.kind === "recurring_buy" && ins.schedule) {
    draft = { ...base, template: "dca", cadence: "5m", entryRules: [{ type: "schedule", frequency: ins.schedule.frequency, weekday: ins.schedule.weekday ?? null }] };
  } else if (ins.kind === "conditional_trade" && ins.condition && (ins.condition.type === "price_above" || ins.condition.type === "price_below")) {
    draft = { ...base, template: "price_trigger", repeat: false, entryRules: [{ type: ins.condition.type, value: ins.condition.value }] };
  } else if (ins.kind === "create_bot" || /\b(monitor|watch|scan|scanner)\b/i.test(text) && !/\b(buy|sell)/i.test(text)) {
    draft = { ...base, template: "scanner", approvalPolicy: "observation", entryRules: [], sizingRules: { usdPerTrade: null, maxPositionUsd: null },
      universe: { assetIds, scanner: base.universe.scanner ?? { assetClass: /stock/i.test(text) ? "stock" : "crypto", venue: scope?.venue ?? null, meme: /meme/i.test(text), limit: 20 } } };
    warnings.push("This is a watch-only scanner: it won't place orders unless you change the approval policy and authorise it.");
  } else if (/\b(sma|moving average|golden cross|crossover)\b/i.test(text)) {
    const m = text.match(/(\d+)\s*(?:\/|and|vs)\s*(\d+)/);
    draft = { ...base, template: "sma_cross", entryRules: [{ type: "sma_cross_up", fast: m ? Number(m[1]) : 9, slow: m ? Number(m[2]) : 21, timeframe: "1h" }] };
  } else {
    errors.push(ins.clarification_question ?? "I couldn't turn that into a strategy. Try a dip-and-take-profit loop, a recurring buy, a price trigger, an SMA crossover or a watch-only scanner.");
    return out(null);
  }
  const p = StrategyRules.safeParse(draft);
  if (!p.success) { for (const i of p.error.issues) errors.push(`${i.path.join(".")}: ${i.message}`); return out(null); }
  return finish(p.data, warnings, missing, errors);
}

function finish(r: StrategyRulesT, warnings: string[], missing: string[], errors: string[]): CompileResult {
  if (!r.universe.assetIds.length && !r.universe.scanner) missing.push("Which stocks or coins to trade (universe)");
  if (r.template !== "scanner" && !r.sizingRules.usdPerTrade) missing.push("How much to spend per trade");
  if (r.template !== "scanner" && !r.entryRules.length) missing.push("An entry rule");
  if (["dip_loop", "momentum", "sma_cross"].includes(r.template) && !r.exitRules.takeProfitPct && !r.exitRules.stopLossPct) warnings.push("No take-profit or stop-loss: positions are only closed by the strategy's own exit signal.");
  if (r.environment === "live") warnings.push("Live environment: activation also needs real-money trading switched on, a connected real account and your explicit authorisation.");
  return { ok: !errors.length, draft: r, summary: summarize(r), warnings, missing, errors, schemaVersion: SCHEMA_VERSION };
}

/** Pre-activation validation against current data (assets, prices, permissions, buying power). */
export async function validateRules(userId: string, r: StrategyRulesT) {
  const errors: string[] = [], warnings: string[] = [];
  const c = await compile({ rules: r });
  errors.push(...c.errors, ...c.missing.map((m) => `Missing: ${m}`));
  if (r.universe.assetIds.length) {
    const rows = await q<any>("SELECT id, symbol, tradability, price_source, price_updated_at, risk_flags FROM assets WHERE id = ANY($1::uuid[])", [r.universe.assetIds]);
    if (rows.length !== r.universe.assetIds.length) errors.push("Some assets no longer exist");
    for (const a of rows) {
      if ((a.risk_flags ?? []).includes("demo_data")) errors.push(`${a.symbol} is a demo token and can't be traded`);
      else if (!["paper_tradable", "live_tradable"].includes(a.tradability)) errors.push(`${a.symbol} isn't tradable`);
      if (!a.price_source || a.price_source === "simulated" || Date.now() - new Date(a.price_updated_at ?? 0).getTime() > 15 * 60_000) warnings.push(`${a.symbol} has no fresh real price right now; the session will wait (fail closed) until it does`);
    }
  }
  if (r.environment === "live") {
    const f = await getFlags();
    if (!f.live_crypto_trading && !f.live_brokerage_trading) errors.push("Real-money trading is off (Admin → Real-money trading)");
  }
  const acct = await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId]);
  if (acct && r.riskPolicy.budgetUsd && r.environment === "paper") {
    const avail = Number(acct.cash_balance) - (await reservedCash(acct.id));
    if (r.riskPolicy.budgetUsd > avail) warnings.push(`Budget $${r.riskPolicy.budgetUsd} is more than your available paper cash ($${avail.toFixed(2)})`);
  }
  return { ok: errors.length === 0, errors, warnings, at: new Date().toISOString() };
}

/* ───────────────────────── Persistence ───────────────────────── */
export async function createStrategy(userId: string, rules: unknown, sourcePrompt?: string) {
  const p = StrategyRules.safeParse(rules);
  if (!p.success) throw new HttpError(400, p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const s = await one<{ id: string }>("INSERT INTO strategies (user_id, name) VALUES ($1,$2) RETURNING id", [userId, p.data.name]);
  const v = await insertVersion(s!.id, p.data, null, sourcePrompt);
  return { strategyId: s!.id, version: v };
}

async function insertVersion(strategyId: string, r: StrategyRulesT, parentId: string | null, sourcePrompt?: string) {
  const next = (await one<{ n: number }>("SELECT COALESCE(max(version),0)+1 AS n FROM strategy_versions WHERE strategy_id=$1", [strategyId]))!.n;
  return one<any>(
    `INSERT INTO strategy_versions (strategy_id, version, parent_version_id, schema_version, rules, content_hash, summary, source_prompt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [strategyId, next, parentId, SCHEMA_VERSION, JSON.stringify(r), contentHash(r), summarize(r), sourcePrompt ?? null]);
}

/** Editing = a new immutable version (the running version is never changed). */
export async function newVersion(userId: string, strategyId: string, rules: unknown) {
  const s = await one<any>("SELECT id FROM strategies WHERE id=$1 AND user_id=$2", [strategyId, userId]);
  if (!s) throw new HttpError(404, "Strategy not found");
  const p = StrategyRules.safeParse(rules);
  if (!p.success) throw new HttpError(400, p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const latest = await one<any>("SELECT id, content_hash FROM strategy_versions WHERE strategy_id=$1 ORDER BY version DESC LIMIT 1", [strategyId]);
  if (latest?.content_hash === contentHash(p.data)) throw new HttpError(409, "Nothing changed from the latest version");
  await q("UPDATE strategies SET name=$2 WHERE id=$1", [strategyId, p.data.name]);
  return insertVersion(strategyId, p.data, latest?.id ?? null);
}

export async function validateVersion(userId: string, versionId: string) {
  const v = await one<any>("SELECT v.* FROM strategy_versions v JOIN strategies s ON s.id=v.strategy_id WHERE v.id=$1 AND s.user_id=$2", [versionId, userId]);
  if (!v) throw new HttpError(404, "Version not found");
  const res = await validateRules(userId, v.rules);
  await q("UPDATE strategy_versions SET validation=$2 WHERE id=$1", [versionId, JSON.stringify(res)]);
  return res;
}

export async function listStrategies(userId: string) {
  return q<any>(
    `SELECT s.id, s.name, s.archived, s.created_at,
            (SELECT json_agg(json_build_object('id', v.id, 'version', v.version, 'summary', v.summary, 'hash', left(v.content_hash, 12), 'validation', v.validation, 'created_at', v.created_at) ORDER BY v.version DESC)
               FROM strategy_versions v WHERE v.strategy_id=s.id) AS versions
       FROM strategies s WHERE s.user_id=$1 AND NOT s.archived ORDER BY s.created_at DESC`, [userId]);
}
