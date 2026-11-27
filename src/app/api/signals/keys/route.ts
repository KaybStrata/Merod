import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { q } from "@/server/db";
import { createSignalKey } from "@/server/signals";

export const GET = route(async () => {
  const u = await requireUser();
  const keys = await q<any>(
    `SELECT k.id, k.name, k.key_prefix, k.account_id, k.enabled, k.per_trade_usd, k.max_order_usd, k.max_daily_usd, k.allow_live, k.last_used_at, k.last_error, k.created_at,
            t.kind AS account_kind, t.label AS account_name,
            (SELECT count(*)::int FROM signal_events e WHERE e.key_id=k.id AND e.created_at > now() - interval '24 hours') AS signals_24h,
            (SELECT count(*)::int FROM signal_events e WHERE e.key_id=k.id AND e.status='filled' AND e.created_at > now() - interval '24 hours') AS filled_24h
       FROM signal_keys k LEFT JOIN trading_accounts t ON t.id=k.account_id WHERE k.user_id=$1 ORDER BY k.created_at`, [u.id]);
  const events = await q<any>(
    `SELECT e.id, e.key_id, k.name, e.action, e.symbol, e.status, e.reason, e.order_id, e.notional, e.created_at
       FROM signal_events e JOIN signal_keys k ON k.id=e.key_id WHERE e.user_id=$1 ORDER BY e.id DESC LIMIT 100`, [u.id]);
  const accounts = await q<any>("SELECT id, label AS name, kind FROM trading_accounts WHERE user_id=$1 AND status='active' ORDER BY (kind='paper') DESC, created_at", [u.id]);
  return ok({ keys, events, accounts });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`signal-keys:${u.id}`, 20, 3600);
  const b = await parse(req, z.object({ name: z.string().min(1).max(80), perTradeUsd: z.number().min(1).max(1e7).optional(), maxOrderUsd: z.number().min(0).max(1e8).optional(), maxDailyUsd: z.number().min(0).max(1e9).optional(), accountId: z.string().uuid().nullable().optional() }));
  const { key, row } = await createSignalKey(u.id, b);
  return ok({ key, signalKey: row });
});
