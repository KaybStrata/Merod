import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { deleteMessage } from "@/server/chat/service";

type Ctx = { params: Promise<{ id: string }> };
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  if (!/^\d+$/.test(id)) throw new HttpError(400, "Bad message id");
  await deleteMessage(u, Number(id));
  return ok({ ok: true });
});
