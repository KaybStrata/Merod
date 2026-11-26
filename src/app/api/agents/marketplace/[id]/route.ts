import { requireUser } from "@/server/auth";
import { ok, rateLimit, route } from "@/server/http";
import { installListing } from "@/server/agents/extras";

type Ctx = { params: Promise<{ id: string }> };
/** Install: clones into your workspace as a stopped paper agent (or returns a fleet draft to review). Never starts live. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  await rateLimit(`install:${u.id}`, 20, 60);
  return ok(await installListing(u.id, decodeURIComponent((await params).id), u.role === "super_admin"));
});
