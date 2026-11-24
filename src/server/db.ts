import "@/lib/server-only-shim";
import pg from "pg";
import { env } from "./env";

// Postgres NUMERIC → JS number for UI math. Monetary math that must be exact is done in SQL.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const g = globalThis as unknown as { __merodPool?: pg.Pool };
/** TLS for managed Postgres (Railway public proxy, Supabase, Neon). DATABASE_SSL=false/true overrides detection. */
export function sslFor(url: string) {
  if (process.env.DATABASE_SSL === "false") return undefined;
  if (process.env.DATABASE_SSL === "true") return { rejectUnauthorized: false };
  return /localhost|127\.0\.0\.1|\.railway\.internal/.test(url) ? undefined : /sslmode=require|rlwy\.net|railway|supabase|neon/.test(url) ? { rejectUnauthorized: false } : undefined;
}
export const pool: pg.Pool =
  g.__merodPool ?? new pg.Pool({ connectionString: env.databaseUrl, ssl: sslFor(env.databaseUrl), max: Number(process.env.PG_POOL_MAX ?? 10), idleTimeoutMillis: 10_000 });
if (!g.__merodPool) g.__merodPool = pool;

export type Queryable = Pick<pg.PoolClient, "query">;

export async function q<T = any>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const r = await db.query(sql, params as any[]);
  return r.rows as T[];
}
export async function one<T = any>(sql: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const rows = await q<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Run fn in a transaction. Optionally scopes RLS to a user via SET LOCAL app.user_id. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, userId?: string): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
