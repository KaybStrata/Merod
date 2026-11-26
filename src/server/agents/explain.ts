import "@/lib/server-only-shim";
import { q, one } from "../db";
import { HttpError } from "../errors";
import { remember, emit } from "./service";

/**
 * Agents that explain themselves (spec "Explain & Review", feature 3).
 * Every explanation is built ONLY from what the agent recorded at decision time (agent_events.data.inputs / signal),
 * the order it placed and the order engine's checks — never invented. Works with no AI key.
 */
export const REASONS = ["good_call", "too_risky", "bad_timing", "wrong_asset", "too_big"] as const;
export type Reason = (typeof REASONS)[number];
export const REASON_LABEL: Record<Reason, string> = { good_call: "Good call", too_risky: "Too risky", bad_timing: "Bad timing", wrong_asset: "Wrong asset", too_big: "Too big" };

type Row = { input: string; value: string; rule: string; ok: boolean };
const px = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "n/a" : n >= 100 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 })}` : `$${n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
const f = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(d));
const usd = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

/** The "what triggered it" table: recorded inputs against the strategy rule they were checked against. */
export function inputRows(kind: string, s: any, ind: any, side: "buy" | "sell" | string, ctx: { ref?: number | null } = {}): Row[] {
  const rows: Row[] = [];
  const add = (input: string, value: string, rule: string, ok: boolean) => rows.push({ input, value, rule, ok });
  if (kind === "momentum" || kind === "news") {
    const min = Number(s.minChangePct ?? 1.5), rsiMax = Number(s.rsiMax ?? 75);
    if (side === "buy") {
      add("24h change", `${f(ind.change24hPct, 2)}%`, `≥ ${min}%`, (ind.change24hPct ?? -Infinity) >= min);
      add("MACD", ind.macd == null ? "n/a" : ind.macd >= 0 ? "positive" : "negative", "positive", (ind.macd ?? 0) > 0);
      add("RSI(14)", f(ind.rsi14, 0), `< ${rsiMax} (not overbought)`, (ind.rsi14 ?? 50) < rsiMax);
    } else {
      add("MACD", ind.macd == null ? "n/a" : ind.macd >= 0 ? "positive" : "negative", "negative (momentum fading)", (ind.macd ?? 0) < 0);
      add("RSI(14)", f(ind.rsi14, 0), "< 45", (ind.rsi14 ?? 50) < 45);
    }
  } else if (kind === "mean_reversion") {
    const lo = Number(s.rsiBuy ?? 30), hi = Number(s.rsiSell ?? 70);
    add("RSI(14)", f(ind.rsi14, 0), side === "buy" ? `≤ ${lo} (oversold)` : `≥ ${hi} (overbought)`, side === "buy" ? (ind.rsi14 ?? 99) <= lo : (ind.rsi14 ?? 0) >= hi);
  } else if (kind === "breakout") {
    const vr = Number(s.minVolumeRise ?? 1.3);
    if (side === "buy") {
      add("Breakout vs 20-bar high", `${px(ind.price)} vs ${px(ind.high20)}`, "price > 20-bar high", ind.high20 != null && ind.price > ind.high20);
      add("Relative volume", `${f(ind.volumeRise, 2)}×`, `≥ ${vr}×`, (ind.volumeRise ?? vr) >= vr);
    } else add("Breakdown vs 20-bar low", `${px(ind.price)} vs ${px(ind.low20)}`, "price < 20-bar low", ind.low20 != null && ind.price < ind.low20);
  } else if (kind === "dip") {
    const dip = Number(s.dipPct ?? 3), ref = ctx.ref ?? ind.high20;
    const drop = ref ? ((ind.price - ref) / ref) * 100 : null;
    add("Drop from recent high", `${f(drop, 2)}% (from ${px(ref)})`, `≤ −${dip}%`, drop != null && drop <= -dip);
  } else if (kind === "dca") {
    add("Schedule", `every ${s.everyHours ?? 24}h`, "time since last buy ≥ interval", true);
  }
  if (ind.volumeRise != null && !rows.some((r) => r.input === "Relative volume")) add("Relative volume", `${f(ind.volumeRise, 2)}×`, "context", true);
  if (ind.sma20 != null && ind.price) add("Trend vs SMA20", `${f(((ind.price - ind.sma20) / ind.sma20) * 100, 1)}% ${ind.price >= ind.sma20 ? "above" : "below"}`, "context", true);
  return rows;
}

