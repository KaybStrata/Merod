import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q, one } from "@/server/db";
import { audit } from "@/server/audit";
import { getTrainingSettings } from "@/server/training/trainer";
import { HttpError } from "@/server/errors";

/** GET: auto-training settings, learned prompt defaults, per-bot/shortcut overrides, adjustment history. */
export const GET = route(async () => {
  const u = await requireUser();
  const [settings, defaults, bots, shortcuts, adjustments, stats] = await Promise.all([
    getTrainingSettings(u.id),
    one("SELECT default_stop_loss_pct, max_prompt_order_usd, learned_from, updated_at FROM prompt_trading_defaults WHERE user_id=$1", [u.id]),
    q("SELECT id, name, strategy_id, status, auto_training, loss_streak, params, original_config, is_paper FROM trading_bots WHERE user_id=$1 ORDER BY created_at DESC", [u.id]),
    q("SELECT id, name, auto_training, actions, original_config FROM trading_shortcuts WHERE user_id=$1 ORDER BY sort_order, created_at", [u.id]),
    q("SELECT * FROM training_adjustments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [u.id]),
    one(`SELECT count(*) FILTER (WHERE status='applied')::int AS active, count(*) FILTER (WHERE status='reverted')::int AS reverted,
                count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today FROM training_adjustments WHERE user_id=$1`, [u.id]),
  ]);
  return ok({ settings, defaults, bots, shortcuts, adjustments, stats });
});

const Settings = z.object({
  enabled: z.boolean().optional(),
  scope_bots: z.boolean().optional(),
  scope_shortcuts: z.boolean().optional(),
  scope_prompts: z.boolean().optional(),
  pause_after_losses: z.number().int().min(1).max(20).optional(),
  max_adjustments_per_day: z.number().int().min(1).max(100).optional(),
});

/** PATCH: switch auto-training on/off and set scopes. Human session only (AI paths never call this). */
export const PATCH = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, Settings);
  const cur = await getTrainingSettings(u.id);
  const next = { ...cur, ...b };
  await q(
    `INSERT INTO auto_training_settings (user_id, enabled, scope_bots, scope_shortcuts, scope_prompts, pause_after_losses, max_adjustments_per_day, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (user_id) DO UPDATE SET enabled=$2, scope_bots=$3, scope_shortcuts=$4, scope_prompts=$5, pause_after_losses=$6, max_adjustments_per_day=$7, updated_at=now()`,
    [u.id, next.enabled, next.scope_bots, next.scope_shortcuts, next.scope_prompts, next.pause_after_losses, next.max_adjustments_per_day]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "training.settings", data: b });
  return ok({ settings: next });
});

const Override = z.object({ kind: z.enum(["bot", "shortcut"]), id: z.string().uuid(), mode: z.enum(["inherit", "on", "off"]) });

/** POST: per-bot / per-shortcut override (inherit | on | off). */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, Override);
  const table = b.kind === "bot" ? "trading_bots" : "trading_shortcuts";
  const r = await one(`UPDATE ${table} SET auto_training=$3 WHERE id=$1 AND user_id=$2 RETURNING id`, [b.id, u.id, b.mode]);
  if (!r) throw new HttpError(404, `${b.kind} not found`);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "training.override", target: `${b.kind}:${b.id}`, data: { mode: b.mode } });
  return ok({ ok: true });
});
