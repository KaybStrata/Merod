import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { moveMoney } from "@/server/ewallets";

const End = z.object({ wallet: z.string().uuid().optional(), trading: z.boolean().optional() }).refine((x) => !!x.wallet !== !!x.trading, "Pick an e-wallet or trading cash");
/** Move money: trading cash ⇄ e-wallet, or between e-wallets. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`ew-move:${u.id}`, 60, 60);
  const b = await parse(req, z.object({ from: End, to: End, amount: z.number().positive().max(1e9) }));
  return ok(await moveMoney(u.id, b));
});
