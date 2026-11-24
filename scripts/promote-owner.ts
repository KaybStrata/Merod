/**
 * Owner recovery: make a reserved owner email the super admin.
 * Use if someone registered the owner email before SUPER_ADMIN_EMAILS was configured.
 * Requires direct database access (only the owner has it). Resets the password, removes 2FA
 * and revokes all sessions, so whoever registered the email first is locked out.
 *
 *   DATABASE_URL=<postgres url> SUPER_ADMIN_EMAILS=<owner email> OWNER_NEW_PASSWORD=<new password> npm run admin:promote-owner
 */
import { pool, one, q } from "@/server/db";
import { hashPassword } from "@/server/crypto";
import { audit } from "@/server/audit";

const email = (process.env.SUPER_ADMIN_EMAILS ?? "").split(",")[0]?.trim();
const pw = process.env.OWNER_NEW_PASSWORD ?? "";
if (!email) { console.error("Set SUPER_ADMIN_EMAILS to the owner email"); process.exit(1); }
if (pw.length < 12) { console.error("Set OWNER_NEW_PASSWORD (at least 12 characters)"); process.exit(1); }
const u = await one<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1)", [email]);
if (!u) { console.log(`No account for ${email} yet — just sign up at /signup with the setup code.`); await pool.end(); process.exit(0); }
await q("UPDATE users SET role='super_admin', status='active', password_hash=$2, totp_enabled=false, totp_secret_enc=NULL, updated_at=now() WHERE id=$1", [u.id, hashPassword(pw)]);
await q("DELETE FROM sessions WHERE user_id=$1", [u.id]);
await q("UPDATE trading_bots SET status='halted' WHERE user_id=$1 AND status IN ('running','paused')", [u.id]);
await audit({ actorType: "system", actorId: "promote-owner-script", userId: u.id, action: "auth.super_admin_promoted_by_script" });
console.log(`✔ ${email} is now the super admin. Sign in with the new password, then enable 2FA (Settings → Security).`);
await pool.end();
