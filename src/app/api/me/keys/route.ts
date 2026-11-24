import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { findProvider } from "@/server/providers/custom";
import { listUserCredentials, saveUserKeys, userKeyProviders } from "@/server/providers/integrations";
import { deleteUserCredentials } from "@/server/providers/credentials";
import { audit } from "@/server/audit";
import { DIRECTORY_INFO } from "@/server/providers/directory";
import { adapterById } from "@/server/providers/execution";

/** The user's own pasted API keys ("bring your own key"). Values are never returned — only masked last4 + status. */
export const GET = route(async () => {
  const u = await requireUser();
  const providers = (await userKeyProviders()).map((p) => ({
    id: p.id, name: p.name, category: p.category, description: p.description, docsUrl: p.docsUrl, signupUrl: p.signupUrl,
    userKeys: p.userKeys, environments: p.environments, directory: DIRECTORY_INFO[p.id] ?? null, routing: !!adapterById(p.id), credentials: p.credentials.map((c) => ({ name: c.name, label: c.label, required: c.required, secret: c.secret, help: c.help })),
  }));
  return ok({ providers, keys: await listUserCredentials(u.id) });
});

const Env = z.enum(["sandbox", "production"]);
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`mykeys:${u.id}`, 30, 300);
  const b = await parse(req, z.object({ providerId: z.string().max(60), environment: Env, values: z.record(z.string(), z.string().max(8000)) }));
  const def = await findProvider(b.providerId);
  if (!def?.userKeys) throw new HttpError(400, "This provider does not accept personal keys");
  if (!def.environments.includes(b.environment)) throw new HttpError(400, `${def.name} has no ${b.environment} environment`);
  if (!Object.values(b.values).some((v) => v.trim())) throw new HttpError(400, "Paste at least one key");
  try { await saveUserKeys(u.id, b.providerId, b.environment, b.values); }
  catch (e: any) { throw new HttpError(400, e.message); }
  return ok({ ok: true });
});

export const DELETE = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ providerId: z.string().max(60), environment: Env }));
  await deleteUserCredentials(u.id, b.providerId, b.environment);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "user_keys.removed", target: `${b.providerId}:${b.environment}` });
  return ok({ ok: true });
});
