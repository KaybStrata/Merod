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
/**
 * amount = $ per trade ("budget", "trade size", "stake"…) for bots and agents; capital = an agent's allocation.
 * Either can be set (amountUsd / capitalUsd), changed by $ (amountAdd / capitalAdd) or scaled (amountMult / capitalMult).
 */
export type Edit = { stopLossPct?: number; takeProfitPct?: number; amountUsd?: number; dipPct?: number; amountAdd?: number; amountMult?: number; capitalUsd?: number; capitalAdd?: number; capitalMult?: number };
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

/* Money in any common form: "$35", "35$", "35 usd", "35 dollars", "$1,000", "1k". */
const M = "(?:\\$\\s*([\\d,]+(?:\\.\\d+)?k?)|([\\d,]+(?:\\.\\d+)?k?)\\s*(?:\\$|usd\\b|dollars?\\b|bucks\\b))";
const money = (m: RegExpMatchArray | null, i = 1) => {
  if (!m) return undefined;
  const raw = (m[i] ?? m[i + 1] ?? "").replace(/,/g, "");
  const n = raw.endsWith("k") ? Number(raw.slice(0, -1)) * 1000 : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const AMT = "budgets?|amounts?|trade sizes?|position sizes?|order sizes?|buy sizes?|sizes?|stakes?|bets?|spend(?:ing)?|investments?|per trade|per order|per buy";
const CAP = "capital|allocations?|bankrolls?|funds|funding|virtual funds|balances?";

/** "$ per trade" or "capital" changes in any wording: set, from X to Y, increase/decrease by $ or %, double/halve. */
function moneyEdit(t: string, words: string): { set?: number; add?: number; mult?: number } | null {
  const W = `(?:${words})`;
  const up = /\b(increase|raise|bump|boost|add|up|grow|more)\b/.test(t), down = /\b(decrease|lower|reduce|cut|drop|less|shrink)\b/.test(t);
  if (!new RegExp(`\\b${W}\\b`).test(t)) return null;
  // from $10 to $35 · of 10$ to 35$ · $10 -> $35
  let m = t.match(new RegExp(`\\b${W}\\b[^.]{0,30}?${M}\\s*(?:to|->|→|into)\\s*${M}`));
  if (m) return { set: money(m, 3) };
  // by 20% / by $5
  m = t.match(new RegExp(`\\b${W}\\b[^.]{0,30}?\\bby\\s*(\\d+(?:\\.\\d+)?)\\s*%`)) ?? t.match(new RegExp(`\\bby\\s*(\\d+(?:\\.\\d+)?)\\s*%[^.]{0,30}\\b${W}\\b`));
  if (m && (up || down)) return { mult: 1 + (down ? -1 : 1) * Number(m[1]) / 100 };
  m = t.match(new RegExp(`\\b${W}\\b[^.]{0,30}?\\bby\\s*${M}`)) ?? t.match(new RegExp(`\\bby\\s*${M}[^.]{0,30}\\b${W}\\b`));
  if (m && (up || down)) { const v = money(m); return v ? { add: down ? -v : v } : null; }
  m = t.match(new RegExp(`\\b${W}\\b[^.]{0,30}?\\bby\\s*([\\d,]+(?:\\.\\d+)?k?)\\b(?!\\s*%)`));
  if (m && (up || down)) { const v = money([m[0], m[1]] as any); return v ? { add: down ? -v : v } : null; }
  if (/\b(double|twice)\b/.test(t)) return { mult: 2 };
  if (/\btriple\b/.test(t)) return { mult: 3 };
  if (/\b(halve|half)\b/.test(t)) return { mult: 0.5 };
  // to $35 · at 35$ · = $35 · of $35 · $35 each
  m = t.match(new RegExp(`\\b${W}\\b[^0-9$.]{0,25}${M}`)) ?? t.match(new RegExp(`${M}\\s*(?:each\\s*|apiece\\s*)?(?:(?:in|of|as|for)\\s+)?(?:their |the |a |an )?${W}\\b`));
  if (m) { const v = money(m); return v ? { set: v } : null; }
  return null;
}

export function parseEdits(raw: string): Edit | null {
  const t = raw.toLowerCase().replace(/\s+/g, " ");
  const e: Edit = {};
  const cap = moneyEdit(t, CAP);
  if (cap) { if (cap.set) e.capitalUsd = cap.set; if (cap.add) e.capitalAdd = cap.add; if (cap.mult) e.capitalMult = cap.mult; }
  const amt = !cap || new RegExp(`\\b(?:${AMT})\\b`).test(t) ? moneyEdit(t, AMT) : null;
  if (amt) { if (amt.set) e.amountUsd = amt.set; if (amt.add) e.amountAdd = amt.add; if (amt.mult) e.amountMult = amt.mult; }
  if (/\b(remove|delete|no|clear|drop|without)\b[^.]{0,20}\bstop.?loss(es)?\b/.test(t)) e.stopLossPct = 0;
  else { const v = pctNear(t, "stop.?loss(?:es)?|sl"); if (v !== undefined) e.stopLossPct = v; }
  if (/\b(remove|delete|no|clear|drop)\b[^.]{0,20}\b(take.?profit|target)s?\b/.test(t)) e.takeProfitPct = 0;
  else { const v = pctNear(t, "take.?profits?|tp|profit target|targets?|sell at"); if (v !== undefined) e.takeProfitPct = v; }
  const amtOld = t.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|each|a|every)?\s*(?:trade|buy|cycle|order)|(?:per|each) (?:trade|buy|cycle|order)[^0-9$]{0,15}\$?\s*([\d,]+(?:\.\d+)?)|(?:trade size|amount)[^0-9$]{0,15}\$?\s*([\d,]+(?:\.\d+)?)/);
  if (amtOld && e.amountUsd === undefined && e.amountAdd === undefined && e.amountMult === undefined) e.amountUsd = Number(String(amtOld[1] ?? amtOld[2] ?? amtOld[3]).replace(/,/g, ""));
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

