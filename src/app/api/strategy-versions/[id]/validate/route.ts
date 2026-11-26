import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { validateVersion } from "@/server/lab/strategies";

type Ctx = { params: Promise<{ id: string }> };
/** Check a version against current assets, prices, permissions and buying power. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return ok(await validateVersion(u.id, (await params).id));
});
