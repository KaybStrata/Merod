import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { DEFAULT_TALK_PREFS, talkModeEnabled } from "@/server/talk/prefs";

/** Talk mode state for the shell: whether the feature flag is on, the default/last mode and the user's Talk preferences. */
export const GET = route(async () => {
  const u = await requireUser();
  const p = await one<any>("SELECT ui_mode_default, ui_last_mode, talk_prefs FROM user_profiles WHERE user_id=$1", [u.id]);
  return ok({
    enabled: talkModeEnabled(),
    uiModeDefault: p?.ui_mode_default ?? "classic",
    uiLastMode: p?.ui_last_mode ?? "classic",
    talkPrefs: { ...DEFAULT_TALK_PREFS, ...(p?.talk_prefs ?? {}) },
  });
});

/** Records which mode the user last switched to (Classic | Talk). Human session only; the AI has no path here. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`talk-mode:${u.id}`, 60, 60);
  const { mode } = await parse(req, z.object({ mode: z.enum(["classic", "talk"]) }));
  await q("UPDATE user_profiles SET ui_last_mode=$2 WHERE user_id=$1", [u.id, mode]);
  return ok({ mode });
});
