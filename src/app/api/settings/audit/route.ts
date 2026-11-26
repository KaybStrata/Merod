import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/**
 * Your own entries from the append-only, hash-chained audit log (settings changes, keys, 2FA, trades…).
 * ?format=csv downloads up to 5,000 rows. Data payloads are already redacted when written.
 */
export const GET = route(async (req) => {
  const u = await requireUser();
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const rows = await q<any>(
    `SELECT id, actor_type, action, target, ip, hash, created_at FROM audit_logs WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [u.id, csv ? 5000 : 40]);
  if (!csv) {
    const total = await q<{ n: string }>("SELECT count(*)::text AS n FROM audit_logs WHERE user_id=$1", [u.id]);
    return ok({ entries: rows.map((r) => ({ ...r, hash: String(r.hash).slice(0, 12) })), total: Number(total[0]?.n ?? 0) });
  }
  const esc = (v: unknown) => { const s = v == null ? "" : String(v instanceof Date ? v.toISOString() : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = ["id,time,actor,action,target,ip,hash", ...rows.map((r) => [r.id, r.created_at, r.actor_type, r.action, r.target, r.ip, r.hash].map(esc).join(","))].join("\n");
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="merod-audit-log.csv"` } });
});
