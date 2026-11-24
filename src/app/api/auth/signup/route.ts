import { z } from "zod";
import { createUser, login, isReservedSuperAdminEmail, checkSuperAdminSetupCode } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";
import { headers } from "next/headers";

const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  handle: z.string().min(3).max(20),
  displayName: z.string().min(1).max(60),
  acceptTerms: z.literal(true, { message: "You must accept the terms and risk disclosure" }),
  setupCode: z.string().max(200).optional(),
});

export const POST = route(async (req) => {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? "local";
  await rateLimit(`signup:${ip}`, 5, 3600);
  const b = await parse(req, Body);
  let role: "user" | "super_admin" = "user";
  if (isReservedSuperAdminEmail(b.email)) {
    // Reserved owner email: only the holder of the server-side setup code can claim it.
    if (!checkSuperAdminSetupCode(b.setupCode)) {
      await rateLimit(`superadmin-claim:${ip}`, 5, 3600);
      await audit({ actorType: "system", action: "auth.super_admin_claim_denied", data: { email: b.email }, ip });
      throw new HttpError(403, b.setupCode ? "Invalid setup code" : "This email is reserved. Enter the owner setup code to continue.", "setup_code_required");
    }
    if (b.password.length < 12) throw new HttpError(400, "Super admin password must be at least 12 characters");
    role = "super_admin";
  }
  const id = await createUser(b.email, b.password, b.handle, b.displayName, role);
  if (role === "super_admin") await audit({ actorType: "user", actorId: id, userId: id, action: "auth.super_admin_claimed", ip });
  await login(b.email, b.password);
  return ok({ ok: true, role });
});
