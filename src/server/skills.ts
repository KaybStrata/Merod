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

export type Kind = "skill" | "point" | "rule";
export type RuleScope = "all" | "bots" | "bot" | "prompts";
const LIVE = "(expires_at IS NULL OR expires_at > now())";
export const listSkills = (userId: string) => q<any>(`SELECT s.*, (s.expires_at IS NOT NULL AND s.expires_at <= now()) AS expired,
       (SELECT name FROM trading_bots b WHERE b.id::text = s.scope_ref UNION ALL SELECT name FROM agents a WHERE a.id::text = s.scope_ref LIMIT 1) AS scope_name
  FROM skills s WHERE s.user_id=$1 ORDER BY s.kind, s.active DESC, s.created_at DESC`, [userId]);

/** Which trades a rule covers, in words. */
export const scopeLabel = (scope?: string | null, name?: string | null) =>
  scope === "bot" ? `only ${name ?? "one bot"}` : scope === "bots" ? "all bots" : scope === "prompts" ? "prompted trades" : "everything (Modo / Merod trading)";

/** SQL: rows that apply to an order from `source` (and bot/agent `ref`). Skills and points always apply; rules only to what they target. */
const appliesSql = (sourceParam: string, refParam: string) =>
  `(kind <> 'rule' OR scope = 'all' OR (scope = 'bots' AND ${sourceParam} IN ('bot','agent')) OR (scope = 'prompts' AND ${sourceParam} = 'prompt') OR (scope = 'bot' AND scope_ref = ${refParam}))`;

/** Create a rule for one bot, all bots, prompted trades or everything. Its stop-loss / take-profit / amount / dip go to the bots it covers. */
export async function createRule(userId: string, name: string, instructions: string, scope: RuleScope, scopeRef?: string | null) {
  const text = instructions.trim().slice(0, 2000);
  if (text.length < 3) throw new Error("Write the rule, e.g. “stop loss 5%, never buy BONK, max $50 per trade”.");
  if (scope === "bot" && !scopeRef) throw new Error("Pick which bot this rule is for.");
  const rules = extractRules(text);
  const row = await one<any>("INSERT INTO skills (user_id, name, instructions, rules, kind, scope, scope_ref) VALUES ($1,$2,$3,$4,'rule',$5,$6) RETURNING *",
    [userId, (name || text.split(/[.,;\n]/)[0]).trim().slice(0, 60), text, JSON.stringify(rules), scope, scope === "bot" ? scopeRef : null]);
  const applied = await applyRuleEdits(userId, row);
  return { skill: row, enforced: describeRules(rules), applied };
}

/** A rule's numbers go to the bots it covers (not to everything, like a skill's). */
async function applyRuleEdits(userId: string, row: any) {
  const r: SkillRules = row.rules ?? {};
  if (!r.edits || row.scope === "prompts") return [] as string[];
  const { parseTargets } = await import("./ai/bulk-edit");
  let targets: { kind: "bot" | "agent"; id: string; name: string }[] = [];
  if (row.scope === "bot") {
    const t = await one<any>("SELECT 'bot' AS kind, id, name FROM trading_bots WHERE id::text=$1 AND user_id=$2 UNION ALL SELECT 'agent', id, name FROM agents WHERE id::text=$1 AND user_id=$2 LIMIT 1", [row.scope_ref, userId]);
    if (t) targets = [t];
  } else targets = ((await parseTargets(userId, "all bots and agents")) ?? []) as any;
  return targets.length ? applyEdits(userId, targets, r.edits) : [];
}

