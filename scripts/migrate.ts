/** Applies migrations/*.sql in order, once each, inside transactions. Safe to run on every deploy. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://merod:merod@localhost:5432/merod";
const ssl = process.env.DATABASE_SSL === "false" ? undefined : process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false }
  : /localhost|127\.0\.0\.1|\.railway\.internal/.test(url) ? undefined : /sslmode=require|rlwy\.net|railway|supabase|neon/.test(url) ? { rejectUnauthorized: false } : undefined;
const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
await client.query("SELECT pg_advisory_lock(777001)"); // one migrator at a time across replicas
const dir = join(process.cwd(), "migrations");
const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
let applied = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  const sql = readFileSync(join(dir, f), "utf8");
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    await client.query("COMMIT");
    console.log(`✔ applied ${f}`);
    applied++;
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`✖ ${f} failed:`, (e as Error).message);
    process.exit(1);
  }
}
await client.query("SELECT pg_advisory_unlock(777001)");
console.log(applied ? `Migrations complete (${applied} applied)` : "Database is up to date");
await client.end();
