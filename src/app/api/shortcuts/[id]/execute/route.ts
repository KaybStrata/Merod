import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { executeShortcut, previewShortcut } from "@/server/shortcuts/service";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview"), assetId: z.string().uuid().nullable().optional() }),
  z.object({ mode: z.literal("execute"), executionId: z.string().uuid(), confirmed: z.boolean().default(false) }),
]);

/** Two-step execution: preview (engine checks, no side effects) → execute (references that preview). */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  await rateLimit(`shortcut:${u.id}`, 60, 60);
  const b = await parse(req, Body);
  if (b.mode === "preview") return ok(await previewShortcut(u.id, id, b.assetId ?? null));
  return ok(await executeShortcut(u.id, id, b.executionId, b.confirmed));
});

/** Vercel: allow slow AI / backtest / provider calls. */
export const maxDuration = 60;
