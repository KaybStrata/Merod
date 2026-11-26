import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { newVersion } from "@/server/lab/strategies";

type Ctx = { params: Promise<{ id: string }> };
/** Edit = a new immutable version; running sessions keep the version they were activated with. */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ rules: z.unknown() }));
  return ok({ version: await newVersion(u.id, (await params).id, b.rules) });
});
