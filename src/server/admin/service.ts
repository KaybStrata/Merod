import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { FLAG_DEFS, invalidateFlags, type FlagKey } from "../flags";
import { verifyStepUp } from "../auth";
import { HttpError } from "../errors";
import { publish } from "../realtime";

/* ───────── Overview / monitoring ───────── */
export async function overview() {
  const [heartbeats, events, health, usage, pricing, counts] = await Promise.all([
    q(`SELECT worker_id, kind, last_seen_at, info, (now() - last_seen_at) < interval '60 seconds' AS alive FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 20`),
    q(`SELECT id, source, level, message, data, created_at FROM system_events ORDER BY id DESC LIMIT 40`),
    q(`SELECT provider_id, environment, status, enabled, approval_status, last_success_at, last_tested_at, last_error FROM provider_configs ORDER BY provider_id, environment`),
    q(`SELECT provider_id,
              count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND kind IN ('request','error','rate_limit'))::int AS req_24h,
              count(*) FILTER (WHERE created_at > now() - interval '7 days' AND kind IN ('request','error','rate_limit'))::int AS req_7d,
              count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND kind='error')::int AS err_24h,
              count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND kind='rate_limit')::int AS rl_24h,
              round(avg(latency_ms) FILTER (WHERE created_at > now() - interval '24 hours'))::int AS avg_ms
         FROM provider_events GROUP BY provider_id ORDER BY req_7d DESC`),
    q(`SELECT provider_id, cost_per_1k FROM provider_pricing`),
    one(`SELECT (SELECT count(*)::int FROM users) AS users,
                (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS users_7d,
                (SELECT count(*)::int FROM trading_bots WHERE status='running') AS bots_running,
                (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '24 hours') AS orders_24h,
                (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '24 hours' AND NOT is_paper) AS live_orders_24h,
                (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS active_sessions`),
  ]);
  const price = new Map((pricing as any[]).map((p) => [p.provider_id, Number(p.cost_per_1k)]));
  const usageWithCost = (usage as any[]).map((u) => ({
    ...u, cost_per_1k: price.get(u.provider_id) ?? null,
    est_cost_7d: price.has(u.provider_id) ? (u.req_7d / 1000) * price.get(u.provider_id)! : null,
  }));
  return { heartbeats, events, health, usage: usageWithCost, counts };
}

export async function setPricing(adminId: string, providerId: string, costPer1k: number | null) {
  if (costPer1k === null) await q("DELETE FROM provider_pricing WHERE provider_id=$1", [providerId]);
  else await q(`INSERT INTO provider_pricing (provider_id, cost_per_1k, updated_by) VALUES ($1,$2,$3)
                ON CONFLICT (provider_id) DO UPDATE SET cost_per_1k=$2, updated_by=$3, updated_at=now()`, [providerId, costPer1k, adminId]);
  await audit({ actorType: "admin", actorId: adminId, action: "admin.pricing_set", target: providerId, data: { costPer1k } });
}

/* ───────── Users ───────── */
export async function listUsers(search: string, limit = 50, offset = 0) {
  const like = `%${search.toLowerCase()}%`;
  return q(
    `SELECT u.id, u.email, u.role, u.status, u.totp_enabled, u.trading_mode, u.country, u.created_at, p.handle, p.display_name,
            (SELECT max(created_at) FROM sessions s WHERE s.user_id=u.id) AS last_login,
            (SELECT count(*)::int FROM orders o WHERE o.user_id=u.id) AS orders,
            (SELECT count(*)::int FROM trading_bots b WHERE b.user_id=u.id AND b.status='running') AS bots_running
       FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE ($1 = '%%' OR lower(u.email) LIKE $1 OR lower(p.handle) LIKE $1 OR lower(p.display_name) LIKE $1)
      ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`, [like, limit, offset]);
}

