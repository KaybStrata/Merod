import { requireSuperAdmin } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { getSettings } from "@/server/auto/engine";

/** Compact live feed for the left menu: decisions, executions, closes, and Modo's latest thoughts. */
export const GET = route(async (req) => {
  const u = await requireSuperAdmin();
  const sp = new URL(req.url).searchParams;
  const modoOnly = sp.get("origin") === "modo", autoOnly = sp.get("origin") === "auto", full = sp.get("full") === "1";
  const limit = full ? 300 : modoOnly ? 40 : 12;
  const s = await getSettings(u.id);
  const trades = await q<any>(
    `SELECT id, symbol, mode, status, origin, confidence, return_pct, explain_during, created_at, closed_at FROM auto_trades WHERE user_id=$1 AND ($2::boolean IS NOT TRUE OR origin='modo') AND ($3::boolean IS NOT TRUE OR origin IS DISTINCT FROM 'modo') ORDER BY greatest(created_at, COALESCE(closed_at, created_at)) DESC LIMIT $4`, [u.id, modoOnly, autoOnly, limit]);
  const events: { at: string; kind: "decision" | "execution" | "close" | "thought"; text: string; id?: string; symbol?: string; mode?: string; returnPct?: number | null; origin?: string }[] = [];
  for (const t of trades) {
    const who = t.origin === "modo" ? "Modo" : "Auto";
    if (t.closed_at) events.push({ at: t.closed_at, kind: "close", text: `${who} closed ${t.symbol} ${Number(t.return_pct) >= 0 ? "+" : ""}${Number(t.return_pct).toFixed(2)}%${t.mode === "theory" ? " (theoretical)" : ""}` });
    if (t.mode === "real" && t.explain_during) events.push({ at: t.created_at, kind: "execution", text: `${who} ${/filled|submitted/i.test(t.explain_during) ? "bought" : "order"} ${t.symbol}: ${String(t.explain_during).split(".")[0]}` });
    else events.push({ at: t.created_at, kind: "decision", text: `${who} decided: buy ${t.symbol}${t.mode === "theory" ? " (theoretical)" : ""}, ${Math.round(Number(t.confidence) * 100)}% confidence` });
  }
  if (!autoOnly) for (const th of (s.modo_thoughts ?? []).slice(modoOnly || full ? -200 : -6))
    if (!(modoOnly && th.kind === "idea" && /^Bought /.test(th.text))) // executions already come from the trade records
      events.push({ at: new Date(th.at).toISOString(), kind: "thought", text: modoOnly ? th.text : `Modo: ${th.text}` });
  // Postgres returns Date objects; normalise every timestamp to ISO text before sorting.
  for (const e of events) e.at = new Date(e.at as any).toISOString();
  events.sort((a, b) => b.at.localeCompare(a.at));
  return ok({ enabled: !!s.enabled, modoAutopilot: !!s.modo_autopilot, lastRun: s.modo_last_run_at, events: events.slice(0, full ? 400 : modoOnly ? 100 : 14),
    stats: full ? { trades: trades.length, real: trades.filter((t) => t.mode === "real").length, theory: trades.filter((t) => t.mode === "theory").length, closed: trades.filter((t) => t.closed_at).length, wins: trades.filter((t) => t.closed_at && Number(t.return_pct) > 0).length, avgReturn: (() => { const c = trades.filter((t) => t.closed_at); return c.length ? c.reduce((s, t) => s + Number(t.return_pct), 0) / c.length : null; })() } : undefined });
});