/** Deterministic plain-English "why" (2–3 sentences) from the recorded facts only. */
export function templateText(o: { agent: string; side: string; symbol: string; kind: string; strategy: any; ind: any; reason?: string; qty?: number | null; price?: number | null; stop?: number | null; target?: number | null; status: string; rows: Row[] }) {
  // "24h change was 3.20% (needs ≥ 1.5%)", "MACD was positive", "RSI(14) was 64 (needs < 75, not overbought)".
  const phrase = (r: Row) => r.value === r.rule ? `${r.input} was ${r.value}` : `${r.input} was ${r.value} (needs ${r.rule.replace(/\s*\(([^)]*)\)/, ", $1")})`;
  const passed = o.rows.filter((r) => r.ok && r.rule !== "context").map(phrase);
  const what = o.side === "buy" ? "bought" : "sold";
  const did = ["filled", "partially_filled"].includes(o.status) ? `${o.agent} ${what} ${o.qty ? `${+Number(o.qty).toPrecision(6)} ` : ""}${o.symbol}${o.price ? ` at ${px(o.price)}` : ""}`
    : o.status === "rejected" ? `${o.agent} wanted to ${o.side} ${o.symbol} but the order engine blocked it` : `${o.agent} placed an order to ${o.side} ${o.symbol} (${o.status.replace("_", " ")})`;
  const style: Record<string, string> = { momentum: "momentum entry", news: "news-momentum entry", mean_reversion: "oversold-bounce rule", breakout: "breakout rule", dip: "dip-buy rule", dca: "scheduled accumulation" };
  const list = passed.length > 1 ? `${passed.slice(0, -1).slice(0, 2).join(", ")} and ${passed.at(-1)}` : passed[0];
  const s1 = `${did}${passed.length ? ` because ${list}` : o.reason ? ` because: ${o.reason}` : ""}.`;
  const s2 = o.side === "buy" ? `That's its ${style[o.kind] ?? "rule"}${o.stop || o.target ? `; it set ${[o.stop ? `a stop at ${px(o.stop)}` : null, o.target ? `a take-profit at ${px(o.target)}` : null].filter(Boolean).join(" and ")}` : ""}.` : `That's its exit rule for this strategy.`;
  return `${s1} ${s2}`;
}

