import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { applyEdits } from "@/server/ai/bulk-edit";
import { deleteTargets } from "@/server/bots/delete";
import { runControl } from "@/server/ai/control";
import { getStrategy } from "@/server/bots/strategies";

/**
 * Edit many bots and agents at once (Talk floating window → "Edit all").
 * GET  → every bot and agent with its current $ per trade, stop-loss, take-profit, dip, capital and status.
 * POST → { targets: [{kind,id}], edit: {...}, status?: "pause" | "resume" } applies the same change to all of them.
 */
export const GET = route(async () => {
  const u = await requireUser();
  const [bots, agents] = await Promise.all([
    q<any>("SELECT id, name, status, strategy_id, params, is_paper, pnl_usd FROM trading_bots WHERE user_id=$1 AND status NOT IN ('archived','stopped') ORDER BY status='running' DESC, name", [u.id]),
    q<any>("SELECT a.id, a.name, a.status, a.role, a.strategy, a.capital_usd, a.realized_pnl_usd, f.name AS fleet FROM agents a LEFT JOIN agent_fleets f ON f.id=a.fleet_id WHERE a.user_id=$1 AND a.status NOT IN ('archived','completed') ORDER BY a.status='running' DESC, a.name", [u.id]),
  ]);
  const num = (v: any) => (v == null || v === "" ? null : Number(v));
  return ok({
    items: [
      ...bots.map((b) => {
        const keys = new Set((getStrategy(b.strategy_id)?.params ?? []).map((p) => p.key));
        return { kind: "bot", id: b.id, name: b.name, status: b.status, detail: getStrategy(b.strategy_id)?.name ?? b.strategy_id, pnl: num(b.pnl_usd),
          amountUsd: num(b.params?.amount_usd), stopLossPct: num(b.params?.stop_loss_pct), takeProfitPct: num(b.params?.take_profit_pct), dipPct: num(b.params?.dip_pct), capitalUsd: null,
          supports: { amountUsd: keys.has("amount_usd"), stopLossPct: keys.has("stop_loss_pct"), takeProfitPct: keys.has("take_profit_pct"), dipPct: keys.has("dip_pct"), capitalUsd: false } };
      }),
      ...agents.map((a) => ({ kind: "agent", id: a.id, name: a.name, status: a.status, detail: `${String(a.role).replace(/_/g, " ")}${a.fleet ? ` · ${a.fleet}` : ""}`, pnl: num(a.realized_pnl_usd),
        amountUsd: num(a.strategy?.tradeUsd), stopLossPct: num(a.strategy?.stopLossPct), takeProfitPct: num(a.strategy?.takeProfitPct), dipPct: num(a.strategy?.dipPct), capitalUsd: num(a.capital_usd),
        supports: { amountUsd: true, stopLossPct: true, takeProfitPct: true, dipPct: true, capitalUsd: true } })),
    ],
  });
});

const N = z.number().finite();
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`bots-bulk:${u.id}`, 60, 60);
  const b = await parse(req, z.object({
    targets: z.array(z.object({ kind: z.enum(["bot", "agent"]), id: z.string().uuid() })).min(1).max(500),
    edit: z.object({ amountUsd: N.min(1).max(1e7).optional(), amountAdd: N.optional(), amountMult: N.min(0.01).max(100).optional(), stopLossPct: N.min(0).max(99).optional(), takeProfitPct: N.min(0).max(10_000).optional(),
      dipPct: N.min(0).max(99).optional(), capitalUsd: N.min(0).max(1e9).optional(), capitalAdd: N.optional(), capitalMult: N.min(0.01).max(100).optional() }).default({}),
    status: z.enum(["pause", "resume", "delete"]).optional(),
  }));
  // Only the user's own bots/agents, with their names (for the result lines).
  const ids = b.targets.map((t) => t.id);
  const rows = await q<any>(`SELECT 'bot' AS kind, id, name, status FROM trading_bots WHERE user_id=$1 AND id = ANY($2::uuid[])
                             UNION ALL SELECT 'agent', id, name, status FROM agents WHERE user_id=$1 AND id = ANY($2::uuid[])`, [u.id, ids]);
  const targets = rows.filter((r) => b.targets.some((t) => t.id === r.id && t.kind === r.kind));
  const lines: string[] = [];
  if (Object.keys(b.edit).length) lines.push(...(await applyEdits(u.id, targets.map((t) => ({ kind: t.kind, id: t.id, name: t.name })), b.edit)));
  if (b.status === "delete") {
    lines.push(...(await deleteTargets(u.id, targets)));
    return ok({ updated: targets.length, lines });
  }
  if (b.status) {
    const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [u.id]))?.role;
    lines.push(...(await runControl(u.id, b.status as "pause" | "resume", targets.map((t) => ({ kind: t.kind, id: t.id, name: t.name, status: t.status })), role === "super_admin")));
  }
  return ok({ updated: targets.length, lines });
});

