import "@/lib/server-only-shim";
import { q, one } from "./db";
import { parseEdits, applyEdits, fmtEdit, type Edit } from "./ai/bulk-edit";

/**
 * Skills: standing instructions that change how Merod, Modo, OpenAI/Claude, bots and agents think, decide and execute.
 *  - The text goes to every AI answer and plan (Modo, OpenAI, Claude), so it shapes interpretation and reasoning.
 *  - What Merod can enforce itself is pulled out as rules and applied for real:
 *      stop-loss / take-profit / $ per trade / dip  → every bot and agent (now, and new ones as they're created)
 *      "only sell in profit"                         → the sell-only-in-profit switch
 *      "never buy X, Y" / "only trade X, Y"          → checked on every buy by the trading engine
 *      "max $N per trade"                            → checked on every buy by the trading engine
 */
export type SkillRules = { edits?: Edit; profitOnly?: boolean; neverBuy?: string[]; onlyTrade?: string[]; maxTradeUsd?: number };

/** Ticker list at the start of a phrase: "BONK or WIF, max $25 per trade" → BONK, WIF (stops at the first ordinary word). */
const STOP = /^(max(imum)?|per|trade|trades|unless|when|if|with|under|over|below|above|more|less|than|at|for|after|before|because|that|which|stop|loss|profit|always|every|any|all|coins?|tokens?|stocks?|meme|memes|new|and also|also)$/i;
function syms(s: string) {
  const out: string[] = [];
  for (const raw of s.split(/[\s,/]+/)) {
    const w = raw.replace(/[^A-Za-z0-9$]/g, "");
    if (!w) continue;
    if (/^(or|and|&|nor|either|neither)$/i.test(w)) continue;
    if (STOP.test(w)) break;
    const m = w.match(/^\$?([A-Za-z][A-Za-z0-9]{1,11})$/);
    if (!m) break;
    out.push(m[1].toUpperCase());
  }
  return [...new Set(out)];
}

