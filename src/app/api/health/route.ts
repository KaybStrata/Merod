import { NextResponse } from "next/server";
import { pool } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + configuration health (never returns secret values). Used by Railway/Vercel/uptime monitors. */
export async function GET() {
  let db = false, migrations = 0, worker: string | null = null;
  try {
    await pool.query("SELECT 1");
    db = true;
    migrations = (await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0]?.n ?? 0;
    worker = (await pool.query("SELECT max(last_seen_at) AS t FROM worker_heartbeats")).rows[0]?.t ?? null;
  } catch { /* reported below */ }
  const prod = process.env.MEROD_ENV === "production" || process.env.VERCEL === "1" || !!process.env.RAILWAY_ENVIRONMENT;
  const config = {
    masterKey: !!process.env.MEROD_MASTER_KEY,
    realtimeSecret: !!process.env.REALTIME_SECRET,
    realtimeUrl: !!process.env.NEXT_PUBLIC_REALTIME_URL,
    redis: !!process.env.REDIS_URL,
  };
  const workerFresh = worker ? Date.now() - new Date(worker).getTime() < 60_000 : false;
  const ok = db && (!prod || (config.masterKey && config.realtimeSecret));
  return NextResponse.json(
    { ok, env: process.env.MEROD_ENV ?? process.env.VERCEL_ENV ?? "dev", db, migrations, workerLastSeen: worker, workerHealthy: workerFresh, config,
      ...(ok ? {} : { fix: !db ? "Database unreachable — check DATABASE_URL (use the PUBLIC Postgres URL on Vercel) and DATABASE_SSL=true" : "Set MEROD_MASTER_KEY and REALTIME_SECRET in your environment variables, then redeploy" }) },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
