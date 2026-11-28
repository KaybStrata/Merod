import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { saveMap, deleteMap } from "@/server/map";

type Ctx = { params: Promise<{ id: string }> };
const Node = z.object({
  id: z.string().max(80), type: z.enum(["bot", "agent", "prompt", "skill", "point", "method", "auton", "auto"]),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: z.object({ refId: z.string().uuid().optional(), label: z.string().max(120).optional(), text: z.string().max(4000).optional(), color: z.string().max(20).optional(), note: z.string().max(500).optional() }),
});
const Edge = z.object({ id: z.string().max(200), source: z.string().max(80), target: z.string().max(80), label: z.string().max(80).optional() });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const b = await parse(req, z.object({ name: z.string().min(1).max(80).optional(), nodes: z.array(Node).max(500).optional(), edges: z.array(Edge).max(2000).optional(), viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional() }));
  return ok(await saveMap(u.id, id, b));
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  await deleteMap(u.id, id);
  return ok({ ok: true });
});
