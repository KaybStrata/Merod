import "@/lib/server-only-shim";
import { scopePnl } from "../pnl-scope";

/** Auton's own P&L: only trades by bots and AI bots Auton made or manages, with period comparison. */
export async function autonPnl(userId: string, rangeSec: number | null) {
  const r = await scopePnl(userId, "auton", rangeSec);
  return { ...r, bots: r.bots ?? 0, agents: r.agents ?? 0 };
}
