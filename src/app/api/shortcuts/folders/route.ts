import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";

export const GET = route(async () => {
  const u = await requireUser();
  return ok({ folders: await q("SELECT * FROM shortcut_folders WHERE user_id=$1 ORDER BY name", [u.id]) });
});
export const POST = route(async (req) => {
  const u = await requireUser();
  const { name } = await parse(req, z.object({ name: z.string().min(1).max(40) }));
  return ok({ folder: await one("INSERT INTO shortcut_folders (user_id, name) VALUES ($1,$2) RETURNING *", [u.id, name]) });
});
export const PATCH = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ id: z.string().uuid(), name: z.string().min(1).max(40) }));
  return ok({ folder: await one("UPDATE shortcut_folders SET name=$3 WHERE id=$1 AND user_id=$2 RETURNING *", [b.id, u.id, b.name]) });
});
export const DELETE = route(async (req) => {
  const u = await requireUser();
  const { id } = await parse(req, z.object({ id: z.string().uuid() }));
  await q("DELETE FROM shortcut_folders WHERE id=$1 AND user_id=$2", [id, u.id]); // shortcuts keep existing (folder_id → NULL)
  return ok({ ok: true });
});
