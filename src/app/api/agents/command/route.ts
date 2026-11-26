import { z } from "zod";
import { requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { ok, parse, rateLimit, route } from "@/server/http";
import { agentAction, postMessage, updateAgent } from "@/server/agents/service";
import { planFleet } from "@/server/agents/fleets";

/**
 * Scoped prompt (spec §03 Command scope): global, selected agents, one fleet or its supervisor.
 * "create/run … agents" → a fleet draft to review; "pause/resume/stop" → lifecycle on the scope;
 * anything else → a versioned instruction added to each targeted agent (live prompt editing) and posted to its room.
 * A prompt can never change autonomy, capital, limits or switch to live.
 */
const Body = z.object({ text: z.string().min(1).max(2000), scope: z.enum(["all", "agents", "fleet", "supervisor"]), ids: z.array(z.string().uuid()).max(50).optional(), fleetId: z.string().uuid().optional() });
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`agent-cmd:${u.id}`, 30, 60);
  const b = await parse(req, Body);
  const t = b.text.trim(), lower = t.toLowerCase();
  if (/\b(create|make|build|spin up|launch|set up|run)\b[^.]*\bagents?\b|\bin parallel\b|\bfleet\b/.test(lower) && !/^(pause|resume|stop)/.test(lower))
    return ok({ kind: "draft", draft: await planFleet(t) });
  const targets = await q<any>(
    `SELECT id, name, status, fleet_id, instructions FROM agents WHERE user_id=$1 AND status <> 'archived'
       AND ($2 = 'all' OR ($2 = 'agents' AND id = ANY($3::uuid[])) OR ($2 = 'fleet' AND fleet_id=$4) OR ($2 = 'supervisor' AND role='supervisor' AND ($4::uuid IS NULL OR fleet_id=$4)))`,
    [u.id, b.scope, b.ids ?? [], b.fleetId ?? null]);
  if (!targets.length) return ok({ kind: "none", message: "No agents in that scope" });
  const verb = lower.match(/^(pause|resume|stop|start)\b/)?.[1] as "pause" | "resume" | "stop" | "start" | undefined;
  if (verb) {
    const results = [];
    for (const a of targets) { try { await agentAction(u.id, a.id, verb, { reason: `Prompt: ${t.slice(0, 120)}` }); results.push({ name: a.name, ok: true }); } catch (e: any) { results.push({ name: a.name, ok: false, error: e.message }); } }
    return ok({ kind: "actions", action: verb, results });
  }
  if (/\b(live|real money|autonomy|raise (the )?(limit|capital|budget)|increase (my )?(limit|capital|budget))\b/.test(lower))
    return ok({ kind: "refused", message: "Prompts can't change autonomy, capital, limits or switch to live. Use the agent's settings (Capital & Risk) instead." });
  for (const a of targets) {
    await updateAgent(u.id, a.id, { instructions: `${a.instructions}\n[You, ${new Date().toISOString().slice(0, 16).replace("T", " ")}] ${t}`.slice(-4000), note: `Instruction: ${t.slice(0, 120)}` });
    await postMessage(u.id, { room: a.fleet_id ? `fleet:${a.fleet_id}` : "general", fleetId: a.fleet_id, senderLabel: `@${u.handle} (you)`, recipients: [a.name], msgType: "instruction", body: t });
  }
  return ok({ kind: "instruction", targets: targets.map((a) => a.name) });
});
