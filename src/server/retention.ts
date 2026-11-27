import "@/lib/server-only-shim";
import { q } from "./db";

/**
 * Data retention: the database disk is small, and several logs grow every few seconds (provider request log, bot status
 * lines, agent thoughts, heartbeats). This keeps what's useful and drops old noise, in small batches so it never locks
 * the tables for long. Trades, orders, fills, positions, audit log, skills, schedules and ratings are never touched.
 */
const RULES: { name: string; sql: string }[] = [
  // Every outside API request (prices, DEX, CoinGecko…): only needed for recent health/latency views.
  { name: "provider_events", sql: "DELETE FROM provider_events WHERE id IN (SELECT id FROM provider_events WHERE created_at < now() - interval '2 days' LIMIT 20000)" },
  // Bot "watching / holding" status lines: a day of detail, two weeks for everything else (trades are kept in orders).
  { name: "bot_observations", sql: "DELETE FROM bot_activity_logs WHERE id IN (SELECT id FROM bot_activity_logs WHERE level='observation' AND created_at < now() - interval '1 day' LIMIT 20000)" },
  { name: "bot_logs", sql: "DELETE FROM bot_activity_logs WHERE id IN (SELECT id FROM bot_activity_logs WHERE created_at < now() - interval '14 days' LIMIT 20000)" },
  // Agent thoughts / analysis / state lines; decisions and executions (with their Why cards) are kept 90 days.
  { name: "agent_chatter", sql: "DELETE FROM agent_events WHERE id IN (SELECT id FROM agent_events WHERE kind IN ('thought','analysis','state','message','system') AND created_at < now() - interval '7 days' AND id NOT IN (SELECT event_id FROM agent_trade_feedback) LIMIT 20000)" },
  { name: "agent_events", sql: "DELETE FROM agent_events WHERE id IN (SELECT id FROM agent_events WHERE created_at < now() - interval '90 days' AND id NOT IN (SELECT event_id FROM agent_trade_feedback) LIMIT 20000)" },
  // Worker heartbeats, 5-minute bars after a month, skipped mimic events after two weeks, old read notifications.
  { name: "worker_heartbeats", sql: "DELETE FROM worker_heartbeats WHERE last_seen_at < now() - interval '1 day'" },
  { name: "bars_5m", sql: "DELETE FROM price_bars WHERE ctid IN (SELECT ctid FROM price_bars WHERE timeframe='5m' AND ts < now() - interval '30 days' LIMIT 20000)" },
  { name: "copy_skipped", sql: "DELETE FROM copy_trade_events WHERE id IN (SELECT id FROM copy_trade_events WHERE status IN ('skipped','watched') AND created_at < now() - interval '14 days' LIMIT 20000)" },
  { name: "notifications", sql: "DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at < now() - interval '60 days' LIMIT 20000)" },
];

export async function pruneOldData() {
  const done: Record<string, number> = {};
  for (const r of RULES) {
    try { const res: any = await q(`WITH d AS (${r.sql} RETURNING 1) SELECT count(*)::int AS n FROM d`); done[r.name] = res[0]?.n ?? 0; }
    catch { /* table/column may not exist on older databases; skip */ }
  }
  return done;
}
