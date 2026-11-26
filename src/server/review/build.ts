import "@/lib/server-only-shim";
import { q, one } from "../db";
import { investedPaper, livePaper } from "./invested";
import { secLabel } from "@/lib/timeDial";

/**
 * Performance review for any window that ends now (spec "Explain & Review", feature 5). Paper book.
 * Honest numbers: realized and unrealized are separate, fees are included, estimates are labelled, nothing is projected.
 */
export type Item = { label: string; source: string; pnl: number; trades: number; link?: string };
export type Suggestion = { text: string; why: string; href: string; action: string };
export type Review = {
  window: { start: number; end: number; seconds: number; label: string };
  pnl: { change: number; pct: number; invested: number; vsInvested: number; realized: number; unrealized: number; startValue: number | null; endValue: number; netDeposits: number; previous?: number };
  worked: Item[]; didnt: Item[];
  bySource: { source: string; pnl: number; trades: number }[];
  saved: { reason: string; at: number; estAvoided?: number; detail: string }[];
  habits: { trades: number; closed: number; winRate: number | null; avgHoldSec: number | null; feesUsd: number };
  agents: { agentId: string; name: string; pnl: number; trades: number; agreement?: number | null; rated: number }[];
  suggestions: Suggestion[];
  estimated: boolean; notes: string[];
};

export const MIN_S = 60, MAX_S = 5 * 365 * 86_400;
const SOURCE_LABEL: Record<string, string> = { manual: "You (manual)", prompt: "Ask Merod", shortcut: "Shortcuts", bot: "Bots", agent: "Agents", copy: "Mimic", auto: "Auto", conditional: "Conditional orders", system: "Merod" };

