import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { emergencyStop, pauseAllBots, resumeAllBots } from "@/server/bots/runner";

/** stop = halt all bots + cancel open orders + engage user trading halt. pause_all / resume_all are softer. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const { action } = await parse(req, z.object({ action: z.enum(["stop", "pause_all", "resume_all"]) }));
  if (action === "stop") return ok(await emergencyStop(u.id));
  if (action === "pause_all") return ok({ paused: await pauseAllBots(u.id) });
  return ok({ resumed: await resumeAllBots(u.id) });
});
