import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { findProvider } from "@/server/providers/custom";
import { removeCredential, saveCredentials, saveSettings, setApproval, setEnabled, testIntegration } from "@/server/providers/integrations";

type Ctx = { params: Promise<{ provider: string }> };
const Env = z.enum(["sandbox", "production"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_credentials"), environment: Env, values: z.record(z.string(), z.string().max(8000)) }),
  z.object({ action: z.literal("remove_credential"), environment: Env, name: z.string().max(100) }),
  z.object({ action: z.literal("save_settings"), environment: Env, settings: z.record(z.string(), z.string().max(2000)) }),
  z.object({ action: z.literal("test"), environment: Env }),
  z.object({ action: z.literal("enable"), environment: Env }),
  z.object({ action: z.literal("disable"), environment: Env }),
  z.object({ action: z.literal("approval"), approval: z.enum(["not_requested", "requested", "approved", "denied"]), reference: z.string().max(200).optional() }),
]);

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { provider } = await params;
  const def = await findProvider(provider);
  if (!def) throw new HttpError(404, "Unknown provider");
  const b = await parse(req, Body);
  if ("environment" in b && !def.environments.includes(b.environment)) throw new HttpError(400, `${def.name} has no ${b.environment} environment`);
  try {
    switch (b.action) {
      case "save_credentials": await saveCredentials(admin.id, provider, b.environment, b.values); return ok({ ok: true });
      case "remove_credential": await removeCredential(admin.id, provider, b.environment, b.name); return ok({ ok: true });
      case "save_settings": await saveSettings(admin.id, provider, b.environment, b.settings); return ok({ ok: true });
      case "test": {
        await rateLimit(`test:${provider}:${b.environment}`, 12, 60);
        const r = await testIntegration(admin.id, provider, b.environment);
        return ok({ result: r });
      }
      case "enable": await setEnabled(admin.id, provider, b.environment, true); return ok({ ok: true });
      case "disable": await setEnabled(admin.id, provider, b.environment, false); return ok({ ok: true });
      case "approval":
        await setApproval(admin.id, provider, b.approval, b.reference?.trim() || (b.approval === "approved" ? `Approved by ${admin.role === "super_admin" ? "platform owner" : "admin"} ${new Date().toISOString().slice(0, 10)}` : undefined));
        return ok({ ok: true });
    }
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    // Service-layer validation errors (unknown credential, bad URL) → 400 without leaking internals.
    throw new HttpError(400, e?.message ?? "Request failed");
  }
});

/** Vercel: provider connection probes can take a while. */
export const maxDuration = 30;