export async function buildReview(userId: string, opts: { seconds: number; compare?: boolean; now?: Date }): Promise<Review> {
  const seconds = Math.round(opts.seconds);
  if (!(seconds >= MIN_S && seconds <= MAX_S)) throw new Error("Pick a window between 1 minute and 5 years");
  const end = Math.floor((opts.now ?? new Date()).getTime() / 1000), start = end - seconds;
  const notes: string[] = [];

  // ── P&L: value now vs value at the start (recorded snapshot), minus money you added or took out in the window.
  const [live, invested] = await Promise.all([livePaper(userId), investedPaper(userId)]);
  const startSnap = await one<any>("SELECT total_value FROM portfolio_snapshots WHERE user_id=$1 AND is_paper AND ts <= to_timestamp($2) ORDER BY ts DESC LIMIT 1", [userId, start]);
  const netDeposits = Number((await one<any>(`SELECT COALESCE(SUM(t.amount_usd),0) AS d FROM transactions t JOIN trading_accounts a ON a.id=t.account_id AND a.kind='paper'
                                               WHERE t.user_id=$1 AND t.kind IN ('deposit','withdrawal','reset') AND t.status='confirmed' AND t.created_at > to_timestamp($2)`, [userId, start]))?.d ?? 0);
  const realized = Number((await one<any>(`SELECT COALESCE(SUM(realized_pnl),0) AS r FROM orders WHERE user_id=$1 AND is_paper AND side='sell' AND filled_quantity > 0 AND updated_at > to_timestamp($2)`, [userId, start]))?.r ?? 0);
  let estimated = false, startValue: number | null = startSnap ? Number(startSnap.total_value) : null, change: number;
  if (startValue != null) change = live.value - startValue - netDeposits;
  else {
    // No snapshot that old: realized P&L in the window + today's unrealized on positions (an estimate, labelled).
    estimated = true; change = realized + live.unrealized;
    notes.push("No recorded portfolio value at the start of this window, so P&L = realized in the window + current unrealized (estimated).");
  }
  const base = startValue ?? invested;
  const pnl = { change, pct: base ? (change / base) * 100 : 0, invested, vsInvested: live.value - invested, realized, unrealized: live.unrealized, startValue, endValue: live.value, netDeposits } as Review["pnl"];

  // ── Orders in the window (filled), labelled by who placed them.
  const orders = await q<any>(
    `SELECT o.id, o.side, o.source, o.source_ref, o.realized_pnl, o.filled_quantity, o.avg_fill_price, o.fees_usd, o.platform_fee_usd, o.updated_at, o.asset_id, o.account_id, a.symbol,
            b.name AS bot_name, g.name AS agent_name, f.label AS copy_label
       FROM orders o JOIN assets a ON a.id=o.asset_id
       LEFT JOIN trading_bots b ON o.source='bot' AND b.id::text=o.source_ref
       LEFT JOIN agents g ON o.source='agent' AND g.id::text=o.source_ref
       LEFT JOIN copy_follows f ON o.source='copy' AND f.id::text=o.source_ref
      WHERE o.user_id=$1 AND o.is_paper AND o.filled_quantity > 0 AND o.updated_at > to_timestamp($2) ORDER BY o.updated_at`, [userId, start]);
  const who = (o: any) => o.source === "bot" ? `${o.bot_name ?? "Bot"} · ${o.symbol}` : o.source === "agent" ? `${o.agent_name ?? "Agent"} · ${o.symbol}` : o.source === "copy" ? `Mimic · ${o.copy_label ?? "leader"}`
    : o.source === "prompt" ? `Ask Merod · ${o.symbol}` : o.source === "auto" ? `Auto · ${o.symbol}` : `You · ${o.symbol} (${o.source})`;
  const groups = new Map<string, Item>();
  for (const o of orders) {
    const k = who(o), g = groups.get(k) ?? { label: k, source: o.source, pnl: 0, trades: 0, link: o.source === "agent" && o.source_ref ? `/agents/${o.source_ref}` : o.source === "bot" && o.source_ref ? `/bots/${o.source_ref}` : `/terminal/${o.asset_id}` };
    g.trades++; if (o.side === "sell") g.pnl += Number(o.realized_pnl ?? 0);
    groups.set(k, g);
  }
  const ranked = [...groups.values()].filter((g) => Math.abs(g.pnl) >= 0.005);
  const worked = ranked.filter((g) => g.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 3);
  const didnt = ranked.filter((g) => g.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 3);
  const bySourceMap = new Map<string, { source: string; pnl: number; trades: number }>();
  for (const o of orders) { const s = bySourceMap.get(o.source) ?? { source: o.source, pnl: 0, trades: 0 }; s.trades++; if (o.side === "sell") s.pnl += Number(o.realized_pnl ?? 0); bySourceMap.set(o.source, s); }
  const bySource = [...bySourceMap.values()].sort((a, b) => b.pnl - a.pnl);

  // ── Habits: win rate over closed (sell) trades, average hold (buy → sell of the same asset in the same account), fees.
  const sells = orders.filter((o) => o.side === "sell" && Number(o.realized_pnl) !== 0);
  const holds: number[] = [];
  for (const s of orders.filter((o) => o.side === "sell")) {
    const b = await one<any>("SELECT extract(epoch from max(updated_at))::bigint AS t FROM orders WHERE account_id=$1 AND asset_id=$2 AND side='buy' AND filled_quantity>0 AND updated_at < $3", [s.account_id, s.asset_id, s.updated_at]);
    if (b?.t) holds.push(new Date(s.updated_at).getTime() / 1000 - Number(b.t));
  }
  const habits = { trades: orders.length, closed: sells.length, winRate: sells.length ? (sells.filter((o) => Number(o.realized_pnl) > 0).length / sells.length) * 100 : null,
    avgHoldSec: holds.length ? holds.reduce((a, x) => a + x, 0) / holds.length : null, feesUsd: orders.reduce((a, o) => a + Number(o.fees_usd ?? 0) + Number(o.platform_fee_usd ?? 0), 0) };

  // ── Rules that saved you: blocked orders (failed checks), halts and loss limits. Loss avoided only from real bars, labelled est.
  const saved: Review["saved"] = [];
  const blocked = await q<any>(`SELECT o.id, o.side, o.notional_usd, o.quantity, o.status_reason, o.checks, o.updated_at, o.asset_id, a.symbol, a.last_price FROM orders o JOIN assets a ON a.id=o.asset_id
                                 WHERE o.user_id=$1 AND o.status='rejected' AND o.updated_at > to_timestamp($2) ORDER BY o.updated_at DESC LIMIT 30`, [userId, start]);
  for (const b of blocked) {
    const failed = (b.checks ?? []).filter((c: any) => !c.ok).map((c: any) => c.message || c.name);
    const entry: Review["saved"][number] = { reason: failed[0] ?? b.status_reason ?? "Blocked by a risk check", at: Math.floor(new Date(b.updated_at).getTime() / 1000), detail: `${b.side === "buy" ? "Buy" : "Sell"} ${b.symbol} blocked: ${(failed.join("; ") || b.status_reason || "").slice(0, 200)}` };
    if (b.side === "buy") {
      const px = await one<any>(`SELECT (SELECT close FROM price_bars WHERE asset_id=$1 AND timeframe='1h' AND ts <= $2 ORDER BY ts DESC LIMIT 1) AS ref,
                                        (SELECT min(low) FROM price_bars WHERE asset_id=$1 AND timeframe='1h' AND ts > $2 AND ts <= $2::timestamptz + interval '24 hours') AS low`, [b.asset_id, b.updated_at]);
      const notional = Number(b.notional_usd ?? 0) || Number(b.quantity ?? 0) * Number(px?.ref ?? 0);
      if (px?.ref && px?.low && notional > 0 && Number(px.low) < Number(px.ref)) entry.estAvoided = notional * (1 - Number(px.low) / Number(px.ref));
    }
    saved.push(entry);
  }
  const halts = await q<any>(`SELECT e.created_at, e.title, e.body FROM agent_events e WHERE e.user_id=$1 AND e.kind='warning' AND (e.title ILIKE '%loss limit%' OR e.title ILIKE '%halt%') AND e.created_at > to_timestamp($2) ORDER BY e.id DESC LIMIT 10`, [userId, start]).catch(() => []);
  for (const h of halts) saved.push({ reason: "Loss limit", at: Math.floor(new Date(h.created_at).getTime() / 1000), detail: h.title });
  const botHalts = await q<any>(`SELECT l.created_at, l.message, b.name FROM bot_activity_logs l JOIN trading_bots b ON b.id=l.bot_id WHERE b.user_id=$1 AND l.level='control' AND l.message ILIKE 'Halted%' AND l.created_at > to_timestamp($2) ORDER BY l.id DESC LIMIT 10`, [userId, start]);
  for (const h of botHalts) saved.push({ reason: "Bot stopped", at: Math.floor(new Date(h.created_at).getTime() / 1000), detail: `${h.name}: ${h.message}` });

  // ── Agents: realized P&L in the window and how often you agreed with them.
  const agentRows = await q<any>(`SELECT g.id, g.name, COALESCE(SUM(o.realized_pnl) FILTER (WHERE o.side='sell'),0) AS pnl, COUNT(o.*)::int AS trades,
                                         (SELECT COUNT(*)::int FROM agent_trade_feedback f WHERE f.agent_id=g.id AND f.user_id=$1) AS rated,
                                         (SELECT COUNT(*) FILTER (WHERE vote=1)::int FROM agent_trade_feedback f WHERE f.agent_id=g.id AND f.user_id=$1) AS up
                                    FROM agents g LEFT JOIN orders o ON o.source='agent' AND o.source_ref=g.id::text AND o.filled_quantity>0 AND o.updated_at > to_timestamp($2)
                                   WHERE g.user_id=$1 AND g.status <> 'archived' GROUP BY g.id, g.name HAVING COUNT(o.*) > 0 OR (SELECT COUNT(*) FROM agent_trade_feedback f WHERE f.agent_id=g.id) > 0`, [userId, start]).catch(() => []);
  const agents = agentRows.map((a: any) => ({ agentId: a.id, name: a.name, pnl: Number(a.pnl), trades: a.trades, rated: a.rated, agreement: a.rated ? Math.round((a.up / a.rated) * 100) : null }));

  const review: Review = { window: { start, end, seconds, label: secLabel(seconds) }, pnl, worked, didnt, bySource, saved, habits, agents, suggestions: [], estimated, notes };
  review.suggestions = seconds >= 3600 ? await suggestionsFor(userId, review) : [];
  if (seconds < 3600 && !orders.length) notes.push(`Not enough activity in the last ${secLabel(seconds)}.`);
  if (opts.compare) {
    const prev = await buildReview(userId, { seconds, now: new Date((start) * 1000) }).catch(() => null);
    if (prev) review.pnl.previous = prev.pnl.change;
  }
  return review;
}

