import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one } from "@/server/db";
import { AI_MODELS, aiAvailable, userHasAIKey } from "@/server/ai/llm";

/** Model catalog + which AI providers are actually connected (tested + enabled in the Integration Center). */
export const GET = route(async () => {
  const u = await requireUser();
  const [anthropic, openai, ownA, ownO] = await Promise.all([aiAvailable("anthropic", u.id), aiAvailable("openai", u.id), userHasAIKey("anthropic", u.id), userHasAIKey("openai", u.id)]);
  const pref = await one<any>("SELECT ai_provider, ai_model FROM user_profiles WHERE user_id=$1", [u.id]);
  const perms = await one<any>("SELECT mode, auto_max_order_usd, auto_daily_cap_usd, allow_ai_prompts FROM trading_permissions WHERE user_id=$1", [u.id]);
  return ok({
    providers: [
      { id: "anthropic", name: "Claude (Anthropic)", connected: anthropic, ownKey: ownA, models: AI_MODELS.anthropic },
      { id: "openai", name: "ChatGPT (OpenAI)", connected: openai, ownKey: ownO, models: AI_MODELS.openai },
      { id: "merod", name: "Merod rule parser", connected: true, models: AI_MODELS.merod },
    ],
    preference: { provider: pref?.ai_provider ?? "anthropic", model: pref?.ai_model ?? "claude-opus-5-5" },
    permissions: perms,
  });
});

/** Vercel: allow slow AI / backtest / provider calls. */
export const maxDuration = 60;
