import { requireUser } from "@/server/auth";
import { HttpError } from "@/server/errors";
import { ok, route } from "@/server/http";
import { replayEvent } from "@/server/agents/runner";

type Ctx = { params: Promise<{ id: string }> };
/** Agent Replay: re-run the current rules on a decision's recorded inputs. */
export const POST = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const r = await replayEvent(u.id, Number((await params).id));
  if (!r) throw new HttpError(404, "Event not found");
  return ok(r);
});
