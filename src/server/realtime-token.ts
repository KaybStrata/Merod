import "@/lib/server-only-shim";
import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto";
import { allowDevFallbacks } from "./env";

/** Short-lived signed token the browser presents to the WebSocket gateway. */
const secret = () => {
  const s = process.env.REALTIME_SECRET ?? process.env.MEROD_MASTER_KEY;
  if (!s) { if (!allowDevFallbacks) throw new Error("REALTIME_SECRET is required on hosted deployments"); return "merod-dev-realtime-secret"; }
  return s;
};
export function signRealtimeToken(userId: string, role: string, ttlSec = 300) {
  const body = Buffer.from(JSON.stringify({ u: userId, r: role, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function verifyRealtimeToken(token: string): { u: string; r: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(createHmac("sha256", secret()).update(body).digest("base64url"), sig)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  return p.exp > Date.now() / 1000 ? p : null;
}
