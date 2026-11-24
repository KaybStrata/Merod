/**
 * Test helpers. Tests run against a real Postgres database (TEST_DATABASE_URL, default merod_test)
 * that has been migrated + seeded (`npm run db:setup` with DATABASE_URL pointed at it).
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://merod:merod@localhost:5432/merod_test";
process.env.MEROD_ENV = "dev";
delete process.env.REDIS_URL; // realtime publishing is a no-op in tests

import { randomUUID } from "node:crypto";

export async function newUser(opts: { mode?: "manual" | "auto_within_limits" | "auto_until_approval" } = {}) {
  const { createUser } = await import("@/server/auth");
  const { q } = await import("@/server/db");
  const tag = randomUUID().slice(0, 8);
  const id = await createUser(`t_${tag}@test.local`, "correct-horse-battery", `t_${tag}`, `Test ${tag}`);
  if (opts.mode) await q("UPDATE trading_permissions SET mode=$2 WHERE user_id=$1", [id, opts.mode]);
  return id;
}

/** Keep simulated prices "fresh" so stale-price protection doesn't reject test orders. */
export async function freshPrices() {
  const { q } = await import("@/server/db");
  // The test catalog runs on simulated prices (production never does).
  await q("INSERT INTO feature_flags (key, enabled, description) VALUES ('simulated_prices', true, 'tests') ON CONFLICT (key) DO UPDATE SET enabled=true");
  await q("UPDATE assets SET price_updated_at=now()");
}

export async function assetId(symbol: string, venue?: string) {
  const { one } = await import("@/server/db");
  const r = await one<{ id: string }>("SELECT id FROM assets WHERE symbol=$1 AND ($2::text IS NULL OR venue=$2) ORDER BY market_cap DESC NULLS LAST LIMIT 1", [symbol, venue ?? null]);
  if (!r) throw new Error(`asset ${symbol} not seeded`);
  return r.id;
}

export const ctx = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId, source: "manual" as const, idempotencyKey: randomUUID(), actor: { type: "user" as const, id: userId }, userConfirmed: true, ...extra,
});

export async function closePool() {
  const { pool } = await import("@/server/db");
  await pool.end();
}
