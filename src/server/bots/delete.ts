import "@/lib/server-only-shim";
import { q } from "../db";

/**
 * Delete bots and agents (Auton's included). Bots are stopped and removed (their past orders stay in your history);
 * agents are archived (stopped, open orders cancelled, hidden everywhere). Links to tabs, Auton, maps and e-wallet
 * rules are cleaned up.
 */
export async function deleteTargets(userId: string, targets: { kind: string; id: string; name: string; status: string }[]) {
  const { setBotStatus } = await import("@/server/bots/runner");
  const { agentAction } = await import("@/server/agents/service");
  const { audit } = await import("@/server/audit");
  const lines: string[] = [];
  for (const t of targets) {
    try {
      if (t.kind === "bot") {
        if (t.status === "running") await setBotStatus(userId, t.id, "stop", "user").catch(() => {});
        await q("DELETE FROM trading_bots WHERE id=$1 AND user_id=$2", [t.id, userId]);
        await audit({ actorType: "user", actorId: userId, userId, action: "bot.delete", target: t.id });
      } else {
        await agentAction(userId, t.id, "archive" as any, { reason: "Deleted from Edit all", isOwner: true } as any);
      }
      await q("DELETE FROM auton_assets WHERE user_id=$1 AND ref_id=$2", [userId, t.id]).catch(() => {});
      await q("DELETE FROM conversation_links WHERE user_id=$1 AND ref_id=$2::uuid", [userId, t.id]).catch(() => {});
      await q("DELETE FROM e_wallet_rules WHERE user_id=$1 AND scope_ref=$2", [userId, t.id]).catch(() => {});
      lines.push(`• ${t.name} (${t.kind}): deleted.`);
    } catch (e: any) { lines.push(`• ${t.name}: couldn't delete (${e.message}).`); }
  }
  return lines;
}
