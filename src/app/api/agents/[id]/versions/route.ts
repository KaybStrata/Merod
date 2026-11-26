import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { restoreVersion } from "@/server/agents/service";

type Ctx = { params: Promise<{ id: string }> };
/** Restore a previous version (creates a new version; history is immutable). */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ version: z.number().int().min(1) }));
  return ok({ agent: await restoreVersion(u.id, (await params).id, b.version) });
});
