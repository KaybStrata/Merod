import { one, q } from "../db";
import { paperSummary } from "./summary";

export type DigestEvent = { at: string; kind: "fill" | "agent" | "alert" | "auto"; agent?: string | null; text: string; pnl?: number | null };

/**
 * "While you were away" for one user: only that user's fills, agent decisions/executions, triggered alerts and auto trades since
 * talk_last_seen_at (or `sinceParam`), plus a paper portfolio summary. Marks them seen by bumping talk_last_seen_at.
 */
export async function buildDigest(userId: string, sinceParam?: string | null) {
  const prof = await one<any>("SELECT display_name, handle, talk_last_seen_at FROM user_profiles WHERE user_id=$1", [userId]);
  const parsed = sinceParam ? new Date(/^\d+$/.test(sinceParam) ? Number(sinceParam) : sinceParam) : null;
  const since = parsed && !Number.isNaN(parsed.getTime()) ? parsed
    : prof?.talk_last_seen_at ? new Date(prof.talk_last_seen_at) : new Date(Date.now() - 24 * 3600_000);
  const [fills, agentEv, alerts, autos] = await Promise.all([
    q<any>(`SELECT o.side, o.filled_quantity, o.avg_fill_price, o.realized_pnl, o.source, o.is_paper, o.updated_at, a.symbol
              FROM orders o JOIN assets a ON a.id=o.asset_id
             WHERE o.user_id=$1 AND o.status IN ('filled','partially_filled') AND o.updated_at > $2 ORDER BY o.updated_at DESC LIMIT 20`, [userId, since]),
    q<any>(`SELECT e.kind, e.title, e.created_at, g.name FROM agent_events e LEFT JOIN agents g ON g.id=e.agent_id
             WHERE e.user_id=$1 AND e.created_at > $2 AND e.kind IN ('decision','execution','warning') ORDER BY e.created_at DESC LIMIT 20`, [userId, since]),
    q<any>(`SELECT pa.direction, pa.price, pa.triggered_at, a.symbol FROM price_alerts pa JOIN assets a ON a.id=pa.asset_id
             WHERE pa.user_id=$1 AND pa.triggered_at > $2 ORDER BY pa.triggered_at DESC LIMIT 10`, [userId, since]),
    q<any>(`SELECT symbol, mode, return_pct, created_at, closed_at FROM auto_trades
             WHERE user_id=$1 AND (created_at > $2 OR closed_at > $2) ORDER BY greatest(created_at, COALESCE(closed_at, created_at)) DESC LIMIT 10`, [userId, since]),
  ]);
  const num = (n: unknown, d = 4) => Number(Number(n).toPrecision(d));
  const iso = (t: unknown) => new Date(t as any).toISOString();
  const events: DigestEvent[] = [
    ...fills.map((f): DigestEvent => ({ at: iso(f.updated_at), kind: "fill", agent: f.source === "manual" ? null : f.source,
      text: `${f.side === "buy" ? "Bought" : "Sold"} ${num(f.filled_quantity)} ${f.symbol} at $${num(f.avg_fill_price, 6)}${f.is_paper ? " (paper)" : ""}`,
      pnl: f.side === "sell" && Number(f.realized_pnl) ? Math.round(Number(f.realized_pnl) * 100) / 100 : null })),
    ...agentEv.map((e): DigestEvent => ({ at: iso(e.created_at), kind: "agent", agent: e.name ?? null, text: String(e.title).slice(0, 200) })),
    ...alerts.map((a): DigestEvent => ({ at: iso(a.triggered_at), kind: "alert", text: `${a.symbol} went ${a.direction} $${num(a.price, 6)}` })),
    ...autos.map((t): DigestEvent => ({ at: iso(t.closed_at ?? t.created_at), kind: "auto", agent: "Auto trading",
      text: t.closed_at ? `Closed ${t.symbol} ${Number(t.return_pct) >= 0 ? "+" : ""}${Number(t.return_pct ?? 0).toFixed(2)}%${t.mode === "theory" ? " (theoretical)" : ""}`
        : `Opened ${t.symbol}${t.mode === "theory" ? " (theoretical)" : ""}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  const p = await paperSummary(userId);
  await q("UPDATE user_profiles SET talk_last_seen_at=now() WHERE user_id=$1", [userId]);
  return {
    greetingName: String(prof?.display_name ?? prof?.handle ?? "").split(" ")[0],
    since: since.toISOString(),
    portfolio: { total: p.total, overnight: p.dayPnl, cash: p.cash, riskUsedPct: p.riskUsedPct },
    events,
  };
}
