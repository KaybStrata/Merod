import { NextResponse } from "next/server";
import { pool, describeDbError } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + configuration health (never returns secret values). Used by Railway/Vercel/uptime monitors. */
export async function GET() {
  let db = false, migrations = 0, worker: string | null = null, dbIssue: { code: string; hint: string } | null = null;
  try {
    await pool.query("SELECT 1");
    db = true;
    migrations = (await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0]?.n ?? 0;
    worker = (await pool.query("SELECT max(last_seen_at) AS t FROM worker_heartbeats")).rows[0]?.t ?? null;
  } catch (e) {
    dbIssue = describeDbError(e) ?? { code: "db_error", hint: `Database error: ${String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "[url]").slice(0, 160)}` };
    if (db && dbIssue.code !== "db_not_migrated") dbIssue = { code: "db_not_migrated", hint: describeDbError({ code: "42P01" })!.hint };
  }
  const prod = process.env.MEROD_ENV === "production" || process.env.VERCEL === "1" || !!process.env.RAILWAY_ENVIRONMENT;
  const config = {
    masterKey: !!process.env.MEROD_MASTER_KEY,
    realtimeSecret: !!process.env.REALTIME_SECRET,
    realtimeUrl: !!process.env.NEXT_PUBLIC_REALTIME_URL,
    redis: !!process.env.REDIS_URL,
  };
  const workerFresh = worker ? Date.now() - new Date(worker).getTime() < 60_000 : false;
  const ok = db && !dbIssue && (!prod || (config.masterKey && config.realtimeSecret));
  const fix = dbIssue ? dbIssue.hint : !config.masterKey || !config.realtimeSecret ? "Set MEROD_MASTER_KEY and REALTIME_SECRET in your environment variables, then redeploy" : null;
  return NextResponse.json(
    { ok, env: process.env.MEROD_ENV ?? process.env.VERCEL_ENV ?? "dev", db: db && !dbIssue, dbIssue: dbIssue?.code ?? null, migrations, workerLastSeen: worker, workerHealthy: workerFresh, config,
      ...(ok ? {} : { fix }) },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
