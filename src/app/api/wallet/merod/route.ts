import { z } from "zod";
import { requireSuperAdmin } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { createMerodWallet, updateSettings, walletStatus, withdrawSol } from "@/server/wallet/merod-wallet";

/** Merod Wallet (owner only). GET: address, balances, caps. POST: create | settings | withdraw (2FA). The secret key is never returned. */
export const GET = route(async () => {
  const u = await requireSuperAdmin();
  return ok(await walletStatus(u.id));
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("settings"), perTradeUsd: z.number().min(1).max(1_000_000).optional(), dailyUsd: z.number().min(1).max(10_000_000).optional(), payWith: z.enum(["USDC", "SOL"]).optional() }),
  z.object({ action: z.literal("withdraw"), to: z.string().min(32).max(44), amountSol: z.number().positive().max(1_000_000), code: z.string().min(6).max(8) }),
]);
export const POST = route(async (req) => {
  const u = await requireSuperAdmin();
  await rateLimit(`merod-wallet:${u.id}`, 20, 60);
  const b = await parse(req, Body);
  if (b.action === "create") return ok(await createMerodWallet(u.id));
  if (b.action === "settings") return ok(await updateSettings(u.id, b));
  return ok(await withdrawSol(u.id, b.to, b.amountSol, b.code));
});
