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
  g.__merodPool ?? new pg.Pool({ connectionString: env.databaseUrl, ssl: sslFor(env.databaseUrl), max: Number(process.env.PG_POOL_MAX ?? 10), idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 });

/**
 * Turn a Postgres connection failure into a plain-English fix. Never includes the connection string,
 * password or host — only which KIND of address is configured.
 */
export function describeDbError(e: unknown): { code: string; hint: string } | null {
  const err = e as { code?: string; message?: string };
  const msg = String(err?.message ?? "");
  const code = String(err?.code ?? "");
  let host = "";
  try { host = new URL(env.databaseUrl.replace(/^postgres(ql)?:/, "http:")).hostname; } catch { /* unparseable */ }
  const kind = !process.env.DATABASE_URL ? "missing" : host.endsWith(".railway.internal") ? "private" : /localhost|127\.0\.0\.1/.test(host) ? "localhost" : "public";
  if (kind === "missing") return { code: "db_url_missing", hint: "DATABASE_URL is not set. Add it in your hosting provider's environment variables, then redeploy." };
  if (kind === "private" && process.env.VERCEL === "1") return { code: "db_url_private", hint: "DATABASE_URL is Railway's PRIVATE address (…railway.internal), which Vercel can't reach. Use the Postgres service's DATABASE_PUBLIC_URL instead, then redeploy." };
  if (kind === "localhost" && process.env.VERCEL === "1") return { code: "db_url_localhost", hint: "DATABASE_URL points to localhost. Use your database's public URL, then redeploy." };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { code: "db_host_not_found", hint: "The database address in DATABASE_URL doesn't exist. Re-copy DATABASE_PUBLIC_URL exactly (no spaces or quotes), then redeploy." };
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return { code: "db_refused", hint: "The database refused the connection. Check the port in DATABASE_URL and that the database's public TCP proxy is enabled." };
  if (code === "ETIMEDOUT" || /timeout/i.test(msg)) return { code: "db_timeout", hint: "Timed out connecting to the database. Make sure DATABASE_URL is the PUBLIC address and the database is running." };
  if (code === "28P01" || code === "28000") return { code: "db_auth", hint: "The database rejected the username/password in DATABASE_URL. Re-copy DATABASE_PUBLIC_URL, then redeploy." };
  if (code === "3D000") return { code: "db_missing", hint: "The database name in DATABASE_URL doesn't exist." };
  if (code === "42P01") return { code: "db_not_migrated", hint: "The database has no Merod tables yet. Deploy the Railway worker (it runs migrations) or run `npm run db:setup` against this database — and make sure Vercel and the worker use the SAME database." };
  if (/ssl|certificate|self.signed/i.test(msg)) return { code: "db_ssl", hint: "SSL problem connecting to the database. Set DATABASE_SSL=true (or false if your database doesn't support SSL), then redeploy." };
  return null;
}
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
