import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { q } from "@/server/db";
import { listWallets, createWallet } from "@/server/ewallets";

/** GET → e-wallets with balances, rules and recent entries (+ bots/agents to choose for rules). POST → create one. */
export const GET = route(async () => {
  const u = await requireUser();
  const [wallets, sources] = await Promise.all([
    listWallets(u.id),
    q<any>("SELECT id, name, 'bot' AS kind FROM trading_bots WHERE user_id=$1 AND status <> 'archived' UNION ALL SELECT id, name, 'agent' FROM agents WHERE user_id=$1 AND status <> 'archived' ORDER BY name", [u.id]),
  ]);
  return ok({ wallets, sources });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`ew-create:${u.id}`, 30, 3600);
  const b = await parse(req, z.object({ name: z.string().min(1).max(40), goalUsd: z.number().positive().max(1e9).nullable().optional(), color: z.string().max(20).nullable().optional() }));
  return ok({ wallet: await createWallet(u.id, b.name, b.goalUsd ?? null, b.color ?? null) });
});
