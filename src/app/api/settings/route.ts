import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";
import { AI_MODELS, aiAvailable } from "@/server/ai/llm";

export const GET = route(async () => {
  const u = await requireUser();
  const [user, profile, risk, permissions] = await Promise.all([
    one<any>("SELECT email, country, trading_mode, totp_enabled, role, created_at FROM users WHERE id=$1", [u.id]),
    one<any>("SELECT handle, display_name, bio, avatar_color, is_public, share_performance, allow_copy_trading, theme, ai_provider, ai_model, notification_prefs FROM user_profiles WHERE user_id=$1", [u.id]),
    one<any>("SELECT * FROM risk_settings WHERE user_id=$1", [u.id]),
    one<any>("SELECT * FROM trading_permissions WHERE user_id=$1", [u.id]),
  ]);
  const ai = {
    models: AI_MODELS,
    available: { anthropic: await aiAvailable("anthropic"), openai: await aiAvailable("openai"), merod: true },
  };
  return ok({ user, profile, risk, permissions, ai });
});

const Sections = z.discriminatedUnion("section", [
  z.object({ section: z.literal("account"), values: z.object({
    display_name: z.string().trim().min(1).max(60), bio: z.string().max(280).default(""),
    avatar_color: z.string().regex(/^#[0-9a-fA-F]{6}$/), country: z.string().regex(/^[A-Z]{2}$/).nullable().or(z.literal("")).optional(),
  }) }),
  z.object({ section: z.literal("trading"), values: z.object({ trading_mode: z.enum(["paper", "live"]) }) }),
  z.object({ section: z.literal("risk"), values: z.object({
    // 0 = no limit
    max_order_usd: z.number().min(0).max(1e12), max_daily_spend_usd: z.number().min(0).max(1e12),
    max_daily_loss_usd: z.number().min(0).max(1e12), max_slippage_bps: z.number().int().min(1).max(5000),
    min_liquidity_usd: z.number().min(0), max_price_age_sec: z.number().int().min(5).max(3600), block_risky_tokens: z.boolean(), trading_halted: z.boolean(),
  }) }),
  z.object({ section: z.literal("automation"), values: z.object({
    mode: z.enum(["manual", "auto_within_limits", "auto_until_approval"]), auto_max_order_usd: z.number().min(0).max(1e12),
    auto_daily_cap_usd: z.number().min(0).max(1e12), allow_ai_prompts: z.boolean(), allow_bots: z.boolean(), allow_shortcuts: z.boolean(),
    allowed_asset_classes: z.array(z.enum(["stock", "etf", "crypto", "option"])).max(4),
  }) }),
  z.object({ section: z.literal("notifications"), values: z.object({ fills: z.boolean(), bots: z.boolean(), alerts: z.boolean(), social: z.boolean(), email: z.boolean() }) }),
  z.object({ section: z.literal("ai"), values: z.object({ ai_provider: z.enum(["anthropic", "openai", "merod"]), ai_model: z.string().min(1).max(60) }) }),
  z.object({ section: z.literal("privacy"), values: z.object({ is_public: z.boolean(), share_performance: z.boolean(), allow_copy_trading: z.boolean().optional() }) }),
  z.object({ section: z.literal("theme"), values: z.object({ theme: z.enum(["dark", "light"]) }) }),
]);

/**
 * Update one settings section. Only reachable through an authenticated human session (cookie + MFA);
 * AI, bots and shortcuts have no code path to this route, so they can never change their own permissions or limits.
 */
export const PATCH = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, Sections);
  const v: any = b.values;
  switch (b.section) {
    case "account":
      await q("UPDATE user_profiles SET display_name=$2, bio=$3, avatar_color=$4 WHERE user_id=$1", [u.id, v.display_name, v.bio, v.avatar_color]);
      await q("UPDATE users SET country=$2, updated_at=now() WHERE id=$1", [u.id, v.country || null]);
      break;
    case "trading":
      // Live mode requires real-money approval; the platform keeps everyone in paper mode until then.
      if (v.trading_mode === "live") throw new HttpError(403, "Live trading is disabled until brokerage/wallet approvals are complete. Merod stays in paper mode.");
      await q("UPDATE users SET trading_mode='paper', updated_at=now() WHERE id=$1", [u.id]);
      break;
    case "risk":
      await q(`UPDATE risk_settings SET max_order_usd=$2, max_daily_spend_usd=$3, max_daily_loss_usd=$4, max_slippage_bps=$5, min_liquidity_usd=$6,
                 max_price_age_sec=$7, block_risky_tokens=$8, trading_halted=$9, updated_at=now() WHERE user_id=$1`,
        [u.id, v.max_order_usd, v.max_daily_spend_usd, v.max_daily_loss_usd, v.max_slippage_bps, v.min_liquidity_usd, v.max_price_age_sec, v.block_risky_tokens, v.trading_halted]);
      if (!v.trading_halted) await q("UPDATE trading_bots SET status='paused' WHERE user_id=$1 AND status='halted'", [u.id]);
      break;
    case "automation":
      if (v.auto_max_order_usd > v.auto_daily_cap_usd) throw new HttpError(400, "Per-order automation limit can't exceed the daily automation cap");
      await q(`UPDATE trading_permissions SET mode=$2, auto_max_order_usd=$3, auto_daily_cap_usd=$4, allow_ai_prompts=$5, allow_bots=$6, allow_shortcuts=$7,
                 allowed_asset_classes=$8, updated_at=now() WHERE user_id=$1`,
        [u.id, v.mode, v.auto_max_order_usd, v.auto_daily_cap_usd, v.allow_ai_prompts, v.allow_bots, v.allow_shortcuts, v.allowed_asset_classes]);
      if (!v.allow_bots) await q("UPDATE trading_bots SET status='paused' WHERE user_id=$1 AND status='running'", [u.id]);
      break;
    case "notifications":
      await q("UPDATE user_profiles SET notification_prefs=$2 WHERE user_id=$1", [u.id, JSON.stringify(v)]);
      break;
    case "ai": {
      const list = (AI_MODELS as any)[v.ai_provider] as { id: string }[];
      if (!list.some((m) => m.id === v.ai_model)) throw new HttpError(400, "Unknown model for that provider");
      await q("UPDATE user_profiles SET ai_provider=$2, ai_model=$3 WHERE user_id=$1", [u.id, v.ai_provider, v.ai_model]);
      break;
    }
    case "privacy":
      await q("UPDATE user_profiles SET is_public=$2, share_performance=$3, allow_copy_trading=COALESCE($4, allow_copy_trading) WHERE user_id=$1", [u.id, v.is_public, v.share_performance, v.allow_copy_trading ?? null]);
      // Turning copy trading off stops everyone copying you right away.
      if (v.allow_copy_trading === false) await q("UPDATE copy_follows SET status='paused' WHERE leader_user_id=$1 AND status='active'", [u.id]);
      break;
    case "theme":
      await q("UPDATE user_profiles SET theme=$2 WHERE user_id=$1", [u.id, v.theme]);
      break;
  }
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: `settings.${b.section}`, data: v });
  return ok({ ok: true });
});
