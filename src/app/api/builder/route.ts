import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { BuilderConfig, draftFromText, runBacktest, listBuilder, saveVersion, deploy } from "@/server/agents/builder";

/** Strategy Builder. GET: saved strategies + versions. POST actions: draft | backtest | save | deploy. */
export const GET = route(async () => {
  const u = await requireUser();
  return ok({ strategies: await listBuilder(u.id) });
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), text: z.string().min(3).max(8000) }),
  z.object({ action: z.literal("backtest"), config: BuilderConfig }),
  z.object({ action: z.literal("save"), name: z.string().min(1).max(80), config: BuilderConfig, backtest: z.any().optional(), note: z.string().max(200).optional() }),
  z.object({ action: z.literal("deploy"), name: z.string().min(1).max(60), config: BuilderConfig, capitalUsd: z.number().positive().max(10_000_000) }),
]);
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`builder:${u.id}`, 40, 60);
  const b = await parse(req, Body);
  if (b.action === "draft") { const config = await draftFromText(b.text); return ok({ config, backtest: await runBacktest(config).catch((e) => ({ error: e.message })) }); }
  if (b.action === "backtest") return ok({ backtest: await runBacktest(b.config) });
  if (b.action === "save") return ok(await saveVersion(u.id, b.name, b.config, b.backtest, b.note));
  return ok({ agent: await deploy(u.id, b.name, b.config, b.capitalUsd, u.role === "super_admin") });
});
