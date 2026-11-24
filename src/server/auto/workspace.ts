import "@/lib/server-only-shim";
import { one, q } from "../db";
import { HttpError } from "../errors";
import { isRealSource } from "../ai/market-answers";
import { extractAssets } from "../ai/parser";
import { ensureParserCatalog } from "../ai/interpret";
import { getSettings, theoryRecord, overview, runFor, sweep, learn, STRATEGY_KINDS, DEFAULT_WEIGHTS } from "./engine";

/**
 * Data for the multi-screen auto trading workspace. Everything here is read from real records:
 * strategies, auto trades, orders, positions, snapshots and live (non-simulated) prices. Panels with no data stay empty.
 */
const real = (a: any) => a?.last_price != null && isRealSource(a.price_source);

export async function workspace(userId: string) {
  const ov = await overview(userId);
  const settings = ov.settings;

  // Strategies (+ their asset symbols, open trades, and status).
  const strategies = await q<any>(
    `SELECT s.*, COALESCE((SELECT json_agg(json_build_object('id', a.id, 'symbol', a.symbol) ORDER BY a.market_cap DESC NULLS LAST) FROM assets a WHERE a.id = ANY(s.asset_ids)), '[]') AS assets,
            (SELECT count(*)::int FROM auto_trades t WHERE t.strategy_id=s.id AND t.status='open') AS open_trades,
            (SELECT count(*)::int FROM auto_trades t WHERE t.strategy_id=s.id) AS trades
       FROM auto_strategies s WHERE s.user_id=$1 ORDER BY s.created_at`, [userId]);
  for (const s of strategies) s.label = STRATEGY_KINDS[s.kind]?.label ?? s.kind;

  // All assets the workspace trades: strategies + hand-picked.
  const assetIds = [...new Set([...strategies.filter((s) => s.enabled).flatMap((s) => s.asset_ids), ...(settings.asset_ids ?? [])])];
  const assets = assetIds.length ? await q<any>(
    `SELECT id, symbol, name, asset_class, last_price, change_24h, price_source, price_updated_at, logo_url FROM assets WHERE id = ANY($1::uuid[]) ORDER BY market_cap DESC NULLS LAST`, [assetIds]) : [];
  const tiles = assets.slice(0, 8).map((a) => ({ ...a, live: real(a), strategy: strategies.find((s) => s.enabled && s.asset_ids.includes(a.id))?.label ?? "Hand-picked" }));

  // Active positions opened by auto trading (real orders), valued at live prices.
  const positions = await q<any>(
    `SELECT t.id, t.symbol, t.asset_id, a.asset_class, o.filled_quantity AS qty, COALESCE(o.avg_fill_price, t.entry_price) AS entry, a.last_price, a.price_source,
            t.created_at, s.name AS strategy, o.is_paper
       FROM auto_trades t JOIN orders o ON o.id=t.order_id JOIN assets a ON a.id=t.asset_id LEFT JOIN auto_strategies s ON s.id=t.strategy_id
      WHERE t.user_id=$1 AND t.mode='real' AND t.status='open' AND o.filled_quantity > 0 ORDER BY t.created_at DESC`, [userId]);
  for (const p of positions) {
    const cur = real(p) ? Number(p.last_price) : null;
    p.current = cur; p.pnl = cur != null ? (cur - Number(p.entry)) * Number(p.qty) : null; p.roi = cur != null ? (cur / Number(p.entry) - 1) * 100 : null;
  }

  // Concurrent queue: the latest auto decisions and where each one is.
  const queue = (await q<any>(
    `SELECT t.id, t.symbol, t.mode, t.status, t.confidence, t.created_at, t.explain_before, t.explain_during, t.explain_after, t.return_pct, o.status AS order_status, o.notional_usd, s.name AS strategy
       FROM auto_trades t LEFT JOIN orders o ON o.id=t.order_id LEFT JOIN auto_strategies s ON s.id=t.strategy_id
      WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 12`, [userId])).map((t) => ({
    ...t, state: t.status === "closed" ? "Closed" : t.status === "failed" ? "Failed" : t.mode === "theory" ? "Testing" :
      t.order_status === "pending_approval" ? "Needs approval" : t.order_status === "submitted" || t.order_status === "partially_filled" ? "Executing" : t.order_status === "filled" ? "Holding" : "Queued",
  }));

  // Watchlists (real prices only): yours, Modo's picks, most volatile, hottest crypto.
  const cols = "a.id, a.symbol, a.name, a.asset_class, a.last_price, a.change_24h, a.price_source";
  const realOnly = "a.last_price IS NOT NULL AND a.price_source IS NOT NULL AND a.price_source <> 'simulated' AND NOT ('demo_data' = ANY(a.risk_flags))";
  const [mine, picks, vol, hot] = await Promise.all([
    q<any>(`SELECT DISTINCT ON (a.id) ${cols} FROM watchlists w JOIN watchlist_items i ON i.watchlist_id=w.id JOIN assets a ON a.id=i.asset_id WHERE w.user_id=$1 AND ${realOnly} LIMIT 30`, [userId]).catch(() => []),
    q<any>(`SELECT DISTINCT ON (a.id) ${cols} FROM modo_ideas m JOIN assets a ON a.id=m.asset_id WHERE m.user_id=$1 AND m.side='buy' AND m.created_at > now() - interval '24 hours' AND ${realOnly} LIMIT 20`, [userId]),
    q<any>(`SELECT ${cols} FROM assets a WHERE ${realOnly} AND a.change_24h IS NOT NULL ORDER BY abs(a.change_24h) DESC LIMIT 15`),
    q<any>(`SELECT ${cols} FROM assets a WHERE ${realOnly} AND a.asset_class='crypto' ORDER BY a.volume_24h DESC NULLS LAST LIMIT 15`),
  ]);
  const watchlists = { mine, picks, volatility: vol, hot };

  // Scheduled tasks, bots, approvals.
  const tasks = await q<any>("SELECT * FROM auto_tasks WHERE user_id=$1 ORDER BY at_time", [userId]);
  const bots = [
    ...strategies.map((s) => ({ id: s.id, name: s.name, kind: "strategy", status: settings.enabled && s.enabled ? "Running" : s.enabled ? "Waiting (switch off)" : "Paused", assets: s.asset_ids.length })),
    ...(await q<any>("SELECT id, name, status, cardinality(asset_ids) AS assets FROM trading_bots WHERE user_id=$1 AND status <> 'stopped' ORDER BY created_at DESC LIMIT 10", [userId]))
      .map((b) => ({ id: b.id, name: b.name, kind: "bot", status: b.status[0].toUpperCase() + b.status.slice(1), assets: b.assets })),
  ];
  const approvals = await q<any>(
    `SELECT o.id, o.side, o.notional_usd, o.quantity, o.source, o.created_at, o.status_reason, a.symbol FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.status='pending_approval' ORDER BY o.created_at DESC LIMIT 10`, [userId]);

  return { settings, strategies, kinds: Object.entries(STRATEGY_KINDS).map(([id, k]) => ({ id, label: k.label, note: k.note })), tiles, positions, queue, watchlists,
    tasks, bots, approvals, risk: await risk(userId, positions, assetIds.length), theory: ov.theory, realRecord: ov.real, activity: await activity(userId) };
}

