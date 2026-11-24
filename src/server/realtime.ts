import "@/lib/server-only-shim";
import { Redis } from "ioredis";
import { env } from "./env";

/**
 * Realtime fan-out bus. Publishers (API routes, workers, engine) publish to Redis;
 * the WebSocket gateway (worker/realtime.ts) relays to subscribed browsers.
 * Channels: user:<id> (private), market (public prices), launches, social, admin.
 */
const g = globalThis as unknown as { __merodPub?: Redis | null };
function pub(): Redis | null {
  if (g.__merodPub !== undefined) return g.__merodPub;
  if (!env.redisUrl) return (g.__merodPub = null);
  const r = new Redis(env.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: false });
  r.on("error", () => {});
  return (g.__merodPub = r);
}

export async function publish(channel: string, type: string, payload: unknown) {
  const r = pub();
  if (!r || r.status !== "ready") return;
  await r.publish(`merod:${channel}`, JSON.stringify({ channel, type, payload, ts: Date.now() })).catch(() => {});
}
