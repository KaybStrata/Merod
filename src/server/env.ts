/** Centralised server-only configuration. Never import this from client components. */
import "@/lib/server-only-shim";

function str(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

/** Running on a real host (Vercel sets VERCEL=1; Railway sets RAILWAY_ENVIRONMENT). Dev fallbacks are refused there. */
export const onHostedPlatform = process.env.VERCEL === "1" || !!process.env.RAILWAY_ENVIRONMENT;
/** True during `next build` — runtime-only checks must not run while compiling. */
const building = process.env.NEXT_PHASE === "phase-production-build";

const deployEnv = (str("MEROD_ENV") ?? (process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "sandbox" : "dev")) as "dev" | "sandbox" | "production";

function databaseUrl(): string {
  const v = str("DATABASE_URL");
  if (v) return v;
  if (onHostedPlatform && !building) {
    console.error("[merod] DATABASE_URL is not set. Add it in your hosting provider's environment variables (Vercel → Settings → Environment Variables).");
  }
  return "postgres://merod:merod@localhost:5432/merod";
}

export const env = {
  nodeEnv: str("NODE_ENV", "development")!,
  /** dev | sandbox | production. Defaults from VERCEL_ENV on Vercel so production can't silently run in dev mode. */
  deployEnv,
  databaseUrl: databaseUrl(),
  redisUrl: str("REDIS_URL"),
  /** 32-byte key, base64 or hex. Encrypts provider secrets + TOTP seeds at rest. */
  masterKey: str("MEROD_MASTER_KEY"),
  appUrl: str("APP_URL") ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  realtimeUrl: str("NEXT_PUBLIC_REALTIME_URL", "ws://localhost:4001")!,
  realtimePort: Number(str("REALTIME_PORT", "4001")),
  sessionDays: Number(str("SESSION_DAYS", "14")),
};

export const isProduction = env.deployEnv === "production";
/** Insecure development fallbacks (dev encryption key, localhost DB) are allowed only on a local machine. */
export const allowDevFallbacks = !isProduction && !onHostedPlatform;
