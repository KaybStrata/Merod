import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one } from "@/server/db";
import { walletCommand } from "@/server/copy/wallets";

/** Paste any number of wallet addresses: { text, action: "mimic" | "watch" | "stop" | "stats", perTradeUsd?, live? }. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`copy-bulk:${u.id}`, 30, 3600);
  const b = await parse(req, z.object({ text: z.string().min(32).max(200_000), action: z.enum(["mimic", "watch", "stop", "stats"]), perTradeUsd: z.number().positive().optional(), live: z.boolean().optional() }));
  const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [u.id]))?.role;
  const verb = b.action === "mimic" ? `mimic${b.perTradeUsd ? ` $${b.perTradeUsd} per trade` : ""}${b.live ? " with real money" : ""}` : b.action === "watch" ? "watch" : b.action === "stop" ? "stop mimicking" : "stats for";
  const message = await walletCommand(u.id, `${verb} ${b.text}`, { isOwner: role === "super_admin" });
  return ok({ message: message ?? "No wallet addresses found. Paste Solana (base58) or Ethereum (0x…) addresses." });
});