const usd = (n: number) => `$${Math.round(n * 100) / 100}`;
const fmtEdit = (e: Edit) => [
  e.stopLossPct !== undefined ? (e.stopLossPct ? `stop-loss −${e.stopLossPct}%` : "no stop-loss") : null,
  e.takeProfitPct !== undefined ? (e.takeProfitPct ? `take-profit +${e.takeProfitPct}%` : "no take-profit") : null,
  e.amountUsd !== undefined ? `${usd(e.amountUsd)} per trade` : null,
  e.amountAdd !== undefined ? `${e.amountAdd > 0 ? "+" : "−"}${usd(Math.abs(e.amountAdd))} per trade` : null,
  e.amountMult !== undefined ? `per-trade amount ×${Math.round(e.amountMult * 100) / 100}` : null,
  e.capitalUsd !== undefined ? `capital ${usd(e.capitalUsd)}` : null,
  e.capitalAdd !== undefined ? `capital ${e.capitalAdd > 0 ? "+" : "−"}${usd(Math.abs(e.capitalAdd))}` : null,
  e.capitalMult !== undefined ? `capital ×${Math.round(e.capitalMult * 100) / 100}` : null,
  e.dipPct !== undefined ? `buy on a ${e.dipPct}% dip` : null,
].filter(Boolean).join(", ");