export async function updateUser(adminId: string, userId: string, patch: { role?: string; status?: "active" | "suspended" }) {
  if (userId === adminId && (patch.role && patch.role !== "admin" || patch.status === "suspended"))
    throw new HttpError(400, "You cannot demote or suspend your own admin account");
  const u = await one<any>("SELECT id, role, status FROM users WHERE id=$1", [userId]);
  if (!u) throw new HttpError(404, "User not found");
  // The super-admin role can only be granted through the secured sign-up flow and cannot be changed or suspended here.
  if (u.role === "super_admin") throw new HttpError(403, "The super admin account can't be modified from the admin panel");
  if (patch.role === "super_admin") throw new HttpError(403, "The super admin role can't be granted from the admin panel");
  if (patch.role) await q("UPDATE users SET role=$2, updated_at=now() WHERE id=$1", [userId, patch.role]);
  if (patch.status) {
    await q("UPDATE users SET status=$2, updated_at=now() WHERE id=$1", [userId, patch.status]);
    if (patch.status === "suspended") {
      await q("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await q("UPDATE trading_bots SET status='halted' WHERE user_id=$1 AND status IN ('running','paused')", [userId]);
    }
  }
  await audit({ actorType: "admin", actorId: adminId, userId, action: "admin.user_updated", target: userId, data: { from: { role: u.role, status: u.status }, to: patch } });
}

/* ───────── Feature flags ───────── */
export const REAL_MONEY_FLAGS: FlagKey[] = ["live_crypto_trading", "live_brokerage_trading", "automated_real_money", "copy_trading", "funding", "withdrawals"];

export async function listFlags() {
  const rows = await q<any>(`SELECT f.key, f.enabled, f.description, f.requires_approval, f.approval_reference, f.updated_at, p.handle AS updated_by
                               FROM feature_flags f LEFT JOIN user_profiles p ON p.user_id=f.updated_by ORDER BY f.key`);
  return rows.map((r) => ({ ...r, real_money: REAL_MONEY_FLAGS.includes(r.key), live_allowed_by_env: process.env.MEROD_ALLOW_LIVE_FLAGS === "true" }));
}

export async function setFlag(adminId: string, key: string, enabled: boolean, approvalReference?: string, code?: string) {
  if (!(key in FLAG_DEFS)) throw new HttpError(400, "Unknown flag");
  const f = await one<any>("SELECT * FROM feature_flags WHERE key=$1", [key]);
  if (!f) throw new HttpError(404, "Flag not initialised — run the seed");
  const isHalt = key === "global_trading_halt";
  // Engaging the emergency halt must never be blocked by paperwork.
  const needsControls = !(isHalt && enabled) && (f.requires_approval || isHalt);
  if (needsControls) {
    if (enabled && REAL_MONEY_FLAGS.includes(key as FlagKey) && process.env.MEROD_ALLOW_LIVE_FLAGS !== "true")
      throw new HttpError(403, "Real-money features are locked for this deployment. Set MEROD_ALLOW_LIVE_FLAGS=true on the server only after broker/legal approvals are complete.");
    if (!approvalReference?.trim() && !(isHalt && !enabled)) throw new HttpError(400, "An approval reference (agreement / ticket / license ID) is required");
    if (!(await verifyStepUp(adminId, code))) throw new HttpError(403, "Valid 2FA code required. Enable two-factor authentication in Settings → Security first.");
  }
  await q("UPDATE feature_flags SET enabled=$2, approval_reference=COALESCE($3, approval_reference), updated_by=$4, updated_at=now() WHERE key=$1",
    [key, enabled, approvalReference?.trim() || null, adminId]);
  if (f.requires_approval && approvalReference)
    await q("INSERT INTO compliance_records (kind, reference, details, created_by) VALUES ('feature_flag',$1,$2,$3)", [approvalReference.trim(), JSON.stringify({ key, enabled }), adminId]);
  invalidateFlags();
  await audit({ actorType: "admin", actorId: adminId, action: enabled ? "flag.enabled" : "flag.disabled", target: key, data: { reference: approvalReference ?? null } });
  if (isHalt) await publish("admin", "global_halt", { enabled });
}

/* ───────── Jurisdictions ───────── */
export const listJurisdictions = () => q("SELECT country, feature, allowed FROM jurisdiction_rules ORDER BY country, feature");
export async function upsertJurisdiction(adminId: string, country: string, feature: string, allowed: boolean) {
  await q(`INSERT INTO jurisdiction_rules (country, feature, allowed) VALUES ($1,$2,$3) ON CONFLICT (country, feature) DO UPDATE SET allowed=$3`, [country, feature, allowed]);
  await audit({ actorType: "admin", actorId: adminId, action: "jurisdiction.set", target: `${country}:${feature}`, data: { allowed } });
}
export async function deleteJurisdiction(adminId: string, country: string, feature: string) {
  await q("DELETE FROM jurisdiction_rules WHERE country=$1 AND feature=$2", [country, feature]);
  await audit({ actorType: "admin", actorId: adminId, action: "jurisdiction.deleted", target: `${country}:${feature}` });
}

/* ───────── Audit log ───────── */
export async function listAudit(f: { action?: string; userId?: string; before?: number; limit?: number }) {
  return q(
    `SELECT a.id, a.actor_type, a.actor_id, a.user_id, p.handle, a.action, a.target, a.data, a.ip, a.created_at, a.hash
       FROM audit_logs a LEFT JOIN user_profiles p ON p.user_id=a.user_id
      WHERE ($1::text IS NULL OR a.action ILIKE $1) AND ($2::uuid IS NULL OR a.user_id=$2) AND ($3::bigint IS NULL OR a.id < $3)
      ORDER BY a.id DESC LIMIT $4`,
    [f.action ? `%${f.action}%` : null, f.userId ?? null, f.before ?? null, Math.min(f.limit ?? 50, 200)]);
}

/** Verify the tamper-evident chain using the canonical verifier shared with scripts/security-check. */
export async function verifyChain(adminId: string) {
  const { verifyAuditChain } = await import("./audit-verify");
  const r = await verifyAuditChain();
  await audit({ actorType: "admin", actorId: adminId, action: "audit.chain_verified", data: { ok: r.ok, checked: r.checked, brokenId: r.brokenId ?? null } });
  return r;
}

/* ───────── Trading activity ───────── */
export async function tradingActivity() {
  const [recent, byStatus, bySource, paperLive] = await Promise.all([
    q(`SELECT o.id, o.created_at, o.side, o.order_type, o.quantity, o.notional_usd, o.status, o.status_reason, o.source, o.is_paper, o.provider_id,
              a.symbol, a.venue, p.handle FROM orders o JOIN assets a ON a.id=o.asset_id LEFT JOIN user_profiles p ON p.user_id=o.user_id
        ORDER BY o.created_at DESC LIMIT 60`),
    q(`SELECT status, count(*)::int AS n FROM orders WHERE created_at > now() - interval '7 days' GROUP BY status ORDER BY n DESC`),
    q(`SELECT source, count(*)::int AS n FROM orders WHERE created_at > now() - interval '7 days' GROUP BY source ORDER BY n DESC`),
    one(`SELECT count(*) FILTER (WHERE is_paper)::int AS paper, count(*) FILTER (WHERE NOT is_paper)::int AS live,
                COALESCE(sum(notional_usd) FILTER (WHERE is_paper AND status='filled'),0) AS paper_volume,
                COALESCE(sum(notional_usd) FILTER (WHERE NOT is_paper AND status='filled'),0) AS live_volume
           FROM orders WHERE created_at > now() - interval '7 days'`),
  ]);
  return { recent, byStatus, bySource, paperLive };
}
