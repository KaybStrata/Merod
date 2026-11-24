import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";

export const GET = route(async () => {
  const u = await requireUser();
  return ok({ prompts: await q("SELECT * FROM saved_prompts WHERE user_id=$1 ORDER BY created_at DESC", [u.id]) });
});
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ title: z.string().min(1).max(60), content: z.string().min(1).max(2000) }));
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM saved_prompts WHERE user_id=$1", [u.id]);
  if ((n?.n ?? 0) >= 200) throw new HttpError(400, "Saved prompt limit reached");
  return ok({ prompt: await one("INSERT INTO saved_prompts (user_id, title, content) VALUES ($1,$2,$3) RETURNING *", [u.id, b.title, b.content]) });
});
export const PATCH = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ id: z.string().uuid(), title: z.string().min(1).max(60), content: z.string().min(1).max(2000) }));
  return ok({ prompt: await one("UPDATE saved_prompts SET title=$3, content=$4 WHERE id=$1 AND user_id=$2 RETURNING *", [b.id, u.id, b.title, b.content]) });
});
export const DELETE = route(async (req) => {
  const u = await requireUser();
  const { id } = await parse(req, z.object({ id: z.string().uuid() }));
  await q("DELETE FROM saved_prompts WHERE id=$1 AND user_id=$2", [id, u.id]);
  return ok({ ok: true });
});