/** "for 2 hours", "for today", "for 3 days", "this week", "until friday" → when a Point stops applying (null = until you remove it). */
export function parseExpiry(text: string, tz = "UTC", now = new Date()): Date | null {
  const t = text.toLowerCase();
  const n = t.match(/\bfor (?:the next )?(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/);
  if (n) { const v = Number(n[1]); const mult = /^m/.test(n[2]) ? 60_000 : /^h/.test(n[2]) ? 3_600_000 : /^d/.test(n[2]) ? 86_400_000 : 604_800_000; return new Date(now.getTime() + v * mult); }
  const endOfLocalDay = (addDays: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
    const minsLeft = (24 - Number(p.hour)) * 60 - Number(p.minute) + addDays * 1440;
    return new Date(now.getTime() + minsLeft * 60_000);
  };
  if (/\b(for )?today\b|\buntil (the )?(end of (the )?day|tonight|close)\b/.test(t)) return endOfLocalDay(0);
  if (/\b(for )?tomorrow\b|\buntil tomorrow\b/.test(t)) return endOfLocalDay(1);
  if (/\b(for )?this week\b|\buntil (the )?(end of (the )?week|weekend)\b/.test(t)) return endOfLocalDay(6 - new Date(now.toLocaleString("en-US", { timeZone: tz })).getDay());
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const until = t.match(/\buntil (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (until) { const today = new Date(now.toLocaleString("en-US", { timeZone: tz })).getDay(); const d = (days.indexOf(until[1]) - today + 7) % 7 || 7; return endOfLocalDay(d - 1); }
  return null;
}

/** Create a skill or point, apply what Merod can enforce right away, and say what changed. */
export async function createSkill(userId: string, name: string, instructions: string, kind: Kind = "skill", tz = "UTC") {
  const text = instructions.trim().slice(0, 2000);
  if (text.length < 3) throw new Error(kind === "point" ? "Write the instruction, e.g. “focus on Solana meme coins with rising volume today”." : "Describe the skill, e.g. “always use a 5% stop-loss and never buy coins under $100k liquidity”.");
  const rules = extractRules(text);
  const expires = kind === "point" ? parseExpiry(text, tz) : null;
  const row = await one<any>("INSERT INTO skills (user_id, name, instructions, rules, kind, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [userId, (name || text.split(/[.,;\n]/)[0]).trim().slice(0, 60), text, JSON.stringify(rules), kind, expires]);
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
  if (row && active) { if (row.kind === "rule") await applyRuleEdits(userId, row); else await applyRules(userId, row.rules ?? {}); }
  return row;
}
/** Edit a skill or point. Its enforced rules are re-read from the new text; nothing is applied unless it's on. */
export async function updateSkill(userId: string, id: string, p: { name?: string; instructions?: string }) {
  const cur = await one<any>("SELECT * FROM skills WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!cur) throw new Error("Not found");
  const text = (p.instructions ?? cur.instructions).trim().slice(0, 2000);
  if (text.length < 3) throw new Error("Write the instruction first");
  const rules = extractRules(text);
  return one<any>("UPDATE skills SET name=$3, instructions=$4, rules=$5, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",
    [id, userId, (p.name ?? cur.name).trim().slice(0, 60) || cur.name, text, JSON.stringify(rules)]);
}
export const deleteSkill = (userId: string, id: string) => q("DELETE FROM skills WHERE id=$1 AND user_id=$2", [id, userId]);

/** Active skills and points as instructions for any AI answering or planning for the user. */
export async function skillNotes(userId: string): Promise<string | null> {
  const rows = await q<any>(`SELECT kind, name, instructions, expires_at, scope, (SELECT name FROM trading_bots b WHERE b.id::text = skills.scope_ref LIMIT 1) AS scope_name FROM skills WHERE user_id=$1 AND active AND ${LIVE} ORDER BY kind DESC, created_at LIMIT 40`, [userId]).catch(() => []);
  if (!rows.length) return null;
  const sk = rows.filter((r: any) => r.kind === "skill"), pt = rows.filter((r: any) => r.kind === "point"), ru = rows.filter((r: any) => r.kind === "rule");
  const out: string[] = [];
  if (sk.length) out.push(`user_skills (the user's own standing instructions: follow them in how you interpret, reason, decide and plan):\n${sk.map((r: any) => `- ${r.name}: ${String(r.instructions).replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}`);
  if (pt.length) out.push(`user_points (specific instructions from the user that apply right now; they take priority over general habits):\n${pt.map((r: any) => `- ${String(r.instructions).replace(/\s+/g, " ").slice(0, 400)}${r.expires_at ? ` (until ${new Date(r.expires_at).toISOString()})` : ""}`).join("\n")}`);
  if (ru.length) out.push(`user_rules (the user's rules, each for a specific target; apply each only to what it targets):\n${ru.map((r: any) => `- [${scopeLabel(r.scope, r.scope_name)}] ${r.name}: ${String(r.instructions).replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}`);
  return out.join("\n\n");
}

/** Merged enforceable rules of all active skills and live points (checked by the trading engine on every buy, and for new bots/agents). */
export async function activeRules(userId: string, ctx?: { source?: string | null; ref?: string | null }): Promise<SkillRules> {
  const rows = await q<any>(`SELECT rules FROM skills WHERE user_id=$1 AND active AND ${LIVE} AND ${appliesSql("$2::text", "$3::text")}`, [userId, ctx?.source ?? null, ctx?.ref ?? null]).catch(() => []);
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

/**
 * Prompt box: "create a skill: …", "create a point: …" (or "point: …"), "show my skills / points",
 * "turn off skill Safe", "delete point 2".
 */
export async function skillCommand(userId: string, raw: string, tz = "UTC"): Promise<string | null> {
  const t = raw.trim();
  let make: { name: string; text: string; kind: Kind } | null = null;
  const m1 = t.match(/^(?:please\s+)?(?:create|add|make|new|save|teach|set)\s+(?:me\s+)?(?:a\s+|the\s+)?(?:new\s+)?(skill|point)(?:\s+(?:called|named)\s+["“]?([^:"”]{1,60})["”]?)?\s*(?::|-|—|that|to|which|so)?\s*([\s\S]+)$/i);
  if (m1) make = { kind: m1[1].toLowerCase() as Kind, name: m1[2] ?? "", text: m1[3] };
  const m2 = !make && t.match(/^(skill|point)\s*:\s*([\s\S]+)$/i);
  if (m2) make = { kind: m2[1].toLowerCase() as Kind, name: "", text: m2[2] };
  const mr = t.match(/^(?:please\s+)?(?:(?:create|add|make|new|save|set)\s+(?:me\s+)?(?:a\s+|the\s+)?(?:new\s+)?)?rule(?:\s+(?:called|named)\s+["“]?([^:"”]{1,60})["”]?)?(?:\s+for\s+([^:]{1,80}?))?\s*(?::|-|—|that|to)\s*([\s\S]+)$/i);
  if (mr && mr[3].trim().length >= 3) {
    const target = (mr[2] ?? "").trim().toLowerCase();
    let scope: RuleScope = "all", ref: string | null = null, label = "everything";
    if (/^(all\s+)?(my\s+)?(bots|ai bots|agents)$/.test(target)) { scope = "bots"; label = "all bots"; }
    else if (/^(all\s+)?(my\s+)?(prompts?|prompted trades|chat|prompt trades)$/.test(target)) { scope = "prompts"; label = "prompted trades"; }
    else if (target && !/^(everything|all|merod|modo|trading|all trading)$/.test(target)) {
      const { parseTargets } = await import("./ai/bulk-edit");
      const tg = await parseTargets(userId, target).catch(() => null);
      if (!tg?.length) return `I couldn't find a bot called “${mr[2]}”. Say “rule for <bot name>: …”, “rule for all bots: …”, “rule for prompts: …” or “rule: …” (everything).`;
      scope = "bot"; ref = tg[0].id; label = tg[0].name;
    }
    const { skill, enforced, applied } = await createRule(userId, mr[1] ?? "", mr[3], scope, ref);
    return `Rule “${skill.name}” is on for ${label}.${enforced.length ? `\nMerod enforces: ${enforced.join("; ")} — on ${label} only.` : ""}${applied.length ? `\n${applied.join("\n")}` : ""}\nManage rules in Skills → Rules.`;
  }
  if (make && make.text.trim().length >= 3) {
    const { skill, enforced, applied } = await createSkill(userId, make.name, make.text, make.kind, tz);
    const head = make.kind === "point"
      ? `Point set: “${skill.instructions}”.${skill.expires_at ? ` Applies until ${new Date(skill.expires_at).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : " Applies until you remove it."} Modo, OpenAI, Claude, bots and agents follow it in every decision.`
      : `Skill “${skill.name}” is on. Modo, OpenAI and Claude now follow it in every answer and plan.`;
    return `${head}${enforced.length ? `\nMerod also enforces: ${enforced.join("; ")}.` : ""}${applied.length ? `\n${applied.join("\n")}` : ""}\nManage ${make.kind}s with the Skills button.`;
  }
  // "turn off/on all skills" (without naming points) covers points too: the Skills menu holds both.
  if (/\ball\b/i.test(t) && /\bskills?\b/i.test(t) && !/\bpoints?\b/i.test(t) && /\b(turn off|disable|pause|off|turn on|enable|resume)\b/i.test(t)) {
    const on = /\b(turn on|enable|resume)\b/i.test(t) && !/\b(turn off|disable|pause)\b/i.test(t);
    const all = await listSkills(userId);
    const pick = all.filter((r) => r.active !== on);
    for (const r of pick) await setSkillActive(userId, r.id, on);
    const ns = pick.filter((r) => r.kind !== "point").length, np = pick.length - ns;
    if (!pick.length) return `All your skills and points are already ${on ? "on" : "off"}.`;
    return `Turned ${on ? "on" : "off"} ${ns} skill${ns === 1 ? "" : "s"} and ${np} point${np === 1 ? "" : "s"}.${on ? "" : " Nothing was deleted (say “turn on all skills” to bring them back), and settings they already changed on bots and agents stay as they are."}`;
  }
  const kindWord = /\brules?\b/i.test(t) && !/\bauton rules\b/i.test(t) ? "rule" : /\bpoints?\b/i.test(t) ? "point" : /\bskills?\b/i.test(t) ? "skill" : null;
  if (!kindWord) return null;
  const rows = (await listSkills(userId)).filter((r) => r.kind === kindWord);
  const line = (r: any, i: number) => `${i + 1}. ${r.kind === "point" ? "" : `${r.name}: `}${String(r.instructions).slice(0, 140)}${!r.active ? " (off)" : r.expired ? " (expired)" : r.expires_at ? ` (until ${new Date(r.expires_at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : ""}`;
  if (/\b(show|list|what|my|see|view)\b/i.test(t) && !/\b(delete|remove|turn|disable|enable|pause|off|on|clear)\b/i.test(t))
    return rows.length ? `Your ${kindWord}s:\n${rows.map(line).join("\n")}` : kindWord === "point" ? "No points yet. Try “create a point: focus on Solana meme coins with rising volume today”." : "No skills yet. Try “create a skill: always use a 5% stop-loss and only sell in profit”.";
  const act = /\b(delete|remove|clear)\b/i.test(t) ? "delete" : /\b(turn off|disable|pause|off)\b/i.test(t) ? "off" : /\b(turn on|enable|on|resume)\b/i.test(t) ? "on" : null;
  if (!act) return null;
  const n = t.match(/\b(?:skills?|points?)\s*#?(\d+)/i)?.[1];
  const pick = /\ball\b/i.test(t) ? rows : n ? rows.filter((_, i) => i === Number(n) - 1) : rows.filter((r) => t.toLowerCase().includes(String(r.name).toLowerCase()));
  if (!pick.length) {
    if (rows.length) return `Which ${kindWord}?\n${rows.map(line).join("\n")}`;
    // No skills, but points exist (they live in the same Skills menu and can block coins too): say so instead of "no skills".
    const other = (await listSkills(userId)).filter((r) => r.kind !== kindWord && r.active);
    return other.length
      ? `You have no ${kindWord}s, but ${other.length} ${kindWord === "skill" ? "point" : "skill"}${other.length === 1 ? " is" : "s are"} on (Skills menu → ${kindWord === "skill" ? "Points" : "Skills"} tab)${other.some((r) => r.rules?.neverBuy?.length) ? `, including never-buy rules for ${[...new Set(other.flatMap((r) => r.rules?.neverBuy ?? []))].slice(0, 8).join(", ")}` : ""}. Say “turn off all skills” to turn those off too.`
      : `You have no ${kindWord}s.`;
  }
  for (const r of pick) act === "delete" ? await deleteSkill(userId, r.id) : await setSkillActive(userId, r.id, act === "on");
  return `${act === "delete" ? "Deleted" : act === "on" ? "Turned on" : "Turned off"} ${pick.map((r) => `“${r.kind === "point" ? String(r.instructions).slice(0, 60) : r.name}”`).join(", ")}.${act !== "on" ? " Settings it already changed on bots and agents stay as they are." : ""}`;
}