/** Portfolio & risk from real records: equity, P&L, exposure, 24h drawdown, 95% one-day VaR from snapshot history. */
async function risk(userId: string, autoPositions: any[], assetsTrading: number) {
  const cash = Number((await one<any>("SELECT COALESCE(SUM(cash_balance),0) AS c FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [userId]))?.c ?? 0);
  const pos = await q<any>(`SELECT p.quantity, p.avg_cost, a.last_price, a.price_source FROM positions p JOIN trading_accounts t ON t.id=p.account_id JOIN assets a ON a.id=p.asset_id
                             WHERE p.user_id=$1 AND t.kind='paper' AND p.quantity>0`, [userId]);
  const priced = pos.filter(real);
  const invested = priced.reduce((s, p) => s + Number(p.quantity) * Number(p.last_price), 0);
  const unrealized = priced.reduce((s, p) => s + Number(p.quantity) * (Number(p.last_price) - Number(p.avg_cost)), 0);
  const realized = Number((await one<any>("SELECT COALESCE(SUM(realized_pnl),0) AS r FROM orders WHERE user_id=$1 AND status IN ('filled','partially_filled')", [userId]))?.r ?? 0);
  const equity = cash + invested;
  const snaps = await q<any>("SELECT ts, total_value FROM portfolio_snapshots WHERE user_id=$1 AND is_paper AND ts > now() - interval '30 days' ORDER BY ts", [userId]);
  const day = snaps.filter((s) => Date.now() - new Date(s.ts).getTime() < 86_400_000).map((s) => Number(s.total_value));
  let peak = -Infinity, maxDD = 0;
  for (const v of [...day, equity]) { peak = Math.max(peak, v); maxDD = Math.max(maxDD, peak > 0 ? (peak - v) / peak : 0); }
  const start24 = day[0] ?? null;
  // Daily returns from the last value of each day.
  const byDay = new Map<string, number>();
  for (const s of snaps) byDay.set(new Date(s.ts).toISOString().slice(0, 10), Number(s.total_value));
  const closes = [...byDay.values()];
  const rets = closes.slice(1).map((v, i) => v / closes[i] - 1).filter((x) => isFinite(x));
  const sd = rets.length >= 5 ? Math.sqrt(rets.reduce((s, r) => s + (r - rets.reduce((a, b) => a + b, 0) / rets.length) ** 2, 0) / (rets.length - 1)) : null;
  return {
    equity, change24hPct: start24 ? (equity / start24 - 1) * 100 : null, realized, unrealized, total: realized + unrealized,
    exposurePct: equity > 0 ? (invested / equity) * 100 : 0, maxDrawdown24hPct: day.length ? maxDD * 100 : null, var95Pct: sd != null ? 1.645 * sd * 100 : null,
    openPositions: autoPositions.length, assetsTrading, unpriced: pos.length - priced.length,
  };
}

async function activity(userId: string) {
  const rows = await q<any>(
    `SELECT created_at AS at, CASE WHEN mode='real' THEN 'Bought ' || symbol ELSE 'Testing ' || symbol || ' (theoretical)' END AS text FROM auto_trades WHERE user_id=$1
     UNION ALL SELECT closed_at, 'Closed ' || symbol || ' ' || to_char(return_pct, 'S990D00') || '%' || CASE WHEN mode='theory' THEN ' (theoretical)' ELSE '' END FROM auto_trades WHERE user_id=$1 AND closed_at IS NOT NULL
     UNION ALL SELECT created_at, 'Started strategy: ' || name FROM auto_strategies WHERE user_id=$1
     ORDER BY at DESC LIMIT 12`, [userId]);
  return rows;
}

/* ───────────────────────── Strategies ───────────────────────── */
async function ownedAssets(ids: string[]) {
  if (!ids.length) return [];
  const r = await q<{ id: string }>("SELECT id FROM assets WHERE id = ANY($1::uuid[]) AND NOT ('demo_data' = ANY(risk_flags))", [ids]);
  return r.map((x) => x.id);
}
export async function createStrategy(userId: string, b: { name?: string; kind: string; assetIds: string[]; timeframe?: string }) {
  if (!STRATEGY_KINDS[b.kind]) throw new HttpError(400, "Unknown strategy type");
  const ids = await ownedAssets(b.assetIds);
  if (!ids.length) throw new HttpError(400, "Pick at least one stock or coin");
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM auto_strategies WHERE user_id=$1", [userId]);
  if ((n?.n ?? 0) >= 20) throw new HttpError(400, "You can run up to 20 strategies");
  return one<any>("INSERT INTO auto_strategies (user_id, name, kind, asset_ids, timeframe) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [userId, (b.name?.trim() || STRATEGY_KINDS[b.kind].label).slice(0, 60), b.kind, ids, b.timeframe ?? "5m"]);
}
export async function updateStrategy(userId: string, id: string, b: { name?: string; enabled?: boolean; assetIds?: string[]; kind?: string; timeframe?: string }) {
  const cur = await one<any>("SELECT * FROM auto_strategies WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!cur) throw new HttpError(404, "Strategy not found");
  if (b.kind && !STRATEGY_KINDS[b.kind]) throw new HttpError(400, "Unknown strategy type");
  const ids = b.assetIds ? await ownedAssets(b.assetIds) : cur.asset_ids;
  return one<any>("UPDATE auto_strategies SET name=$3, enabled=$4, asset_ids=$5, kind=$6, timeframe=$7 WHERE id=$1 AND user_id=$2 RETURNING *",
    [id, userId, (b.name ?? cur.name).slice(0, 60), b.enabled ?? cur.enabled, ids, b.kind ?? cur.kind, b.timeframe ?? cur.timeframe]);
}
export async function deleteStrategy(userId: string, id: string) {
  const r = await one("DELETE FROM auto_strategies WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId]);
  if (!r) throw new HttpError(404, "Strategy not found");
}

/** Include/exclude a hand-picked asset (the watchlist checkboxes). */
export async function setAsset(userId: string, assetId: string, include: boolean) {
  await getSettings(userId);
  await q(`INSERT INTO auto_trading (user_id, asset_ids) VALUES ($1, CASE WHEN $3 THEN ARRAY[$2::uuid] ELSE '{}'::uuid[] END)
           ON CONFLICT (user_id) DO UPDATE SET asset_ids = CASE WHEN $3 THEN array(SELECT DISTINCT unnest(auto_trading.asset_ids || $2::uuid)) ELSE array_remove(auto_trading.asset_ids, $2::uuid) END, updated_at=now()`,
    [userId, assetId, include]);
}

/** "Trade NVDA, TSLA and SOL with momentum" → a new strategy. */
export async function planFromText(userId: string, text: string) {
  await ensureParserCatalog();
  const t = text.toLowerCase();
  const kind = /momentum/.test(t) ? "momentum" : /rotat/.test(t) ? "rotation" : /breakout/.test(t) ? "breakout" : /\b(ai|modo|swing)\b/.test(t) ? "ai_swing" : "multi_asset";
  const named = extractAssets(text, 12).filter((a) => a.symbol);
  const ids: string[] = [];
  for (const n of named) {
    const a = await one<{ id: string }>("SELECT id FROM assets WHERE upper(symbol)=upper($1) AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 1", [n.symbol]);
    if (a) ids.push(a.id);
  }
  if (!ids.length) throw new HttpError(400, "Name the stocks or coins to trade, e.g. “trade NVDA, TSLA and SOL with momentum”");
  return createStrategy(userId, { kind, assetIds: ids });
}

/* ───────────────────────── Scheduled tasks ───────────────────────── */
export const TASK_KINDS: Record<string, string> = {
  run: "Run all strategies now",
  rebalance: "Re-check open trades and re-learn the weights",
  take_profit_sweep: "Close every open auto trade that's in profit",
  close_risky: "Close every open auto trade that's losing",
};
export async function saveTask(userId: string, b: { id?: string; name?: string; kind?: string; atTime?: string; days?: string; enabled?: boolean; tz?: string }) {
  if (b.kind && !TASK_KINDS[b.kind]) throw new HttpError(400, "Unknown task type");
  if (b.atTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.atTime)) throw new HttpError(400, "Time must be HH:MM (24-hour)");
  if (b.id) {
    const cur = await one<any>("SELECT * FROM auto_tasks WHERE id=$1 AND user_id=$2", [b.id, userId]);
    if (!cur) throw new HttpError(404, "Task not found");
    return one<any>("UPDATE auto_tasks SET name=$3, kind=$4, at_time=$5, days=$6, enabled=$7, tz=$8 WHERE id=$1 AND user_id=$2 RETURNING *",
      [b.id, userId, (b.name ?? cur.name).slice(0, 60), b.kind ?? cur.kind, b.atTime ?? cur.at_time, b.days ?? cur.days, b.enabled ?? cur.enabled, b.tz ?? cur.tz]);
  }
  if (!b.kind || !b.atTime) throw new HttpError(400, "Pick what the task does and when");
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM auto_tasks WHERE user_id=$1", [userId]);
  if ((n?.n ?? 0) >= 20) throw new HttpError(400, "You can schedule up to 20 tasks");
  return one<any>("INSERT INTO auto_tasks (user_id, name, kind, at_time, days, tz) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [userId, (b.name?.trim() || TASK_KINDS[b.kind]).slice(0, 60), b.kind, b.atTime, b.days ?? "weekdays", b.tz ?? "America/New_York"]);
}
export async function deleteTask(userId: string, id: string) {
  const r = await one("DELETE FROM auto_tasks WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId]);
  if (!r) throw new HttpError(404, "Task not found");
}

export async function runTask(userId: string, task: any) {
  const cfg = await getSettings(userId);
  if (!cfg.enabled) return "Skipped: auto trading is switched off";
  if (task.kind === "run") { const r: any = await runFor(userId); return r.skipped ? `Skipped: ${r.skipped}` : `${r.made} new decision(s)`; }
  if (task.kind === "rebalance") { await runFor(userId); const w = await learn(userId); return `Re-checked trades; weights ${Object.entries(w).map(([k, v]) => `${k} ×${Number(v).toFixed(2)}`).join(", ")}`; }
  if (task.kind === "take_profit_sweep") return `Closed ${await sweep(userId, "winners", `scheduled take-profit sweep (${task.name})`)} winning trade(s)`;
  return `Closed ${await sweep(userId, "losers", `scheduled risk close (${task.name})`)} losing trade(s)`;
}

/** Worker: run each due task once per day at its local time. */
export async function runScheduledTasks() {
  const due = await q<any>(
    `SELECT t.* FROM auto_tasks t JOIN users u ON u.id=t.user_id AND u.role='super_admin'
      WHERE t.enabled AND to_char(now() AT TIME ZONE t.tz, 'HH24:MI') >= t.at_time
        AND (t.last_run_date IS NULL OR t.last_run_date < (now() AT TIME ZONE t.tz)::date)
        AND (t.days='daily' OR extract(isodow FROM now() AT TIME ZONE t.tz) < 6)`);
  for (const t of due) {
    await q("UPDATE auto_tasks SET last_run_date=(now() AT TIME ZONE tz)::date WHERE id=$1", [t.id]);
    let result: string;
    try { result = await runTask(t.user_id, t); } catch (e: any) { result = `Failed: ${e.message}`; }
    await q("UPDATE auto_tasks SET last_result=$2 WHERE id=$1", [t.id, result.slice(0, 300)]);
  }
  return due.length;
}

export { theoryRecord, DEFAULT_WEIGHTS };
