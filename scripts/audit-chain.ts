import { createHash } from "node:crypto";
import { pool } from "@/server/db";
import { canonical } from "@/server/audit";

/** Recompute the audit hash chain exactly as src/server/audit.ts writes it. */
export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; message: string; brokenId?: number }> {
  const client = await pool.connect();
  try {
    const cursorRows = await client.query(
      "SELECT id, actor_type, actor_id, user_id, action, target, data, prev_hash, hash, created_at FROM audit_logs ORDER BY id");
    let prev: string | null = null, checked = 0;
    for (const r of cursorRows.rows) {
      const createdAt = new Date(r.created_at).toISOString();
      const body = canonical([r.actor_type, r.actor_id, r.user_id, r.action, r.target, r.data, createdAt]);
      const expected = createHash("sha256").update((prev ?? "GENESIS") + body).digest("hex");
      if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, checked, brokenId: Number(r.id), message: `Chain broken at audit row ${r.id}` };
      prev = r.hash; checked++;
    }
    return { ok: true, checked, message: `${checked} audit rows verified` };
  } finally { client.release(); }
}
