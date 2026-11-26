import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { sessionDetail } from "@/server/lab/sessions";

type Ctx = { params: Promise<{ id: string }> };
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return ok(await sessionDetail(u.id, (await params).id));
});
