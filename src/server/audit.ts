import "@/lib/server-only-shim";
import { one, Queryable, pool } from "./db";
import { sha256 } from "./crypto";

export type ActorType = "user" | "admin" | "ai" | "bot" | "shortcut" | "system" | "worker";

const SECRET_KEYS = /(secret|password|token|apikey|api_key|private|seed|mnemonic|authorization)/i;
/** Strip anything that looks like a credential before it reaches logs. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(val, depth + 1);
  }
  return out;
}

/** Deterministic JSON (sorted keys) so hashes can be re-verified after a jsonb round-trip. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/**
 * Append to the hash-chained audit log. Each row hashes its content + the previous row's hash,
 * so any tampering breaks the chain (verify with scripts/security-check.ts).
 */
export async function audit(
  e: { actorType: ActorType; actorId?: string | null; userId?: string | null; action: string; target?: string; data?: unknown; ip?: string },
  db: Queryable = pool,
) {
  // Outside a caller's transaction, run in our own so the advisory lock is held until commit.
  if (db === pool) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await audit(e, c);
      await c.query("COMMIT");
    } catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; }
    finally { c.release(); }
    return;
  }
  const data = redact(e.data ?? {});
  // Serialise chain appends (transaction-scoped lock) so concurrent writers can't fork the chain.
  await db.query("SELECT pg_advisory_xact_lock(424242)");
  const prev = await one<{ hash: string }>("SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1", [], db);
  const createdAt = new Date().toISOString();
  const body = canonical([e.actorType, e.actorId ?? null, e.userId ?? null, e.action, e.target ?? null, data, createdAt]);
  const hash = sha256((prev?.hash ?? "GENESIS") + body);
  await db.query(
    `INSERT INTO audit_logs (actor_type, actor_id, user_id, action, target, data, ip, prev_hash, hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.actorType, e.actorId ?? null, e.userId ?? null, e.action, e.target ?? null, JSON.stringify(data), e.ip ?? null, prev?.hash ?? null, hash, createdAt],
  );
}

export async function systemEvent(source: string, level: "info" | "warn" | "error" | "critical", message: string, data: unknown = {}) {
  await pool.query("INSERT INTO system_events (source, level, message, data) VALUES ($1,$2,$3,$4)", [source, level, message, JSON.stringify(redact(data))]);
}