/** Deterministic proposals. Each links into an existing approval flow; nothing is applied from here. */
export async function suggestionsFor(userId: string, r: Review): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  // An agent losing money that you rated "too risky" → tighten its stop (opens the agent's settings; you approve).
  for (const a of r.agents) {
    const risky = await one<any>("SELECT COUNT(*)::int AS n FROM agent_trade_feedback WHERE user_id=$1 AND agent_id=$2 AND vote=-1 AND 'too_risky' = ANY(reasons)", [userId, a.agentId]).catch(() => null);
    const losses = await one<any>("SELECT COUNT(*)::int AS n FROM orders WHERE source='agent' AND source_ref=$1 AND side='sell' AND realized_pnl < 0 AND updated_at > to_timestamp($2)", [a.agentId, r.window.start]);
    if ((losses?.n ?? 0) >= 3 || ((risky?.n ?? 0) > 0 && a.pnl < 0)) {
      const s = (await one<any>("SELECT strategy FROM agents WHERE id=$1", [a.agentId]))?.strategy ?? {};
      const next = Math.max(1, Math.round((Number(s.stopLossPct) || 8) * 0.75));
      out.push({ text: `Tighten ${a.name}'s stop to ${next}%`, why: `${losses?.n ?? 0} losing trades${risky?.n ? `, ${risky.n} rated too risky` : ""} in this period.`, href: `/agents/${a.agentId}?tab=settings`, action: "Review" });
    }
    if (a.agreement != null && a.agreement >= 80 && a.pnl > 0 && a.rated >= 5) out.push({ text: `Consider more capital for ${a.name}`, why: `You agreed with ${a.agreement}% of its trades and it made $${a.pnl.toFixed(2)} this period.`, href: `/agents/${a.agentId}?tab=settings`, action: "Review" });
  }
  // Manual trades losing more than they win → a shortcut with a stop.
  const manual = await one<any>(`SELECT COUNT(*) FILTER (WHERE realized_pnl > 0)::int AS w, COUNT(*) FILTER (WHERE realized_pnl < 0)::int AS l FROM orders WHERE user_id=$1 AND source='manual' AND side='sell' AND updated_at > to_timestamp($2)`, [userId, r.window.start]);
  const mt = (manual?.w ?? 0) + (manual?.l ?? 0);
  if (mt >= 3 && (manual.w / mt) < 0.4) out.push({ text: `Your manual trades lost ${manual.l} of ${mt}. Try a shortcut with a stop`, why: "A stop-loss on every manual trade limits the losers.", href: "/shortcuts", action: "Review" });
  // Bots losing money → review their settings.
  const lb = r.worked.length || r.didnt.length ? r.didnt.find((d) => d.source === "bot") : null;
  if (lb) out.push({ text: `Review ${lb.label.split(" · ")[0]}: it lost $${Math.abs(lb.pnl).toFixed(2)}`, why: "Its biggest losses this period.", href: lb.link ?? "/bots", action: "Review" });
  return out.slice(0, 3);
}