export function extractRules(text: string): SkillRules {
  const t = text.toLowerCase();
  const r: SkillRules = {};
  const e = parseEdits(text); if (e) r.edits = e;
  if (/\b(only|just)\s+sell\b[^.]{0,40}\b(profit|profitable|green|gains?)\b|\bnever sell\b[^.]{0,25}\b(at a |for a |in )?(loss|red)\b|\bdon.?t sell\b[^.]{0,20}\b(loss|red)\b/.test(t)) r.profitOnly = true;
  const never = text.match(/\b(?:never|don'?t|do not|stop)\s+(?:buy|trade|touch)(?:ing)?\s+([^.;\n]+)/i);
  if (never) { const s = syms(never[1]); if (s.length) r.neverBuy = s; }
  const only = text.match(/\bonly\s+(?:buy|trade)\s+([^.;\n]+)/i);
  if (only && !/\bsell\b/i.test(only[0])) { const s = syms(only[1]); if (s.length && s.length <= 50) r.onlyTrade = s; }
  const max = t.match(/\b(?:max(?:imum)?|no more than|at most|never more than|cap)\s*(?:of\s*)?\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|a|each)?\s*(?:trade|order|buy)/);
  if (max) r.maxTradeUsd = Number(max[1].replace(/,/g, ""));
  return r;
}

const describeRules = (r: SkillRules) => [
  r.edits ? `bots & agents: ${fmtEdit(r.edits)}` : null,
  r.profitOnly ? "only sell in profit" : null,
  r.neverBuy?.length ? `never buy ${r.neverBuy.join(", ")}` : null,
  r.onlyTrade?.length ? `only buy ${r.onlyTrade.join(", ")}` : null,
  r.maxTradeUsd ? `max $${r.maxTradeUsd} per buy` : null,
].filter(Boolean) as string[];

export const listSkills = (userId: string) => q<any>("SELECT * FROM skills WHERE user_id=$1 ORDER BY active DESC, created_at DESC", [userId]);

/** Create a skill, apply what Merod can enforce right away, and say what changed. */
export async function createSkill(userId: string, name: string, instructions: string) {
  const text = instructions.trim().slice(0, 2000);
  if (text.length < 3) throw new Error("Describe the skill, e.g. “always use a 5% stop-loss and never buy coins under $100k liquidity”.");
  const rules = extractRules(text);
  const row = await one<any>("INSERT INTO skills (user_id, name, instructions, rules) VALUES ($1,$2,$3,$4) RETURNING *",
    [userId, (name || text.split(/[.,;\n]/)[0]).trim().slice(0, 60), text, JSON.stringify(rules)]);
  const applied = await applyRules(userId, rules);
  return { skill: row, enforced: describeRules(rules), applied };
}

async function applyRules(userId: string, r: SkillRules) {
  const lines: string[] = [];
  if (r.edits) {
    const { parseTargets } = await import("./ai/bulk-edit");
    const targets = await parseTargets(userId, "all bots and agents");
    if (targets?.length) lines.push(...(await applyEdits(userId, targets, r.edits)));
  }
  if (r.profitOnly) { await q("UPDATE risk_settings SET sell_only_in_profit=true WHERE user_id=$1", [userId]); lines.push("• Sell only in profit: on"); }
  return lines;
}

export async function setSkillActive(userId: string, id: string, active: boolean) {
  const row = await one<any>("UPDATE skills SET active=$3, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId, active]);
  if (row && active) await applyRules(userId, row.rules ?? {});
  return row;
}
export const deleteSkill = (userId: string, id: string) => q("DELETE FROM skills WHERE id=$1 AND user_id=$2", [id, userId]);

/** The user's active skills as instructions for any AI answering or planning for them. */
export async function skillNotes(userId: string): Promise<string | null> {
  const rows = await q<any>("SELECT name, instructions FROM skills WHERE user_id=$1 AND active ORDER BY created_at LIMIT 30", [userId]).catch(() => []);
  if (!rows.length) return null;
  return `user_skills (the user's own standing instructions: follow them in how you interpret, reason, decide and plan):\n${rows.map((r: any) => `- ${r.name}: ${String(r.instructions).replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}`;
}

/** Merged enforceable rules of all active skills (used by the trading engine on every buy, and for new bots/agents). */
export async function activeRules(userId: string): Promise<SkillRules> {
  const rows = await q<any>("SELECT rules FROM skills WHERE user_id=$1 AND active", [userId]).catch(() => []);
  const out: SkillRules = {};
  for (const { rules: r } of rows) {
    if (r?.edits) out.edits = { ...(out.edits ?? {}), ...r.edits };
    if (r?.profitOnly) out.profitOnly = true;
    if (r?.neverBuy?.length) out.neverBuy = [...new Set([...(out.neverBuy ?? []), ...r.neverBuy])];
    if (r?.onlyTrade?.length) out.onlyTrade = [...new Set([...(out.onlyTrade ?? []), ...r.onlyTrade])];
    if (r?.maxTradeUsd) out.maxTradeUsd = Math.min(out.maxTradeUsd ?? Infinity, r.maxTradeUsd);
  }
  return out;
}

/** New bots and agents pick up the active skills' stop-loss / take-profit / amount / dip. */
export async function applySkillsToNew(userId: string, kind: "bot" | "agent", id: string, name: string) {
  const r = await activeRules(userId);
  if (r.edits) await applyEdits(userId, [{ kind, id, name }], r.edits).catch(() => {});
}

/** Prompt box: "create a skill: …", "add skill called Safe: …", "show my skills", "turn off skill Safe", "delete skill 2". */
export async function skillCommand(userId: string, raw: string): Promise<string | null> {
  const t = raw.trim();
  let make: { name: string; text: string } | null = null;
  const m1 = t.match(/^(?:please\s+)?(?:create|add|make|new|save|teach)\s+(?:me\s+)?(?:a\s+|the\s+)?(?:new\s+)?skill(?:\s+(?:called|named)\s+["“]?([^:"”]{1,60})["”]?)?\s*(?::|-|—|that|to|which|so)?\s*([\s\S]+)$/i);
  if (m1) make = { name: m1[1] ?? "", text: m1[2] };
  const m2 = !make && t.match(/^skill\s*:\s*([\s\S]+)$/i);
  if (m2) make = { name: "", text: m2[1] };
  if (make && make.text.trim().length >= 3) {
    const { skill, enforced, applied } = await createSkill(userId, make.name, make.text);
    return `Skill “${skill.name}” is on. Modo, OpenAI and Claude now follow it in every answer and plan.${enforced.length ? `\nMerod also enforces: ${enforced.join("; ")}.` : ""}${applied.length ? `\n${applied.join("\n")}` : ""}\nManage skills with the Skills button.`;
  }
  if (!/\bskills?\b/i.test(t)) return null;
  const rows = await listSkills(userId);
  const line = (r: any, i: number) => `${i + 1}. ${r.name}${r.active ? "" : " (off)"}: ${String(r.instructions).slice(0, 140)}`;
  if (/\b(show|list|what|my|see|view)\b/i.test(t) && !/\b(delete|remove|turn|disable|enable|pause|off|on)\b/i.test(t))
    return rows.length ? `Your skills:\n${rows.map(line).join("\n")}` : "No skills yet. Try “create a skill: always use a 5% stop-loss and only sell in profit”.";
  const act = /\b(delete|remove)\b/i.test(t) ? "delete" : /\b(turn off|disable|pause|off)\b/i.test(t) ? "off" : /\b(turn on|enable|on|resume)\b/i.test(t) ? "on" : null;
  if (!act) return null;
  const n = t.match(/\bskills?\s*#?(\d+)/i)?.[1];
  const pick = /\ball\b/i.test(t) ? rows : n ? rows.filter((_, i) => i === Number(n) - 1) : rows.filter((r) => t.toLowerCase().includes(String(r.name).toLowerCase()));
  if (!pick.length) return rows.length ? `Which skill?\n${rows.map(line).join("\n")}` : "You have no skills.";
  for (const r of pick) act === "delete" ? await deleteSkill(userId, r.id) : await setSkillActive(userId, r.id, act === "on");
  return `${act === "delete" ? "Deleted" : act === "on" ? "Turned on" : "Turned off"} ${pick.map((r) => `“${r.name}”`).join(", ")}.${act !== "on" ? " Settings it already changed on bots and agents stay as they are." : ""}`;
}
