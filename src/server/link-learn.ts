import "@/lib/server-only-shim";
import { one, q } from "./db";
import { addLink, processMaterial } from "./learning/materials";
import { parseEdits, parseTargets, applyEdits, fmtEdit, type Edit } from "./ai/bulk-edit";

/**
 * Learn from any link typed, pasted or dropped into a prompt box — YouTube videos (title, channel and captions when
 * YouTube serves them), news articles, blog posts, strategy pages.
 *
 * Every link is read once (safely: public sites only, size/time capped) and turned into lessons that every AI then
 * uses (Modo, ChatGPT, Claude, Auton, Momo). What else happens depends on the words around the link:
 *   learn / study (default)              → lessons saved and used from now on
 *   train / adjust / tune  + bots/<name> → the numbers in the lessons (stop-loss, take-profit, dip, $ per trade) are applied to them
 *   + skills / "as a skill"              → a skill is made from the lessons
 *   + auton                              → Auton gets the lessons as goals and focuses on the coins/stocks named
 *   + momo                               → Momo (the Advisor) studies it and gives tips from it
 *   copy / replicate / make a bot        → a bot that trades the strategy is prepared (follows the normal approval rules)
 *   execute / trade it / buy / sell      → the trade is prepared on the named coin/stock (follows the normal approval rules)
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+|\b(?:www\.)?(?:youtube\.com|youtu\.be|x\.com|twitter\.com|reddit\.com|medium\.com|substack\.com|coindesk\.com|cointelegraph\.com|bloomberg\.com|reuters\.com|cnbc\.com|investopedia\.com|tradingview\.com|finance\.yahoo\.com)\/[^\s<>"'`]+/gi;
export function extractLinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    let u = m[0].replace(/[),.;!?\]]+$/, "");
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    try { new URL(u); out.add(u); } catch { /* not a link */ }
  }
  return [...out].slice(0, 5);
}
export const hasLink = (text: string) => extractLinks(text).length > 0;

type Material = { id: string; kind: string; title: string; source_url: string; status: string; status_detail: string | null; summary: string | null; lessons: any[]; symbols: string[]; learned_by: string | null; tags: string[] };

/** Read (or reuse) one link and wait for its lessons. */
async function learnLink(userId: string, url: string): Promise<Material> {
  let id: string;
  try { id = await addLink(userId, url); }
  catch (e: any) {
    const prev = await one<{ id: string }>("SELECT id FROM training_materials WHERE user_id=$1 AND source_url=$2", [userId, url]);
    if (!prev) throw e;
    id = prev.id;
    await q("UPDATE training_materials SET active=true, status=CASE WHEN status='error' THEN 'queued' ELSE status END, attempts=CASE WHEN status='error' THEN 0 ELSE attempts END WHERE id=$1", [id]);
  }
  await Promise.race([processMaterial(id).catch(() => {}), new Promise((r) => setTimeout(r, 45_000))]);
  return (await one<Material>("SELECT id, kind, title, source_url, status, status_detail, summary, lessons, symbols, learned_by, tags FROM training_materials WHERE id=$1", [id]))!;
}

/** Numbers the lessons state (stop-loss, take-profit, dip, amount), first mention wins. */
export function lessonEdits(texts: string[]): Edit {
  const out: Edit = {};
  for (const t of texts) {
    const e: Edit = { ...(parseEdits(t) ?? {}) };
    // "a 4% dip", "4% pullback", "drops 5%", "dip of 3%"
    const dip = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:dip|drop|pull ?back|decline|correction)|(?:dips?|drops?|pull ?backs?|falls?)\s*(?:of|by)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (dip && e.dipPct === undefined) e.dipPct = Number(dip[1] ?? dip[2]);
    for (const k of ["stopLossPct", "takeProfitPct", "dipPct", "amountUsd"] as const) if (out[k] === undefined && e[k] !== undefined) out[k] = e[k];
  }
  return out;
}

