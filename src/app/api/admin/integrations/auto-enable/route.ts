import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { getFlags } from "@/server/flags";
import { setFlag } from "@/server/admin/service";
import { autoEnableSweep } from "@/server/providers/integrations";

/** Auto-enable switch: turns on (and tests) every integration that has its keys saved, now and whenever keys are added. */
export const GET = route(async () => {
  await requireAdmin();
  return ok({ enabled: !!(await getFlags(true)).auto_enable_integrations });
});

export const POST = route(async (req) => {
  const admin = await requireAdmin();
  await rateLimit(`auto-enable:${admin.id}`, 10, 60);
  const b = await parse(req, z.object({ enabled: z.boolean() }));
  await setFlag(admin.id, "auto_enable_integrations", b.enabled);
  // Run the first sweep in the background (provider tests can take a while); the worker repeats it every 5 minutes.
  if (b.enabled) void autoEnableSweep(admin.id).catch((e) => console.error("[auto-enable]", e.message));
  return ok({ enabled: b.enabled });
});
