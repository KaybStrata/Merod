import "@/lib/server-only-shim";
import { cookies, headers } from "next/headers";
import { one, q, tx } from "./db";
import { env, isProduction } from "./env";
import { hashPassword, randomToken, sha256, verifyPassword, decrypt, safeEqual } from "./crypto";
import { verifyTotp } from "./totp";
import { audit } from "./audit";

export const SESSION_COOKIE = "merod_session";
export type Role = "user" | "admin" | "compliance" | "support" | "super_admin";

/**
 * Super-admin bootstrap. Emails listed in SUPER_ADMIN_EMAILS are RESERVED: signing up with one requires
 * SUPER_ADMIN_SETUP_CODE (a server secret), because email ownership isn't verified at sign-up.
 * Without the code, nobody can register a reserved email.
 */
export function isReservedSuperAdminEmail(email: string) {
  return (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}
export function checkSuperAdminSetupCode(code: string | undefined) {
  const expected = process.env.SUPER_ADMIN_SETUP_CODE ?? "";
  if (expected.length < 12 || !code) return false;
  return safeEqual(sha256(code), sha256(expected));
}
export interface SessionUser {
  id: string; email: string; role: Role; status: string; totpEnabled: boolean; mfaPassed: boolean;
  handle: string; displayName: string; tradingMode: "paper" | "live"; country: string | null;
  sessionId: string;
}

import { HttpError } from "./errors";
export { HttpError };

export async function createUser(email: string, password: string, handle: string, displayName: string, role: Role = "user") {
  if (password.length < 10) throw new HttpError(400, "Password must be at least 10 characters");
  if (!/^[a-z0-9_]{3,20}$/i.test(handle)) throw new HttpError(400, "Handle must be 3–20 letters, numbers or underscores");
  return tx(async (c) => {
    const exists = await one("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email], c);
    if (exists) throw new HttpError(409, "An account with that email already exists");
    const h = await one("SELECT 1 FROM user_profiles WHERE lower(handle)=lower($1)", [handle], c);
    if (h) throw new HttpError(409, "That handle is taken");
    const u = await one<{ id: string }>(
      "INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id", [email.trim(), hashPassword(password), role], c);
    const id = u!.id;
    await c.query("INSERT INTO user_profiles (user_id, handle, display_name) VALUES ($1,$2,$3)", [id, handle, displayName]);
    await c.query("INSERT INTO risk_settings (user_id) VALUES ($1)", [id]);
    await c.query("INSERT INTO trading_permissions (user_id) VALUES ($1)", [id]);
    // Every user gets a paper account with virtual funds. Clearly marked as simulated.
    await c.query(
      `INSERT INTO trading_accounts (user_id, kind, provider_id, label, cash_balance, metadata)
       VALUES ($1,'paper','paper','Paper Trading (Simulated)',100000,'{"starting_balance":100000}')`, [id]);
    await c.query("INSERT INTO watchlists (user_id, name) VALUES ($1,'My Watchlist')", [id]);
    await audit({ actorType: "user", actorId: id, userId: id, action: "user.register", data: { email } }, c);
    return id;
  });
}

async function clientMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown", ua: h.get("user-agent") ?? "" };
}

export async function login(email: string, password: string) {
  const u = await one<{ id: string; password_hash: string; status: string; totp_enabled: boolean }>(
    "SELECT id, password_hash, status, totp_enabled FROM users WHERE lower(email)=lower($1)", [email]);
  // Constant-ish time: still run a hash on miss.
  const ok = u ? verifyPassword(password, u.password_hash) : (verifyPassword(password, "scrypt$AAAA$AAAA"), false);
  const meta = await clientMeta();
  if (!u || !ok) {
    await audit({ actorType: "system", action: "auth.login_failed", data: { email }, ip: meta.ip });
    throw new HttpError(401, "Invalid email or password");
  }
  if (u.status !== "active") throw new HttpError(403, "Account is not active");
  const token = randomToken();
  const expires = new Date(Date.now() + env.sessionDays * 86400_000);
  await q("INSERT INTO sessions (user_id, token_hash, mfa_passed, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [u.id, sha256(token), !u.totp_enabled, meta.ip, meta.ua, expires]);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", expires });
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "auth.login", ip: meta.ip });
  return { mfaRequired: u.totp_enabled };
}

export async function logout() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await q("DELETE FROM sessions WHERE token_hash=$1", [sha256(t)]);
  jar.delete(SESSION_COOKIE);
}

/** Returns the session user, including sessions still awaiting MFA (check mfaPassed). */
export async function getSession(): Promise<SessionUser | null> {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const r = await one<any>(
    `SELECT s.id AS session_id, s.mfa_passed, u.id, u.email, u.role, u.status, u.totp_enabled, u.trading_mode, u.country,
            p.handle, p.display_name
       FROM sessions s JOIN users u ON u.id=s.user_id JOIN user_profiles p ON p.user_id=u.id
      WHERE s.token_hash=$1 AND s.expires_at > now()`, [sha256(t)]);
  if (!r || r.status !== "active") return null;
  return {
    id: r.id, email: r.email, role: r.role, status: r.status, totpEnabled: r.totp_enabled, mfaPassed: r.mfa_passed,
    handle: r.handle, displayName: r.display_name, tradingMode: r.trading_mode, country: r.country, sessionId: r.session_id,
  };
}

export async function getUser(): Promise<SessionUser | null> {
  const s = await getSession();
  return s && s.mfaPassed ? s : null;
}
export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Sign in required");
  if (!s.mfaPassed) throw new HttpError(401, "Two-factor verification required", "mfa_required");
  return s;
}
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  // super_admin can do everything an admin can.
  const ok = roles.includes(u.role) || (u.role === "super_admin" && roles.includes("admin"));
  if (!ok) throw new HttpError(403, "Insufficient permissions");
  return u;
}
export const requireAdmin = () => requireRole("admin");
export const requireSuperAdmin = () => requireRole("super_admin");
export const isAdminRole = (role: string) => role === "admin" || role === "super_admin";

export async function completeMfa(code: string) {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Sign in required");
  const r = await one<{ totp_secret_enc: string | null }>("SELECT totp_secret_enc FROM users WHERE id=$1", [s.id]);
  if (!r?.totp_secret_enc) throw new HttpError(400, "2FA not configured");
  if (!verifyTotp(decrypt(r.totp_secret_enc, `totp:${s.id}`), code)) {
    await audit({ actorType: "user", actorId: s.id, userId: s.id, action: "auth.mfa_failed" });
    throw new HttpError(401, "Invalid code");
  }
  await q("UPDATE sessions SET mfa_passed=true WHERE id=$1", [s.sessionId]);
  await audit({ actorType: "user", actorId: s.id, userId: s.id, action: "auth.mfa_passed" });
}

/** Re-verify a TOTP code for sensitive actions (withdrawals, live trading, permission changes). */
export async function verifyStepUp(userId: string, code: string | undefined): Promise<boolean> {
  const r = await one<{ totp_secret_enc: string | null; totp_enabled: boolean }>("SELECT totp_secret_enc, totp_enabled FROM users WHERE id=$1", [userId]);
  if (!r?.totp_enabled || !r.totp_secret_enc) return false;
  return !!code && verifyTotp(decrypt(r.totp_secret_enc, `totp:${userId}`), code);
}
