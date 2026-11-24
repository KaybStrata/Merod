import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { testUserKeys } from "@/server/providers/integrations";
import { userHasCredentials } from "@/server/providers/credentials";

/** Tests ONLY the user's own keys against the provider (platform keys are never used here). */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`mykeys-test:${u.id}`, 10, 60);
  const b = await parse(req, z.object({ providerId: z.string().max(60), environment: z.enum(["sandbox", "production"]) }));
  if (!(await userHasCredentials(u.id, b.providerId, b.environment))) throw new HttpError(400, "Save your keys first");
  try { return ok({ result: await testUserKeys(u.id, b.providerId, b.environment) }); }
  catch (e: any) { throw new HttpError(400, e.message); }
});

/** Vercel: provider connection probes can take a while. */
export const maxDuration = 30;
