import { z } from "zod";
import { requireSuperAdmin } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createMerodWallet, updateSettings, walletStatus, withdrawSol } from "@/server/wallet/merod-wallet";

/**
 * Merod Wallets (owner only, unlimited). GET: every wallet's address, balances, caps.
 * POST: create | settings | withdraw (2FA). Secret keys are never returned.
 */
export const GET = route(async () => {
  const u = await requireSuperAdmin();
  return ok(await walletStatus(u.id));
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().max(60).optional() }),
  z.object({ action: z.literal("settings"), accountId: z.string().uuid(), name: z.string().max(60).optional(), perTradeUsd: z.number().min(1).max(1_000_000).optional(), dailyUsd: z.number().min(1).max(10_000_000).optional(), payWith: z.enum(["USDC", "SOL"]).optional() }),
  z.object({ action: z.literal("withdraw"), accountId: z.string().uuid(), to: z.string().min(32).max(44), amountSol: z.number().positive().max(1_000_000), code: z.string().min(6).max(8) }),
]);
export const POST = route(async (req) => {
  const u = await requireSuperAdmin();
  await rateLimit(`merod-wallet:${u.id}`, 60, 60);
  const b = await parse(req, Body);
  if (b.action === "create") return ok(await createMerodWallet(u.id, b.name));
  if (b.action === "settings") { const { action: _a, accountId, ...s } = b; return ok(await updateSettings(u.id, accountId, s)); }
  return ok(await withdrawSol(u.id, b.accountId, b.to, b.amountSol, b.code));
});