/** Coins/stocks the material names that Merod can trade. */
async function knownSymbols(symbols: string[], extra: string) {
  const fromText = [...extra.toUpperCase().matchAll(/\$?\b([A-Z]{2,6})\b/g)].map((m) => m[1]);
  const want = [...new Set([...fromText, ...(symbols ?? []).map((s) => s.toUpperCase())])].slice(0, 40);
  if (!want.length) return [] as string[];
  const rows = await q<{ symbol: string }>("SELECT DISTINCT ON (upper(symbol)) upper(symbol) AS symbol FROM assets WHERE upper(symbol) = ANY($1::text[]) AND last_price > 0", [want]).catch(() => []);
  const found = new Set(rows.map((r) => r.symbol));
  return want.filter((s) => found.has(s));
}

export type LinkResult = { summary: string; followUp?: string };

export async function linkCommand(userId: string, text: string, opts: { momo?: boolean } = {}): Promise<LinkResult | null> {
  const links = extractLinks(text);
  if (!links.length) return null;
  const words = links.reduce((t, l) => t.split(l).join(" ").split(l.replace(/^https:\/\//, "")).join(" "), text).replace(/\s+/g, " ").trim();
  const w = words.toLowerCase();
  const wantCopy = /\b(copy|replicate|mimic|clone|make (?:a |me a )?bot|create (?:a )?bot|build (?:a )?bot|turn (?:it|this) into a bot)\b/.test(w);
  const wantExec = /\b(execute|trade (?:it|this|on it|that)|act on it|do (?:it|what it says)|buy|sell|place (?:the |a )?trade)\b/.test(w);
  const wantAdjust = /\b(train|teach|adjust|tune|update|apply|change|improve|optimi[sz]e)\b/.test(w);
  const toBots = /\b(bots?|agents?|everything|all)\b/.test(w);
  const toSkills = /\bskills?\b/.test(w);
  const toAuton = /\bauton\b/.test(w);
  const toMomo = opts.momo || /\bmomo\b|\badvis(?:or|er)\b/.test(w);

  const lines: string[] = [];
  const mats: Material[] = [];
  for (const url of links) {
    try { mats.push(await learnLink(userId, url)); }
    catch (e: any) { lines.push(`✗ ${url.slice(0, 80)} — couldn't read it: ${e.message}`); }
  }
  if (!mats.length) return { summary: lines.join("\n") + "\nTry another link, or paste the text you want Merod to learn from." };

  const allRules = mats.flatMap((m) => (m.lessons ?? []).map((l: any) => String(l.rule ?? "")).filter(Boolean));
  const syms = await knownSymbols(mats.flatMap((m) => m.symbols ?? []), `${words} ${mats.map((m) => m.title).join(" ")}`);
  const edits = lessonEdits([words, ...allRules]);

  for (const m of mats) {
    const by = m.learned_by?.startsWith("anthropic:") ? "Claude" : m.learned_by?.startsWith("openai:") ? "ChatGPT" : "Merod's rule reader";
    lines.push(`📚 Learned from “${m.title}” (${m.kind === "youtube" ? "YouTube" : new URL(m.source_url).hostname.replace(/^www\./, "")} · read by ${by})`);
    if (m.summary) lines.push(m.summary.replace(/\s+/g, " ").slice(0, 500));
    const ls = (m.lessons ?? []).slice(0, 6);
    if (ls.length) { lines.push("Lessons:"); for (const l of ls) lines.push(`• ${String(l.rule).replace(/\s+/g, " ").slice(0, 220)}`); }
    else if (m.status_detail) lines.push(m.status_detail);
  }
  if (syms.length) lines.push(`Coins/stocks it talks about: ${syms.slice(0, 10).join(", ")}`);
  if (Object.keys(edits).length) lines.push(`Numbers it uses: ${fmtEdit(edits)}`);

  // Everyone learns, Momo included: tag it so the Advisor turns it into tips.
  for (const m of mats) await q("UPDATE training_materials SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || ARRAY['momo']) t) WHERE id=$1", [m.id]).catch(() => {});

  const did: string[] = [];
  // Train / adjust bots & agents.
  if (wantAdjust && (toBots || (!toSkills && !toAuton && !toMomo))) {
    const named = await parseTargets(userId, words).catch(() => null);
    const targets = named?.length ? named : await parseTargets(userId, "all bots and agents").catch(() => null);
    if (targets?.length && Object.keys(edits).length) {
      const res = await applyEdits(userId, targets, edits);
      did.push(`Trained ${targets.length} bot${targets.length === 1 ? "" : "s"}/agent${targets.length === 1 ? "" : "s"} with ${fmtEdit(edits)}:`, ...res.map((l) => `  ${l}`));
    } else if (targets?.length) {
      for (const t of targets.filter((x) => x.kind === "bot")) await q("UPDATE trading_bots SET auto_training='on' WHERE id=$1 AND user_id=$2", [t.id, userId]).catch(() => {});
      did.push(`No exact numbers in it to copy, so Auto trainer is now on for ${targets.length} bot${targets.length === 1 ? "" : "s"} and they'll use these lessons as guidance.`);
    } else did.push("You have no bots or agents to train yet — say “copy this” to make one from it.");
  }
  // Skills.
  if (toSkills) {
    const { createSkill } = await import("./skills");
    const body = [`From ${mats.map((m) => `“${m.title}”`).join(", ")}:`, ...allRules.slice(0, 8)].join(" ").slice(0, 1900);
    try {
      const r = await createSkill(userId, `Learned: ${mats[0].title}`.slice(0, 60), allRules.length ? body : `${body} ${mats.map((m) => m.summary ?? "").join(" ")}`.slice(0, 1900));
      did.push(`Made a skill “${r.skill.name}”${r.enforced?.length ? ` (enforces: ${r.enforced.join("; ")})` : ""}.`, ...(r.applied ?? []).map((l: string) => `  ${l}`));
    } catch (e: any) { did.push(`Couldn't make a skill: ${e.message}`); }
  }
  // Auton.
  if (toAuton) {
    const s = await one<any>("SELECT goals, memory FROM auton_settings WHERE user_id=$1", [userId]);
    const goal = `Learned from ${mats.map((m) => m.title).join(", ").slice(0, 120)}${syms.length ? ` — focus on ${syms.slice(0, 6).join(", ")}` : ""}${Object.keys(edits).length ? ` — use ${fmtEdit(edits)}` : ""}`;
    const goals = [goal, String(s?.goals ?? "")].filter(Boolean).join("\n").slice(0, 1000);
    const memory = { ...(s?.memory ?? {}), lessons: [...allRules.slice(0, 10), ...((s?.memory?.lessons as string[]) ?? [])].slice(0, 30), focus_symbols: syms.slice(0, 10) };
    await q(`INSERT INTO auton_settings (user_id, goals, memory) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET goals=$2, memory=$3`, [userId, goals, JSON.stringify(memory)]);
    did.push(`Auton trained: new goal “${goal.slice(0, 160)}”. It uses these lessons on its next check.`);
  }
  if (toMomo) did.push("Momo studied it and will give you tips from it in the Advisor.");

  // Copy → a bot; execute → a trade. Both go through the normal prompt pipeline (same approvals and limits).
  const amt = Number(words.match(/\$\s?(\d[\d,]*(?:\.\d+)?)/)?.[1]?.replace(/,/g, "") ?? edits.amountUsd ?? 100);
  const sym = syms[0];
  let followUp: string | undefined;
  if ((wantCopy || wantExec) && !sym) did.push("It doesn't name a coin or stock Merod can trade, so tell me which one (e.g. “copy this on SOL”).");
  else if (wantCopy) followUp = `buy $${amt} of ${sym} at a ${edits.dipPct ?? 3}% dip and sell at a ${edits.takeProfitPct ?? 5}% increase${edits.stopLossPct ? `, stop loss ${edits.stopLossPct}%` : ""}, then repeat`;
  else if (wantExec) followUp = /\bsell\b/.test(w) ? `sell ${sym}` : `buy $${amt} of ${sym}${edits.stopLossPct ? ` with a ${edits.stopLossPct}% stop loss` : ""}${edits.takeProfitPct ? ` and ${edits.takeProfitPct}% take profit` : ""}`;
  if (followUp) did.push(`${wantCopy ? "Copying its strategy into a bot" : "Acting on it"}: “${followUp}”.`);

  if (did.length) lines.push("", "Done:", ...did);
  lines.push("", "Every AI (Modo, ChatGPT, Claude, Auton and Momo) now uses these lessons." + (did.length ? "" : " Say “train my bots on it”, “make it a skill”, “train Auton on it”, “copy this” or “trade it” to act on it."));
  return { summary: lines.join("\n"), followUp };
}
