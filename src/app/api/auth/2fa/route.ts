import { z } from "zod";
import QRCode from "qrcode";
import { requireUser, verifyStepUp } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { decrypt, encrypt } from "@/server/crypto";
import { newTotpSecret, otpauthUrl, verifyTotp } from "@/server/totp";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";

/** GET: start enrollment (returns QR). POST {code}: confirm enrollment. DELETE {code}: disable (requires a valid code). */
export const GET = route(async () => {
  const u = await requireUser();
  if (u.totpEnabled) return ok({ enabled: true });
  const secret = newTotpSecret();
  await q("UPDATE users SET totp_secret_enc=$2 WHERE id=$1", [u.id, encrypt(secret, `totp:${u.id}`)]);
  const url = otpauthUrl(secret, u.email);
  return ok({ enabled: false, secret, qr: await QRCode.toDataURL(url, { margin: 1, width: 200 }) });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const { code } = await parse(req, z.object({ code: z.string() }));
  const r = await one<{ totp_secret_enc: string | null }>("SELECT totp_secret_enc FROM users WHERE id=$1", [u.id]);
  if (!r?.totp_secret_enc || !verifyTotp(decrypt(r.totp_secret_enc, `totp:${u.id}`), code)) throw new HttpError(400, "Invalid code — check your authenticator app's clock");
  await q("UPDATE users SET totp_enabled=true WHERE id=$1", [u.id]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "auth.2fa_enabled" });
  return ok({ enabled: true });
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const { code } = await parse(req, z.object({ code: z.string() }));
  if (!(await verifyStepUp(u.id, code))) throw new HttpError(400, "Invalid code");
  await q("UPDATE users SET totp_enabled=false, totp_secret_enc=NULL WHERE id=$1", [u.id]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "auth.2fa_disabled" });
  return ok({ enabled: false });
});