/** Full Why card payload for one agent event (own events only). Caches the text in data.explanation. */
export async function explainEvent(userId: string, eventId: number) {
  const e = await one<any>(`SELECT e.*, a.name AS agent_name, a.strategy AS agent_strategy FROM agent_events e LEFT JOIN agents a ON a.id=e.agent_id WHERE e.id=$1 AND e.user_id=$2`, [eventId, userId]);
  if (!e) throw new HttpError(404, "Event not found");
  const d = e.data ?? {};
  const strategy = d.strategy ?? e.agent_strategy ?? {};
  const kind = strategy.kind ?? "momentum";
  const order = d.orderId ? await one<any>(`SELECT o.id, o.side, o.status, o.filled_quantity, o.avg_fill_price, o.realized_pnl, o.checks, o.status_reason, o.created_at, a.symbol, a.last_price
                                             FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.id=$1 AND o.user_id=$2`, [d.orderId, userId]) : null;
  const asset = !order && d.assetId ? await one<any>("SELECT symbol, last_price FROM assets WHERE id=$1", [d.assetId]) : null;
  const symbol = order?.symbol ?? asset?.symbol ?? "the asset";
  const side = d.side ?? order?.side ?? d.signal?.action ?? "buy";
  const ind = d.inputs ?? null;
  const vote = await one<any>("SELECT vote, reasons, note FROM agent_trade_feedback WHERE user_id=$1 AND event_id=$2", [userId, eventId]);
  const base = { eventId: e.id, agentId: e.agent_id, agent: e.agent_name ?? "Agent", title: e.title, at: e.created_at, version: e.version, side, symbol, myVote: vote ? { vote: vote.vote, reasons: vote.reasons, note: vote.note } : null };
  if (!ind) return { ...base, text: "No recorded inputs for this decision.", rows: [], rule: { kind, version: e.version }, checks: [], result: null, hasInputs: false };

  const rows = inputRows(kind, strategy, ind, side);
  const qty = order ? Number(order.filled_quantity) || null : null, price = order?.avg_fill_price ? Number(order.avg_fill_price) : d.price ? Number(d.price) : null;
  const tp = Number(strategy.takeProfitPct ?? 0), sl = Number(strategy.stopLossPct ?? 0);
  const text = d.explanation ?? templateText({ agent: e.agent_name ?? "The agent", side, symbol, kind, strategy, ind, reason: d.signal?.reason, qty, price,
    stop: side === "buy" && price && sl ? price * (1 - sl / 100) : null, target: side === "buy" && price && tp ? price * (1 + tp / 100) : null, status: order?.status ?? d.status ?? "recorded", rows });
  if (!d.explanation) await q("UPDATE agent_events SET data = jsonb_set(COALESCE(data,'{}'::jsonb), '{explanation}', to_jsonb($2::text)) WHERE id=$1", [eventId, text]).catch(() => {});
  // Result so far: realized P&L on a sell; on a buy, unrealized against today's price.
  let result: any = null;
  if (order && Number(order.filled_quantity) > 0) {
    if (order.side === "sell") result = { kind: "realized", pnl: Number(order.realized_pnl), label: `${usd(Number(order.realized_pnl))} realized` };
    else if (order.last_price) {
      const pnl = (Number(order.last_price) - Number(order.avg_fill_price)) * Number(order.filled_quantity);
      const pct = ((Number(order.last_price) - Number(order.avg_fill_price)) / Number(order.avg_fill_price)) * 100;
      result = { kind: "unrealized", pnl, pct, now: Number(order.last_price), label: `${usd(pnl)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%) · now ${px(Number(order.last_price))}` };
    }
  }
  const checks = (order?.checks ?? []).map((c: any) => ({ name: c.name, ok: !!c.ok, message: c.message }));
  return { ...base, text, rows, rule: { kind, version: e.version, reason: d.signal?.reason ?? null }, checks, result, orderId: order?.id ?? null, status: order?.status ?? d.status ?? null, hasInputs: true };
}

/**
 * 👍/👎 "Would you have done this?" — upsert (one per user + event). 👎 with a reason adds a lesson to the agent's memory;
 * 5 recent 👎 sharing a reason create one Auto-Training proposal (the user approves it there). Rules never change here.
 */
export async function rateEvent(userId: string, eventId: number, vote: 1 | -1, reasons: string[] = [], note?: string) {
  const bad = reasons.filter((r) => !(REASONS as readonly string[]).includes(r));
  if (bad.length) throw new HttpError(400, `Unknown reason: ${bad.join(", ")}`);
  const e = await one<any>("SELECT e.id, e.agent_id, e.data, a.name, a.version, a.strategy FROM agent_events e JOIN agents a ON a.id=e.agent_id WHERE e.id=$1 AND e.user_id=$2", [eventId, userId]);
  if (!e) throw new HttpError(404, "Event not found");
  const order = e.data?.orderId ? await one<any>("SELECT id FROM orders WHERE id=$1 AND user_id=$2", [e.data.orderId, userId]) : null;
  await q(`INSERT INTO agent_trade_feedback (user_id, agent_id, event_id, order_id, vote, reasons, note) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (user_id, event_id) DO UPDATE SET vote=EXCLUDED.vote, reasons=EXCLUDED.reasons, note=EXCLUDED.note, updated_at=now()`,
    [userId, e.agent_id, eventId, order?.id ?? null, vote, reasons, note?.slice(0, 280) ?? null]);
  let candidate: any = null;
  if (vote === -1 && reasons.length) {
    const what = `${e.data?.side ?? "trade"} ${e.data?.inputs?.price ? `at ${px(e.data.inputs.price)}` : ""}`.trim();
    await remember(e.agent_id, "lessons", `User said “${reasons.map((r) => REASON_LABEL[r as Reason]).join(", ")}” about a ${what}${note ? `: ${note}` : ""}`);
    for (const r of reasons.filter((x) => x !== "good_call")) candidate = (await maybePropose(userId, e, r as Reason)) ?? candidate;
  }
  return { ok: true, agreement: await agreement(userId, e.agent_id), candidate };
}

