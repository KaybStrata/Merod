import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";
import { ShortcutSchema, getShortcut, insertShortcut } from "@/server/shortcuts/service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return ok({ shortcut: await getShortcut(u.id, (await params).id) });
});

/** PUT: replace the shortcut definition. */
export const PUT = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  await getShortcut(u.id, id);
  const b = await parse(req, ShortcutSchema);
  if (b.folderId && !(await one("SELECT 1 FROM shortcut_folders WHERE id=$1 AND user_id=$2", [b.folderId, u.id]))) throw new HttpError(400, "Folder not found");
  if (b.accountId && !(await one("SELECT 1 FROM trading_accounts WHERE id=$1 AND user_id=$2", [b.accountId, u.id]))) throw new HttpError(400, "Account not found");
  const s = await one(
    `UPDATE trading_shortcuts SET folder_id=$3, name=$4, icon=$5, color=$6, asset_id=$7, asset_category=$8, account_id=$9, actions=$10, max_spend_usd=$11,
       max_slippage_bps=$12, require_confirmation=$13, conditions=$14, expires_at=$15, placement=$16 WHERE id=$1 AND user_id=$2 RETURNING *`,
    [id, u.id, b.folderId ?? null, b.name, b.icon, b.color ?? null, b.assetId ?? null, b.assetCategory ?? null, b.accountId ?? null, JSON.stringify(b.actions),
     b.maxSpendUsd ?? null, b.maxSlippageBps ?? null, b.requireConfirmation, JSON.stringify(b.conditions), b.expiresAt ?? null, b.placement]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "shortcut.update", target: id });
  return ok({ shortcut: s });
});

/** POST {action:"duplicate"} */
export const POST = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const s = await getShortcut(u.id, (await params).id);
  const copy = await insertShortcut(u.id, ShortcutSchema.parse({
    name: `${s.name} (copy)`.slice(0, 40), icon: s.icon, color: s.color, folderId: s.folder_id, assetId: s.asset_id, assetCategory: s.asset_category,
    accountId: s.account_id, actions: s.actions, maxSpendUsd: s.max_spend_usd, maxSlippageBps: s.max_slippage_bps, requireConfirmation: s.require_confirmation,
    conditions: s.conditions, expiresAt: s.expires_at ? new Date(s.expires_at).toISOString() : null, placement: s.placement,
  }));
  return ok({ shortcut: copy });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  await getShortcut(u.id, id);
  await q("DELETE FROM trading_shortcuts WHERE id=$1 AND user_id=$2", [id, u.id]);
  await audit({ actorType: "user", actorId: u.id, userId: u.id, action: "shortcut.delete", target: id });
  return ok({ ok: true });
});
