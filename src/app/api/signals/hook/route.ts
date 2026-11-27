import { ok, rateLimit, route } from "@/server/http";
import { handleSignal } from "@/server/signals";
import { sha256 } from "@/server/crypto";

/**
 * Public webhook for outside trading bots (Freqtrade, TradingView, Hummingbot/Jesse/OctoBot scripts, curl).
 * Auth: the signal key in ?key=msk_…, the X-Merod-Key header, Authorization: Bearer msk_…, or a "key" field in the JSON body.
 * Body: JSON ({ "action": "buy", "pair": "BTC/USDT", "amount_usd": 50 }) or plain text ("buy BTC 50").
 */
export const POST = route(async (req) => {
  const url = new URL(req.url);
  const text = (await req.text()).slice(0, 64_000);
  let body: unknown = text;
  try { if (/^\s*[{[]/.test(text)) body = JSON.parse(text); } catch { /* keep as text */ }
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const bodyKey = body && typeof body === "object" ? ((body as any).key ?? (body as any).passphrase) : undefined;
  const key = String(url.searchParams.get("key") ?? req.headers.get("x-merod-key") ?? auth ?? bodyKey ?? "").trim();
  if (body && typeof body === "object") { delete (body as any).key; delete (body as any).passphrase; }
  await rateLimit(`signal:${sha256(key || "none").slice(0, 16)}`, 120, 60);
  const r = await handleSignal(key, body);
  return ok({ ok: !["failed", "rejected"].includes(r.status), ...r });
});

/** GET with the key: a quick connection test from a browser or bot ("is my URL right?"). Places nothing. */
export const GET = route(async (req) => {
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-merod-key") ?? "";
  const { one } = await import("@/server/db");
  const k = key.startsWith("msk_") ? await one<any>("SELECT name, enabled FROM signal_keys WHERE key_hash=$1", [sha256(key)]) : null;
  if (!k) return ok({ ok: false, error: "Unknown or missing signal key" }, { status: 401 });
  return ok({ ok: true, bot: k.name, enabled: k.enabled, send: 'POST JSON like {"action":"buy","pair":"BTC/USDT","amount_usd":50} or text "buy BTC 50"' });
});
