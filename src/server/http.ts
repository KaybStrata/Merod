import "@/lib/server-only-shim";
import { NextResponse } from "next/server";
import { ZodError, ZodType } from "zod";
import { HttpError } from "./errors";
import { q, describeDbError } from "./db";
import { env } from "./env";

export const ok = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export async function parse<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new HttpError(400, "Invalid JSON body"); }
  return schema.parse(body);
}

/** Same-origin check for state-changing requests (CSRF defence in addition to SameSite cookies). */
function checkOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, server-to-server) carry no cookies cross-site
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    const o = new URL(origin);
    if (o.host !== host && o.origin !== new URL(env.appUrl).origin) throw new HttpError(403, "Cross-origin request blocked");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "Bad origin");
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;
/** Wrap a route handler with origin checks and uniform error responses. */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      checkOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
      // Malformed client input that reached Postgres (bad UUID / number / negative LIMIT) is a 400, not a 500.
      const pgCode = (e as { code?: string })?.code;
      if (pgCode === "22P02" || pgCode === "2201W" || pgCode === "2201X" || pgCode === "22003") return NextResponse.json({ error: "Invalid identifier or parameter" }, { status: 400 });
      // Database unreachable / misconfigured: say exactly what to fix instead of a bare 500.
      const db = describeDbError(e);
      if (db) {
        console.error(`[merod] database error (${db.code}):`, (e as Error)?.message);
        return NextResponse.json({ error: `Service unavailable — ${db.hint}`, code: db.code }, { status: 503 });
      }
      console.error("[merod] unhandled route error", e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

/** Fixed-window rate limiter stored in Postgres (works without Redis). */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const rows = await q<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`, [key, windowSec]);
  if ((rows[0]?.count ?? 0) > limit) throw new HttpError(429, "Too many requests — slow down");
}
