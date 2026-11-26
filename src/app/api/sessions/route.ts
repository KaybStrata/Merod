import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createSession, listSessions, actAll } from "@/server/lab/sessions";

/** Merod Multi sessions. GET: list. POST: create a DRAFT session, or {action:"start_all"|"pause_all"}. */
export const GET = route(async (req) => {
  const u = await requireUser();
  return ok({ sessions: await listSessions(u.id, new URL(req.url).searchParams.get("archived") === "1") });
});

const Body = z.union([
  z.object({ title: z.string().min(1).max(80), strategyVersionId: z.string().uuid(), allocationUsd: z.number().positive().max(100_000_000), accountId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.enum(["start_all", "pause_all"]) }),
]);
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`sessions:${u.id}`, 30, 60);
  const b = await parse(req, Body);
  if ("action" in b) return ok({ results: await actAll(u.id, b.action === "start_all" ? "start" : "pause") });
  return ok({ session: await createSession(u.id, b) });
});
