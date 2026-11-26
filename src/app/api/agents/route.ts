import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { AgentInput, createAgent, listAgents, mergeAgents, handoff, listEvents } from "@/server/agents/service";

/** Merod Agents. GET: list (+ recent events). POST: create an agent, or {action:"merge"|"handoff"}. Owner-scoped. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const [agents, events] = await Promise.all([listAgents(u.id, { fleetId: sp.get("fleet"), archived: sp.get("archived") === "1" }), listEvents(u.id, { limit: 40 })]);
  return ok({ agents, events });
});

const Body = z.union([
  z.object({ action: z.literal("merge"), ids: z.array(z.string().uuid()).min(2).max(6), name: z.string().max(60).optional() }),
  z.object({ action: z.literal("handoff"), from: z.string().uuid(), to: z.string().uuid(), assetId: z.string().uuid(), note: z.string().max(300).optional() }),
  AgentInput.extend({ fleetId: z.string().uuid().nullable().optional() }),
]);
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`agents:${u.id}`, 40, 60);
  const b: any = await parse(req, Body);
  const isOwner = u.role === "super_admin";
  if (b.action === "merge") return ok({ agent: await mergeAgents(u.id, b.ids, b.name, { isOwner }) });
  if (b.action === "handoff") return ok(await handoff(u.id, b.from, b.to, b.assetId, b.note));
  // No cap on how many agents you can run.
  const { fleetId, ...input } = b;
  return ok({ agent: await createAgent(u.id, input, { fleetId, isOwner }) });
});
