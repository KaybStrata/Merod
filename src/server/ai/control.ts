import "@/lib/server-only-shim";
import { q } from "../db";

/**
 * Control a specific bot or agent by name from the prompt box:
 *   "@SOL Momentum turn off", "pause ETH Accumulation", "turn on @Scanner", "resume SOL Momentum and BTC Momentum".
 * The @ is optional; names match case-insensitively (longest name first, so "SOL Momentum 2" beats "SOL Momentum").
 */
export type ControlVerb = "pause" | "resume";
const OFF = /\b(turn(ed)?\s+(it\s+|them\s+)?off|switch(ed)?\s+off|off|pause|paused|stop|stopped|disable|disabled|halt|kill|deactivate|shut\s*(it\s+)?down)\b/i;
const ON = /\b(turn(ed)?\s+(it\s+|them\s+)?on|switch(ed)?\s+on|on|resume|unpause|start|restart|enable|enabled|activate|run|reactivate)\b/i;

export type ControlTarget = { kind: "bot" | "agent"; id: string; name: string; status: string };

export async function parseControl(userId: string, raw: string): Promise<{ verb: ControlVerb; targets: ControlTarget[] } | null> {
  const t = raw.trim();
  if (t.length > 300) return null;
  // Trades, creations, edits and questions are handled elsewhere ("buy SOL on a dip with SOL Momentum" is not "turn it on").
  if (/\b(buy|sell|short|swap|create|make|build|alert|set|change|edit|rename|update|how|why|what|when|which|did|does|should)\b|\?/i.test(t)) return null;
  const off = OFF.test(t), on = ON.test(t);
  if (off === on) return null; // neither, or ambiguous ("turn off X and turn on Y")
  const rows = await q<any>(
    `SELECT 'bot' AS kind, id, name, status FROM trading_bots WHERE user_id=$1 AND status <> 'archived'
     UNION ALL SELECT 'agent' AS kind, id, name, status FROM agents WHERE user_id=$1 AND status <> 'archived'`, [userId]);
  const lower = ` ${t.toLowerCase().replace(/\s+/g, " ")} `;
  const hits: ControlTarget[] = [];
  let rest = lower;
  for (const r of [...rows].sort((a, b) => b.name.length - a.name.length)) {
    const n = String(r.name).toLowerCase().replace(/\s+/g, " ").trim();
    if (n.length < 3) continue;
    const at = rest.indexOf(`@${n}`), plain = rest.search(new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`));
    if (at < 0 && plain < 0) continue;
    hits.push({ kind: r.kind, id: r.id, name: r.name, status: r.status });
    rest = rest.split(`@${n}`).join(" ").split(n).join(" "); // a shorter name inside a longer one doesn't match twice
  }
  if (!hits.length) return null;
  // Whatever's left after removing the names should be just the instruction ("turn off", "please pause it").
  const leftover = rest.replace(/[@,.!?&]|\b(and|the|my|bot|bots|agent|agents|please|it|them|now|both|for me|right away)\b/g, " ").replace(OFF, " ").replace(ON, " ").trim();
  if (leftover.split(/\s+/).filter(Boolean).length > 4) return null; // a longer sentence is something else (e.g. a question)
  return { verb: off ? "pause" : "resume", targets: hits };
}

/** Pause or resume the named bots/agents. Returns one line per target. */
export async function runControl(userId: string, verb: ControlVerb, targets: ControlTarget[], isOwner: boolean) {
  const { setBotStatus } = await import("../bots/runner");
  const { agentAction } = await import("../agents/service");
  const lines: string[] = [];
  for (const x of targets) {
    try {
      if (x.kind === "bot") {
        if (verb === "pause" && x.status !== "running") { lines.push(`• ${x.name} (bot) is already ${x.status}.`); continue; }
        if (verb === "resume" && x.status === "running") { lines.push(`• ${x.name} (bot) is already running.`); continue; }
        await setBotStatus(userId, x.id, verb === "pause" ? "pause" : x.status === "paused" ? "resume" : "start", "ai");
        lines.push(`• ${x.name} (bot): ${verb === "pause" ? "turned off (paused). Open positions stay as they are." : "turned on, trading again."}`);
      } else {
        const action = verb === "pause" ? "pause" : x.status === "paused" ? "resume" : x.status === "pending_approval" ? "approve" : "start";
        if (verb === "pause" && ["paused", "completed", "configured", "draft"].includes(x.status)) { lines.push(`• ${x.name} (agent) is already ${x.status.replace("_", " ")}.`); continue; }
        if (verb === "resume" && ["running", "queued"].includes(x.status)) { lines.push(`• ${x.name} (agent) is already running.`); continue; }
        await agentAction(userId, x.id, action as any, { reason: `${verb === "pause" ? "Turned off" : "Turned on"} from the prompt box`, isOwner });
        lines.push(`• ${x.name} (agent): ${verb === "pause" ? "turned off (paused)." : "turned on."}`);
      }
    } catch (e: any) { lines.push(`• ${x.name}: couldn't ${verb === "pause" ? "turn it off" : "turn it on"} (${e.message}).`); }
  }
  if (verb === "pause" && targets.some((x) => x.kind === "bot")) {
    const { one } = await import("../db");
    const left = await one<{ n: number }>("SELECT count(*)::int AS n FROM trading_bots WHERE user_id=$1 AND status='running'", [userId]);
    const auton = await one<any>("SELECT active FROM auton_settings WHERE user_id=$1", [userId]).catch(() => null);
    if (!left?.n && auton?.active) {
      const { stopAutomationsToo } = await import("../bots/runner");
      await stopAutomationsToo(userId, "All bots turned off");
      lines.push("• Auton: turned off too, so it doesn't start new bots (say “start Auton” to turn it back on).");
    }
  }
  return lines;
}
