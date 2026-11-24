import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q } from "@/server/db";
import { audit } from "@/server/audit";
import { ShortcutSchema, insertShortcut } from "@/server/shortcuts/service";

/** GET ?placement=terminal|dashboard — user's shortcuts (+ folders, recent executions). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const placement = new URL(req.url).searchParams.get("placement");
  const shortcuts = await q(
    `SELECT s.*, a.symbol AS asset_symbol, a.name AS asset_name,
            (SELECT count(*)::int FROM shortcut_executions e WHERE e.shortcut_id=s.id AND e.status <> 'previewed') AS executions
       FROM trading_shortcuts s LEFT JOIN assets a ON a.id=s.asset_id
      WHERE s.user_id=$1 AND ($2::text IS NULL OR $2 = ANY(s.placement)) ORDER BY s.sort_order, s.created_at`, [u.id, placement]);
  const folders = await q("SELECT * FROM shortcut_folders WHERE user_id=$1 ORDER BY name", [u.id]);
  const history = placement ? [] : await q(
    `SELECT e.id, e.shortcut_id, e.status, e.order_ids, e.detail, e.created_at, s.name AS shortcut_name, a.symbol
       FROM shortcut_executions e JOIN trading_shortcuts s ON s.id=e.shortcut_id LEFT JOIN assets a ON a.id=e.asset_id
      WHERE e.user_id=$1 AND e.status <> 'previewed' ORDER BY e.created_at DESC LIMIT 50`, [u.id]);
  const accounts = placement ? [] : await q("SELECT id, label, kind, provider_id FROM trading_accounts WHERE user_id=$1 AND status='active' ORDER BY created_at", [u.id]);
  return ok({ shortcuts, folders, history, accounts });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, ShortcutSchema);
  const s = await insertShortcut(u.id, b);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "shortcut.create", target: s.id });
  return ok({ shortcut: s });
});
