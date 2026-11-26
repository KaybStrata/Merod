import "@/lib/server-only-shim";
import { q, one } from "../db";
import { getStrategy } from "../bots/strategies";
import { log } from "../bots/runner";

/**
 * Edit ALL or specific bots/agents from the prompt box, e.g.
 *   "create a stop loss for all bots/agents at -8%", "set take profit to 5% on SOL Momentum",
 *   "all bots $20 per trade", "remove the stop loss from ETH Accumulation", "every agent: buy on a 2% dip".
 * Bots: their strategy settings change live (only the settings each strategy uses). Agents: their strategy changes,
 * and open positions get new exit levels right away.
 */
export type Edit = { stopLossPct?: number; takeProfitPct?: number; amountUsd?: number; dipPct?: number };
type Target = { kind: "bot" | "agent"; id: string; name: string };

/** A percentage written either way round: "stop loss 8%", "stop loss at -8%", "8% stop loss", ".70% stop loss", "0.7 % sl". */
const NUM = "(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))";
const pctNear = (t: string, word: string) => {
  const after = t.match(new RegExp(`\\b(?:${word})\\b[^0-9%.\\-]{0,30}${NUM}\\s*%`));
  const before = t.match(new RegExp(`${NUM}\\s*%\\s*(?:a |an |the )?(?:${word})\\b`));
  const m = after ?? before;
  return m ? Math.abs(Number(m[1])) : undefined;
};
const pctAfter = (t: string, re: RegExp) => { const m = t.match(re); return m ? Math.abs(Number(m[m.length - 1])) : undefined; };

export function parseEdits(raw: string): Edit | null {
  const t = raw.toLowerCase().replace(/\s+/g, " ");
  const e: Edit = {};
  if (/\b(remove|delete|no|clear|drop|without)\b[^.]{0,20}\bstop.?loss(es)?\b/.test(t)) e.stopLossPct = 0;
  else { const v = pctNear(t, "stop.?loss(?:es)?|sl"); if (v !== undefined) e.stopLossPct = v; }
  if (/\b(remove|delete|no|clear|drop)\b[^.]{0,20}\b(take.?profit|target)s?\b/.test(t)) e.takeProfitPct = 0;
  else { const v = pctNear(t, "take.?profits?|tp|profit target|targets?|sell at"); if (v !== undefined) e.takeProfitPct = v; }
  const amt = t.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|each|a|every)?\s*(?:trade|buy|cycle|order)|(?:per|each) (?:trade|buy|cycle|order)[^0-9$]{0,15}\$?\s*([\d,]+(?:\.\d+)?)|(?:trade size|amount)[^0-9$]{0,15}\$?\s*([\d,]+(?:\.\d+)?)/);
  if (amt) e.amountUsd = Number(String(amt[1] ?? amt[2] ?? amt[3]).replace(/,/g, ""));
  const dip = pctAfter(t, /\b(?:buy on (?:a )?|dip(?: of)?|on a)\s*(\d+(?:\.\d+)?|\.\d+)\s*%\s*(?:dip|drop)?/);
  if (dip !== undefined && /\bdip|drop\b/.test(t)) e.dipPct = dip;
  return Object.keys(e).length ? e : null;
}

/** Which bots/agents the prompt is about: "all bots", "all agents", "all bots/agents", "everything", or names. */
export async function parseTargets(userId: string, raw: string): Promise<Target[] | null> {
  const t = raw.toLowerCase().replace(/\s+/g, " ");
  const bots = await q<any>("SELECT id, name FROM trading_bots WHERE user_id=$1 AND status NOT IN ('archived','stopped')", [userId]);
  const agents = await q<any>("SELECT id, name FROM agents WHERE user_id=$1 AND status NOT IN ('archived','completed')", [userId]);
  const all = /\b(all|every|each|my)\b/.test(t);
  const wantBots = /\bbots?\b/.test(t), wantAgents = /\bagents?\b/.test(t);
  const out: Target[] = [];
  if (all && (wantBots || wantAgents) || /\b(everything|all of them)\b/.test(t)) {
    if (wantBots || !wantAgents) out.push(...bots.map((b) => ({ kind: "bot" as const, id: b.id, name: b.name })));
    if (wantAgents || !wantBots) out.push(...agents.map((a) => ({ kind: "agent" as const, id: a.id, name: a.name })));
  }
  // Named ones (with or without @), longest name first.
  let rest = ` ${t} `;
  for (const r of [...bots.map((b) => ({ ...b, kind: "bot" })), ...agents.map((a) => ({ ...a, kind: "agent" }))].sort((a, b) => b.name.length - a.name.length)) {
    const n = String(r.name).toLowerCase().trim();
    if (n.length < 3 || !rest.includes(n)) continue;
    if (!out.some((x) => x.id === r.id)) out.push({ kind: r.kind, id: r.id, name: r.name });
    rest = rest.split(n).join(" ");
  }
  return out.length ? out : null;
}

