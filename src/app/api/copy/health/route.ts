import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q, one } from "@/server/db";
import { getCredential } from "@/server/providers/credentials";

/** Mimic health: is the copy engine running, which keys are connected, what happened in the last 24h and why. */
export const GET = route(async () => {
  const u = await requireUser();
  const [follows, errors, events, reasons, last, helius, birdeye] = await Promise.all([
    one<any>(`SELECT COUNT(*) FILTER (WHERE status='active')::int AS active, COUNT(*) FILTER (WHERE status='active' AND kind='wallet')::int AS wallets,
                     COUNT(*) FILTER (WHERE status='active' AND kind='user')::int AS traders, COUNT(*) FILTER (WHERE status='active' AND mode='watch')::int AS watching,
                     COUNT(*) FILTER (WHERE status<>'active')::int AS paused, COUNT(*) FILTER (WHERE status='active' AND last_error IS NOT NULL)::int AS erroring,
                     extract(epoch from max(last_checked_at))::bigint AS last_checked, COUNT(*) FILTER (WHERE status='active' AND last_checked_at IS NULL)::int AS never_checked
                FROM copy_follows WHERE follower_id=$1`, [u.id]),
    q<any>(`SELECT last_error, COUNT(*)::int AS n FROM copy_follows WHERE follower_id=$1 AND status='active' AND last_error IS NOT NULL GROUP BY last_error ORDER BY n DESC LIMIT 5`, [u.id]),
    q<any>(`SELECT e.status, COUNT(*)::int AS n, COALESCE(SUM(e.copy_notional),0) AS usd FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id
             WHERE f.follower_id=$1 AND e.created_at > now() - interval '24 hours' GROUP BY e.status`, [u.id]),
    q<any>(`SELECT e.reason, COUNT(*)::int AS n FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id
             WHERE f.follower_id=$1 AND e.created_at > now() - interval '24 hours' AND e.status IN ('skipped','failed') AND e.reason IS NOT NULL GROUP BY e.reason ORDER BY n DESC LIMIT 6`, [u.id]),
    one<any>(`SELECT e.created_at, e.side, e.symbol, e.status, e.copy_notional, f.label FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id WHERE f.follower_id=$1 ORDER BY e.id DESC LIMIT 1`, [u.id]),
    getCredential("helius", "production", "HELIUS_API_KEY", u.id).then(Boolean).catch(() => false),
    getCredential("birdeye", "production", "BIRDEYE_API_KEY", u.id).then(Boolean).catch(() => false),
  ]);
  const byStatus = Object.fromEntries(events.map((e) => [e.status, { n: e.n, usd: Number(e.usd) }]));
  const lastChecked = follows?.last_checked ? Number(follows.last_checked) : null;
  const engineRunning = !!lastChecked && Date.now() / 1000 - lastChecked < 180;
  const problems: string[] = [];
  if ((follows?.wallets ?? 0) > 0 && !helius) problems.push("No Helius key: wallet swaps can't be read, so nothing from public wallets is copied. Add it in Admin → Integrations or Broker & AI keys.");
  if ((follows?.active ?? 0) > 0 && !engineRunning) problems.push(lastChecked ? `The copy engine last checked ${Math.round(Date.now() / 1000 - lastChecked)}s ago: the worker may be down.` : "The copy engine hasn't checked any mimic yet: the worker may be down.");
  for (const e of errors) problems.push(`${e.n} mimic${e.n === 1 ? "" : "s"}: ${e.last_error}`);
  return ok({
    follows: { active: follows?.active ?? 0, wallets: follows?.wallets ?? 0, traders: follows?.traders ?? 0, watching: follows?.watching ?? 0, paused: follows?.paused ?? 0, erroring: follows?.erroring ?? 0, neverChecked: follows?.never_checked ?? 0 },
    engine: { running: engineRunning, lastChecked },
    keys: { helius, birdeye },
    last24h: { copied: byStatus.copied ?? { n: 0, usd: 0 }, pending: byStatus.pending_approval ?? { n: 0, usd: 0 }, watched: byStatus.watched ?? { n: 0, usd: 0 }, skipped: byStatus.skipped ?? { n: 0, usd: 0 }, failed: byStatus.failed ?? { n: 0, usd: 0 } },
    topReasons: reasons, lastEvent: last, problems,
    healthy: problems.length === 0,
  });
});
