import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { actionsFromPrompt } from "@/server/shortcuts/service";

/** Converts a description ("Buy $50 with 10% take profit") into a draft shortcut for the builder. Saves nothing. */
export const POST = route(async (req) => {
  await requireUser();
  const { text } = await parse(req, z.object({ text: z.string().min(2).max(300) }));
  return ok({ draft: await actionsFromPrompt(text) });
});
