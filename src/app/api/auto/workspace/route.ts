import { z } from "zod";
import { requireSuperAdmin } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { one } from "@/server/db";
import { workspace, createStrategy, updateStrategy, deleteStrategy, setAsset, planFromText, saveTask, deleteTask, runTask } from "@/server/auto/workspace";
import { runFor } from "@/server/auto/engine";

/** Multi-screen auto trading workspace (owner only). */
export const GET = route(async () => {
  const u = await requireSuperAdmin();
  return ok(await workspace(u.id));
});

const uuid = z.string().uuid();
const Kind = z.enum(["multi_asset", "momentum", "rotation", "breakout", "ai_swing"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("strategy.create"), name: z.string().max(60).optional(), kind: Kind, assetIds: z.array(uuid).min(1).max(50), timeframe: z.string().max(4).optional() }),
  z.object({ action: z.literal("strategy.update"), id: uuid, name: z.string().max(60).optional(), kind: Kind.optional(), enabled: z.boolean().optional(), assetIds: z.array(uuid).max(50).optional(), timeframe: z.string().max(4).optional() }),
  z.object({ action: z.literal("strategy.delete"), id: uuid }),
  z.object({ action: z.literal("asset"), assetId: uuid, include: z.boolean() }),
  z.object({ action: z.literal("plan"), text: z.string().min(2).max(500) }),
  z.object({ action: z.literal("task.save"), id: uuid.optional(), name: z.string().max(60).optional(), kind: z.enum(["run", "rebalance", "take_profit_sweep", "close_risky"]).optional(),
    atTime: z.string().max(5).optional(), days: z.enum(["daily", "weekdays"]).optional(), enabled: z.boolean().optional(), tz: z.string().max(40).optional() }),
  z.object({ action: z.literal("task.delete"), id: uuid }),
  z.object({ action: z.literal("task.run"), id: uuid }),
  z.object({ action: z.literal("run") }),
]);

export const POST = route(async (req) => {
  const u = await requireSuperAdmin();
  await rateLimit(`auto-ws:${u.id}`, 60, 60);
  const b = await parse(req, Body);
  let result: unknown = null;
  switch (b.action) {
    case "strategy.create": result = await createStrategy(u.id, b); break;
    case "strategy.update": result = await updateStrategy(u.id, b.id, b); break;
    case "strategy.delete": await deleteStrategy(u.id, b.id); break;
    case "asset": await setAsset(u.id, b.assetId, b.include); break;
    case "plan": result = await planFromText(u.id, b.text); break;
    case "task.save": result = await saveTask(u.id, b); break;
    case "task.delete": await deleteTask(u.id, b.id); break;
    case "task.run": {
      const t = await one<any>("SELECT * FROM auto_tasks WHERE id=$1 AND user_id=$2", [b.id, u.id]);
      if (!t) throw new HttpError(404, "Task not found");
      result = await runTask(u.id, t); break;
    }
    case "run": result = await runFor(u.id); break;
  }
  return ok({ result, workspace: await workspace(u.id) });
});

export const maxDuration = 60;
