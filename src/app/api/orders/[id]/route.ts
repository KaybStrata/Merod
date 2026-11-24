import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { approve, cancel, submitSigned } from "@/server/engine/engine";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("signed"), signedTransaction: z.string().max(20000).optional(), txHash: z.string().max(200).optional() }),
]);

export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const b = await parse(req, Body);
  if (b.action === "approve") return ok({ order: await approve(id, u.id) });
  if (b.action === "cancel") { await cancel(id, u.id); return ok({ ok: true }); }
  return ok({ order: await submitSigned(id, u.id, { signedTransaction: b.signedTransaction, txHash: b.txHash }) });
});