/** One-paragraph text version (Talk replies, notifications). */
export function reviewText(r: Review) {
  const $ = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  const lines = [`Your review, last ${r.window.label}${r.estimated ? " (estimated)" : ""}: ${$(r.pnl.change)} (${r.pnl.pct >= 0 ? "+" : ""}${r.pnl.pct.toFixed(2)}%), realized ${$(r.pnl.realized)}, unrealized ${$(r.pnl.unrealized)}; ${$(r.pnl.vsInvested)} vs the $${r.pnl.invested.toLocaleString("en-US", { maximumFractionDigits: 0 })} you put in.`];
  if (r.worked.length) lines.push(`Worked: ${r.worked.map((w) => `${w.label} ${$(w.pnl)}`).join(", ")}.`);
  if (r.didnt.length) lines.push(`Didn't: ${r.didnt.map((w) => `${w.label} ${$(w.pnl)}`).join(", ")}.`);
  if (r.habits.trades) lines.push(`${r.habits.trades} trades${r.habits.winRate != null ? `, ${r.habits.winRate.toFixed(0)}% win rate` : ""}, $${r.habits.feesUsd.toFixed(2)} fees.`);
  if (r.saved.length) lines.push(`Rules that saved you: ${r.saved.length} (${r.saved.slice(0, 2).map((s) => s.reason).join("; ")}).`);
  if (r.suggestions.length) lines.push(`Merod suggests: ${r.suggestions.map((s, i) => `${i + 1}. ${s.text}`).join(" ")}`);
  return lines.join("\n");
}

/** Worker loop: send each due scheduled review as a notification linking to /review?seconds=every_sec, then advance next_at. */
export async function runScheduledReviews() {
  const due = await q<any>(`UPDATE review_schedules SET last_at=now(), next_at = now() + make_interval(secs => every_sec)
                             WHERE user_id IN (SELECT user_id FROM review_schedules WHERE next_at <= now() ORDER BY next_at LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING *`);
  const { notify } = await import("../engine/engine");
  for (const s of due) {
    try {
      const r = await buildReview(s.user_id, { seconds: Math.min(MAX_S, s.every_sec) });
      await notify(s.user_id, "review", `Your review: last ${r.window.label} ${r.pnl.change >= 0 ? "+" : "−"}$${Math.abs(r.pnl.change).toFixed(2)}`, reviewText(r).slice(0, 900), `/review?seconds=${s.every_sec}`);
    } catch { /* try again next time */ }
  }
  return due.length;
}
