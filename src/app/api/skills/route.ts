import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { createSkill, createRule, deleteSkill, listSkills, setSkillActive, updateSkill } from "@/server/skills";
import { listSchedules } from "@/server/schedules";
import { q } from "@/server/db";

/** Skills and schedules for the prompt box's Skills menu. */
export const GET = route(async () => {
  const u = await requireUser();
  return ok({ skills: await listSkills(u.id), schedules: await listSchedules(u.id) });
});

/** Create a skill: { name?, instructions }. */
export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ name: z.string().max(60).optional(), instructions: z.string().min(3).max(2000), kind: z.enum(["skill", "point", "rule"]).optional(), tz: z.string().max(60).optional(),
    scope: z.enum(["all", "bots", "bot", "prompts"]).optional(), scopeRef: z.string().uuid().optional() }));
  try {
    if (b.kind === "rule") return ok(await createRule(u.id, b.name ?? "", b.instructions, b.scope ?? "all", b.scopeRef ?? null));
    return ok(await createSkill(u.id, b.name ?? "", b.instructions, b.kind ?? "skill", b.tz ?? "UTC"));
  }
  catch (e: any) { throw new HttpError(400, e.message); }
});

/** Turn a skill or schedule on/off: { kind: "skill"|"schedule", id, active }. */
export const PATCH = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ kind: z.enum(["skill", "schedule"]), id: z.string().uuid(), active: z.boolean().optional(), name: z.string().max(60).optional(), instructions: z.string().max(2000).optional() }));
  if (b.kind === "skill") {
    let skill: any = null;
    if (b.name !== undefined || b.instructions !== undefined) { try { skill = await updateSkill(u.id, b.id, { name: b.name, instructions: b.instructions }); } catch (e: any) { throw new HttpError(400, e.message); } }
    if (b.active !== undefined) skill = await setSkillActive(u.id, b.id, b.active);
    if (!skill) throw new HttpError(404, "That skill or point no longer exists. Refresh and try again.");
    return ok({ skill });
  }
  if (b.active === undefined) throw new HttpError(400, "Say on or off");
  const { nextRun } = await import("@/server/schedules");
  const row = (await q<any>("SELECT spec FROM prompt_schedules WHERE id=$1 AND user_id=$2", [b.id, u.id]))[0];
  if (!row) throw new HttpError(404, "Schedule not found");
  await q("UPDATE prompt_schedules SET active=$3, next_run_at=CASE WHEN $3 THEN $4 ELSE next_run_at END WHERE id=$1 AND user_id=$2", [b.id, u.id, b.active, nextRun(row.spec)]);
  return ok({ ok: true });
});

/** Delete: ?kind=skill|schedule&id=… */
export const DELETE = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Bad id");
  if (sp.get("kind") === "schedule") await q("DELETE FROM prompt_schedules WHERE id=$1 AND user_id=$2", [id, u.id]);
  else {
    await q("DELETE FROM auton_assets WHERE user_id=$1 AND ref_id=$2", [u.id, id]).catch(() => {});
    await deleteSkill(u.id, id);
  }
  return ok({ ok: true });
});