/** Apply the edit to each target; returns one line per bot/agent saying what changed (or why it couldn't). */
export async function applyEdits(userId: string, targets: Target[], e: Edit) {
  const lines: string[] = [];
  const BOT_KEY: Partial<Record<keyof Edit, string>> = { stopLossPct: "stop_loss_pct", takeProfitPct: "take_profit_pct", amountUsd: "amount_usd", dipPct: "dip_pct" };
  for (const x of targets) {
    try {
      if (x.kind === "bot") {
        const b = await one<any>("SELECT id, strategy_id, params FROM trading_bots WHERE id=$1 AND user_id=$2", [x.id, userId]);
        if (!b) continue;
        const keys = new Set((getStrategy(b.strategy_id)?.params ?? []).map((p) => p.key));
        const patch: Record<string, number | null> = {}, skipped: string[] = [];
        const relative = rel(e.amountAdd, e.amountMult, Number(b.params?.amount_usd ?? 0));
        const ee: Edit = { ...e };
        if (relative !== undefined) ee.amountUsd = relative;
        if (e.capitalUsd !== undefined || e.capitalAdd !== undefined || e.capitalMult !== undefined) {
          // Bots have no separate capital: their budget is the $ per trade.
          const c = e.capitalUsd ?? rel(e.capitalAdd, e.capitalMult, Number(b.params?.amount_usd ?? 0));
          if (c !== undefined && ee.amountUsd === undefined) ee.amountUsd = c;
        }
        delete ee.amountAdd; delete ee.amountMult; delete ee.capitalUsd; delete ee.capitalAdd; delete ee.capitalMult;
        if ((e.amountAdd !== undefined || e.amountMult !== undefined) && relative === undefined) skipped.push("amount (it has no $ per trade set)");
        for (const [k, v] of Object.entries(ee) as [keyof Edit, number][]) {
          if (BOT_KEY[k] && keys.has(BOT_KEY[k]!)) patch[BOT_KEY[k]!] = k === "stopLossPct" || k === "takeProfitPct" ? (v || null) : v;
          else skipped.push(k === "stopLossPct" ? "stop-loss" : k === "takeProfitPct" ? "take-profit" : k === "amountUsd" ? "amount" : "dip");
        }
        if (!Object.keys(patch).length) { lines.push(`• ${x.name} (bot): its strategy (${getStrategy(b.strategy_id)?.name ?? b.strategy_id}) doesn't use ${skipped.join(" or ")}; unchanged.`); continue; }
        await q("UPDATE trading_bots SET params = params || $3::jsonb, updated_at=now() WHERE id=$1 AND user_id=$2", [x.id, userId, JSON.stringify(patch)]);
        const done = fmtEdit(Object.fromEntries(Object.entries(ee).filter(([k]) => !!BOT_KEY[k as keyof Edit] && keys.has(BOT_KEY[k as keyof Edit]!))) as Edit);
        const was = ee.amountUsd !== undefined && b.params?.amount_usd != null && Number(b.params.amount_usd) !== ee.amountUsd ? ` (was ${usd(Number(b.params.amount_usd))})` : "";
        await log(x.id, "control", `Settings updated from the prompt box: ${done}${was}`);
        lines.push(`• ${x.name} (bot): ${done}${was}${skipped.length ? ` (its strategy has no ${skipped.join("/")})` : ""}. Live now.`);
      } else {
        const a = await one<any>("SELECT id, strategy, state FROM agents WHERE id=$1 AND user_id=$2", [x.id, userId]);
        if (!a) continue;
        const s = { ...(a.strategy ?? {}) };
        if (e.stopLossPct !== undefined) s.stopLossPct = e.stopLossPct;
        if (e.takeProfitPct !== undefined) s.takeProfitPct = e.takeProfitPct;
        const wasTrade = Number(s.tradeUsd ?? 0);
        if (e.amountUsd !== undefined) s.tradeUsd = e.amountUsd;
        const relA = rel(e.amountAdd, e.amountMult, wasTrade);
        if (relA !== undefined) s.tradeUsd = relA;
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
        // Capital (allocation) goes through the agent service, which checks it fits your available paper funds.
        let capNote = "";
        if (e.capitalUsd !== undefined || e.capitalAdd !== undefined || e.capitalMult !== undefined) {
          const cur = Number((await one<any>("SELECT capital_usd FROM agents WHERE id=$1", [x.id]))?.capital_usd ?? 0);
          const next = e.capitalUsd ?? rel(e.capitalAdd, e.capitalMult, cur);
          if (next !== undefined) {
            try { const { updateAgent } = await import("../agents/service"); await updateAgent(userId, x.id, { capitalUsd: next } as any, { by: "prompt" }); capNote = `; capital ${usd(cur)} → ${usd(next)}`; }
            catch (err: any) { capNote = `; capital unchanged (${err.message})`; }
          }
        }
        const amtNote = s.tradeUsd !== wasTrade && (e.amountUsd !== undefined || relA !== undefined) ? `$ per trade ${usd(wasTrade)} → ${usd(Number(s.tradeUsd))}` : "";
        const rest = fmtEdit({ stopLossPct: e.stopLossPct, takeProfitPct: e.takeProfitPct, dipPct: e.dipPct });
        lines.push(`• ${x.name} (agent): ${[rest, amtNote].filter(Boolean).join(", ")}${capNote}${reset ? `; applied to its ${reset} open position${reset === 1 ? "" : "s"}` : ""}. Live now.`.replace(": ;", ":").replace(": .", ": no change."));
      }
    } catch (err: any) { lines.push(`• ${x.name}: couldn't update (${err.message}).`); }
  }
  return lines;
}

/** New value after a relative change (+$ or ×), never below $1; undefined when there's nothing to change from. */
function rel(add: number | undefined, mult: number | undefined, cur: number): number | undefined {
  if (add === undefined && mult === undefined) return undefined;
  if (!(cur > 0) && add === undefined) return undefined;
  const v = mult !== undefined ? cur * mult : cur + (add ?? 0);
  return Math.max(1, Math.round(v * 100) / 100);
}

export { fmtEdit };