async function maybePropose(userId: string, e: any, reason: Reason) {
  const recent = await q<any>(`SELECT event_id FROM agent_trade_feedback WHERE user_id=$1 AND agent_id=$2 AND vote=-1 AND $3 = ANY(reasons) AND created_at > now() - interval '30 days' ORDER BY created_at DESC LIMIT 20`, [userId, e.agent_id, reason]);
  if (recent.length < 5) return null;
  const open = await one("SELECT 1 FROM agent_training_candidates WHERE agent_id=$1 AND status='proposed' AND diagnosis->>'source'='feedback' AND diagnosis->>'reason'=$2", [e.agent_id, reason]);
  if (open) return null;
  const s = { ...(e.strategy ?? {}) };
  const proposed = { ...s };
  const why: Record<Reason, string> = { too_big: "You rated 5+ recent trades as too big: trade size −25%", too_risky: "You rated 5+ recent trades as too risky: tighter stop-loss", bad_timing: "You rated 5+ recent entries as badly timed: stricter entry", wrong_asset: "You rated 5+ recent trades as the wrong asset: review the coin list", good_call: "" };
  if (reason === "too_big") proposed.tradeUsd = Math.max(1, Math.round(Number(s.tradeUsd ?? 100) * 0.75));
  if (reason === "too_risky") proposed.stopLossPct = Math.max(0.5, +((Number(s.stopLossPct) || 4) * 0.75).toFixed(2));
  if (reason === "bad_timing") { if ((s.kind ?? "momentum") === "momentum") proposed.minChangePct = +(Number(s.minChangePct ?? 1.5) + 0.5).toFixed(2); else if (s.kind === "dip") proposed.dipPct = +(Number(s.dipPct ?? 3) + 1).toFixed(2); else proposed.rsiMax = Math.max(50, Number(s.rsiMax ?? 75) - 5); }
  const c = await one<any>("INSERT INTO agent_training_candidates (agent_id, user_id, base_version, diagnosis, proposed, evidence) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [e.agent_id, userId, e.version ?? 1, JSON.stringify({ source: "feedback", reason, reasons: [why[reason]] }), JSON.stringify(proposed), JSON.stringify({ ratedEvents: recent.map((r) => r.event_id), note: "From your 👎 ratings. Nothing changes until you approve it on Auto-Training." })]);
  await emit(userId, { agentId: e.agent_id, kind: "training", title: `Improvement proposed for ${e.name} from your ratings`, body: `${why[reason]}. Review it on Auto-Training: nothing changes until you approve.`, data: { candidateId: c.id } });
  return c;
}

/** "You agreed with 82% of Vega's trades (34 rated)" + top reasons + last 20 ratings. */
export async function agreement(userId: string, agentId: string) {
  const s = await one<any>("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE vote=1)::int AS up FROM agent_trade_feedback WHERE user_id=$1 AND agent_id=$2", [userId, agentId]);
  const reasons = await q<any>("SELECT r, COUNT(*)::int AS n FROM agent_trade_feedback, unnest(reasons) r WHERE user_id=$1 AND agent_id=$2 GROUP BY r ORDER BY n DESC LIMIT 5", [userId, agentId]);
  const last = await q<any>(`SELECT f.event_id, f.vote, f.reasons, f.note, f.updated_at, e.title FROM agent_trade_feedback f JOIN agent_events e ON e.id=f.event_id WHERE f.user_id=$1 AND f.agent_id=$2 ORDER BY f.updated_at DESC LIMIT 20`, [userId, agentId]);
  const n = s?.n ?? 0;
  return { rated: n, agreedPct: n ? Math.round(((s?.up ?? 0) / n) * 100) : null, topReasons: reasons.map((r) => ({ reason: r.r, label: REASON_LABEL[r.r as Reason] ?? r.r, count: r.n })), last };
}