const fmtEdit = (e: Edit) => [
  e.stopLossPct !== undefined ? (e.stopLossPct ? `stop-loss −${e.stopLossPct}%` : "no stop-loss") : null,
  e.takeProfitPct !== undefined ? (e.takeProfitPct ? `take-profit +${e.takeProfitPct}%` : "no take-profit") : null,
  e.amountUsd !== undefined ? `$${e.amountUsd} per trade` : null,
  e.dipPct !== undefined ? `buy on a ${e.dipPct}% dip` : null,
].filter(Boolean).join(", ");

/** Apply the edit to each target; returns one line per bot/agent saying what changed (or why it couldn't). */
export async function applyEdits(userId: string, targets: Target[], e: Edit) {
  const lines: string[] = [];
  const BOT_KEY: Record<keyof Edit, string> = { stopLossPct: "stop_loss_pct", takeProfitPct: "take_profit_pct", amountUsd: "amount_usd", dipPct: "dip_pct" };
  for (const x of targets) {
    try {
      if (x.kind === "bot") {
        const b = await one<any>("SELECT id, strategy_id, params FROM trading_bots WHERE id=$1 AND user_id=$2", [x.id, userId]);
        if (!b) continue;
        const keys = new Set((getStrategy(b.strategy_id)?.params ?? []).map((p) => p.key));
        const patch: Record<string, number | null> = {}, skipped: string[] = [];
        for (const [k, v] of Object.entries(e) as [keyof Edit, number][]) {
          if (keys.has(BOT_KEY[k])) patch[BOT_KEY[k]] = k === "stopLossPct" || k === "takeProfitPct" ? (v || null) : v;
          else skipped.push(k === "stopLossPct" ? "stop-loss" : k === "takeProfitPct" ? "take-profit" : k === "amountUsd" ? "amount" : "dip");
        }
        if (!Object.keys(patch).length) { lines.push(`• ${x.name} (bot): its strategy (${getStrategy(b.strategy_id)?.name ?? b.strategy_id}) doesn't use ${skipped.join(" or ")}; unchanged.`); continue; }
        await q("UPDATE trading_bots SET params = params || $3::jsonb, updated_at=now() WHERE id=$1 AND user_id=$2", [x.id, userId, JSON.stringify(patch)]);
        await log(x.id, "control", `Settings updated from the prompt box: ${fmtEdit(Object.fromEntries(Object.entries(e).filter(([k]) => keys.has(BOT_KEY[k as keyof Edit]))) as Edit)}`);
        lines.push(`• ${x.name} (bot): ${fmtEdit(Object.fromEntries(Object.entries(e).filter(([k]) => keys.has(BOT_KEY[k as keyof Edit]))) as Edit)}${skipped.length ? ` (its strategy has no ${skipped.join("/")})` : ""}. Live now.`);
      } else {
        const a = await one<any>("SELECT id, strategy, state FROM agents WHERE id=$1 AND user_id=$2", [x.id, userId]);
        if (!a) continue;
        const s = { ...(a.strategy ?? {}) };
        if (e.stopLossPct !== undefined) s.stopLossPct = e.stopLossPct;
        if (e.takeProfitPct !== undefined) s.takeProfitPct = e.takeProfitPct;
        if (e.amountUsd !== undefined) s.tradeUsd = e.amountUsd;
        if (e.dipPct !== undefined) s.dipPct = e.dipPct;
        // Positions it already holds get the new exit levels right away (from each position's entry price).
        const { positionsFor } = await import("../agents/service");
        const exits = { ...(a.state?.exits ?? {}) };
        let reset = 0;
        for (const p of await positionsFor(a.id)) {
          if (!(p.qty > 0) || !p.entry) continue;
          const tp = Number(s.takeProfitPct ?? 0), sl = Number(s.stopLossPct ?? 0);
          exits[p.assetId] = { tp: tp ? p.entry * (1 + tp / 100) : null, sl: sl ? p.entry * (1 - sl / 100) : null };
          reset++;
        }
        await q("UPDATE agents SET strategy=$3, state = jsonb_set(COALESCE(state,'{}'::jsonb), '{exits}', $4::jsonb), revision=revision+1, updated_at=now() WHERE id=$1 AND user_id=$2",
          [x.id, userId, JSON.stringify(s), JSON.stringify(exits)]);
        lines.push(`• ${x.name} (agent): ${fmtEdit(e)}${reset ? `; applied to its ${reset} open position${reset === 1 ? "" : "s"}` : ""}. Live now.`);
      }
    } catch (err: any) { lines.push(`• ${x.name}: couldn't update (${err.message}).`); }
  }
  return lines;
}

export { fmtEdit };
