import { z } from "zod";
import { requireUser, isReservedSuperAdminEmail, verifyStepUp } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { hashPassword, verifyPassword } from "@/server/crypto";
import { audit } from "@/server/audit";

/**
 * Change your own email, password or username (@handle). Email and password changes need your current password,
 * plus your 2FA code when 2FA is on. Changing email or password signs out every other device.
 * (Display name, bio and avatar are saved through Settings → Account.)
 */
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), newEmail: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200), code: z.string().max(10).optional() }),
  z.object({ kind: z.literal("password"), currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200), code: z.string().max(10).optional() }),
  z.object({ kind: z.literal("handle"), handle: z.string().trim().min(3).max(20) }),
]);

async function checkSecrets(userId: string, password: string, code?: string) {
  const r = await one<{ password_hash: string; totp_enabled: boolean }>("SELECT password_hash, totp_enabled FROM users WHERE id=$1", [userId]);
  if (!r || !verifyPassword(password, r.password_hash)) throw new HttpError(403, "Your current password is incorrect");
  if (r.totp_enabled && !(await verifyStepUp(userId, code))) throw new HttpError(403, "Enter the 6-digit code from your authenticator app");
}

export const PATCH = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`account-change:${u.id}`, 10, 3600);
  const b = await parse(req, Body);

  if (b.kind === "email") {
    await checkSecrets(u.id, b.password, b.code);
    if (b.newEmail === u.email.toLowerCase()) throw new HttpError(400, "That's already your email");
    if (isReservedSuperAdminEmail(b.newEmail) && u.role !== "super_admin") throw new HttpError(403, "That email is reserved");
    if (await one("SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2", [b.newEmail, u.id])) throw new HttpError(409, "Another account already uses that email");
    await q("UPDATE users SET email=$2, updated_at=now() WHERE id=$1", [u.id, b.newEmail]);
    await q("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [u.id, u.sessionId]);
    await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "account.email_changed", data: { from: u.email, to: b.newEmail } });
    return ok({ ok: true, email: b.newEmail });
  }

  if (b.kind === "password") {
    await checkSecrets(u.id, b.currentPassword, b.code);
    if (u.role === "super_admin" && b.newPassword.length < 12) throw new HttpError(400, "The owner password must be at least 12 characters");
    if (b.newPassword === b.currentPassword) throw new HttpError(400, "Choose a different password");
    await q("UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1", [u.id, hashPassword(b.newPassword)]);
    await q("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [u.id, u.sessionId]);
    await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "account.password_changed" });
    return ok({ ok: true });
  }

  // Username / @handle
  if (!/^[a-z0-9_]{3,20}$/i.test(b.handle)) throw new HttpError(400, "Usernames are 3–20 letters, numbers or underscores");
  await rateLimit(`handle-change:${u.id}`, 5, 86_400);
  if (b.handle.toLowerCase() === u.handle.toLowerCase() && b.handle === u.handle) throw new HttpError(400, "That's already your username");
  if (await one("SELECT 1 FROM user_profiles WHERE lower(handle)=lower($1) AND user_id<>$2", [b.handle, u.id])) throw new HttpError(409, "That username is taken");
  await q("UPDATE user_profiles SET handle=$2 WHERE user_id=$1", [u.id, b.handle]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "account.handle_changed", data: { from: u.handle, to: b.handle } });
  return ok({ ok: true, handle: b.handle });
});
