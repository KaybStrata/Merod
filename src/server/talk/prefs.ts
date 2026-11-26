import { z } from "zod";
import { TOGGLEABLE_WIDGETS } from "./widgets";

/** Settings › Interface values (Talk mode). Written only by the authenticated settings route (human session). */
export const TalkPrefs = z.object({
  showSwitch: z.boolean(), digest: z.boolean(), voice: z.boolean(),
  widgets: z.array(z.enum(TOGGLEABLE_WIDGETS)).max(5),
}).strict();
export const InterfaceValues = z.object({ ui_mode_default: z.enum(["classic", "talk", "last"]), talk_prefs: TalkPrefs }).strict();
export type TalkPrefsT = z.infer<typeof TalkPrefs>;
export const DEFAULT_TALK_PREFS: TalkPrefsT = { showSwitch: true, digest: true, voice: false, widgets: ["chart", "plan", "alert", "agents", "portfolio"] };

/** True when Talk mode is switched on for this deployment (NEXT_PUBLIC_MEROD_TALK_MODE=1). Off = the app is unchanged. */
export const talkModeEnabled = () => process.env.NEXT_PUBLIC_MEROD_TALK_MODE === "1";
