import "@/lib/server-only-shim";
import { z } from "zod";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { roleById, ROLE_IDS, STRATEGY_LABEL, type StrategyKind } from "./catalog";
import { agentAction, cancelAgentOrders, closeAgentPositions, createAgent, emit, metricsFor, postMessage, resolveAssetRefs } from "./service";

/**
 * MEROD FLEET — one master prompt → a reviewed fleet of specialist agents (spec §04).
 * 1 parse & clarify → 2 draft fleet → 3 review capital → 4 validate & approve → 5 start paper workers → 6 monitor.
 * The planner is deterministic (no AI call is needed to draft, and nothing it reads can grant execution rights):
 * scanning and wallet monitoring stay read-only unless trading is explicitly requested for them; a budget suggestion
 * never implies execution rights. Nothing starts until the user approves the whole configuration.
 */
const NAMES: Record<string, string> = {
  solana: "SOL", sol: "SOL", bitcoin: "BTC", btc: "BTC", ethereum: "ETH", ether: "ETH", eth: "ETH", nvidia: "NVDA", tesla: "TSLA", apple: "AAPL", microsoft: "MSFT",
  amazon: "AMZN", google: "GOOGL", alphabet: "GOOGL", meta: "META", amd: "AMD", dogecoin: "DOGE", doge: "DOGE", ripple: "XRP", xrp: "XRP", cardano: "ADA", bonk: "BONK", pepe: "PEPE",
  coinbase: "COIN", netflix: "NFLX", palantir: "PLTR", broadcom: "AVGO", tsmc: "TSM", spy: "SPY", qqq: "QQQ", chainlink: "LINK", avalanche: "AVAX", litecoin: "LTC", sui: "SUI",
};
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const STOP = new Set(["I", "A", "AN", "AND", "OR", "THE", "TO", "OF", "IN", "ON", "MY", "ALL", "USD", "PNL", "P&L", "AI", "ONE", "FOR", "AT", "IF", "BY", "IT", "BE", "DO", "NO", "UP", "SO", "AS", "IS", "API"]);

export interface DraftAgent { key: string; name: string; role: string; assets: string[]; strategy?: { kind: StrategyKind; [k: string]: unknown }; autonomy: number; capitalUsd: number; instructions: string; dependsOn: string[]; wallets?: string[]; scan?: any }
export interface FleetDraft { name: string; prompt: string; operationMode: "independent" | "parallel" | "collaborative" | "competition" | "supervisor" | "sequential"; capitalUsd: number; reserveUsd: number; dailyLossPct: number; agents: DraftAgent[]; notes: string[]; missing: string[]; competition?: { days: number; capitalEach: number } }

const money = (s: string) => { const m = s.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d+)?)\s*(k|m)?/i); if (!m) return null; return Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1); };
const countOf = (s: string) => { const m = s.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:independent\s+|separate\s+|different\s+|specialist\s+|parallel\s+|ai\s+|new\s+)*agents?\b/i); return m ? (NUM[m[1].toLowerCase()] ?? Number(m[1])) : null; };

/** Pull asset symbols out of free text (names → tickers, $TICKER, and capitalised tickers that exist in Merod). */
async function assetsIn(text: string): Promise<string[]> {
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) if (NAMES[w]) add(NAMES[w]);
  for (const m of text.match(/\$?[A-Z]{2,6}\b/g) ?? []) {
    const s = m.replace("$", "");
    if (STOP.has(s) || out.includes(s)) continue;
    const ok = await one("SELECT 1 FROM assets WHERE upper(symbol)=$1 AND NOT ('demo_data'=ANY(risk_flags)) LIMIT 1", [s]);
    if (ok) add(s);
  }
  return out;
}
async function isCrypto(sym: string) { return !!(await one("SELECT 1 FROM assets WHERE upper(symbol)=$1 AND asset_class='crypto' LIMIT 1", [sym])); }

function roleFor(clause: string): string | null {
  const c = clause.toLowerCase();
  if (/supervis|oversee|coordinat/.test(c)) return "supervisor";
  if (/\bwallet/.test(c) && /mimic|copy|mirror|replicat/.test(c) && /trade|execut|mimic trad/.test(c)) return "mimic";
  if (/\bwallet/.test(c)) return "wallet_tracking";
  if (/counter|devil|bear case|challenge/.test(c)) return "counterargument";
  if (/earnings/.test(c)) return "earnings";
  if (/macro|economic|inflation|rates\b/.test(c)) return "macro";
  if (/sentiment|social/.test(c)) return "social_sentiment";
  if (/\bnews|article|headline/.test(c)) return "news";
  if (/risk|defen[cs]e|concentration|drawdown|exposure/.test(c)) return "risk_management";
  if (/portfolio|rebalanc/.test(c)) return "portfolio";
  if (/backtest/.test(c)) return "backtesting";
  if (/arbitrage/.test(c)) return "arbitrage";
  if (/snip|new listing|newly listed|launch/.test(c)) return "sniping";
  if (/meme/.test(c) && /trade|buy|snipe/.test(c)) return "memecoin";
  if (/technical|indicator|rsi|macd|chart/.test(c)) return "technical_analysis";
  if (/fundamental|valuation|balance sheet/.test(c)) return "fundamental_analysis";
  if (/exit|take.?profit|stop.?loss/.test(c) && !/trade/.test(c)) return "exit";
  if (/scan|screen|search|find|discover|monitor|watch|track/.test(c)) return "market_scanner";
  if (/trade|trading|buy|sell|accumulat|swing|momentum|dca/.test(c)) return "trade";
  return null;
}
function strategyFrom(clause: string): StrategyKind | null {
  const c = clause.toLowerCase();
  if (/mean.?reversion|oversold/.test(c)) return "mean_reversion";
  if (/breakout/.test(c)) return "breakout";
  if (/\bdip/.test(c)) return "dip";
  if (/dca|accumulat|recurring/.test(c)) return "dca";
  if (/news.?(reaction|driven|based)/.test(c)) return "news";
  if (/momentum|trend/.test(c)) return "momentum";
  return null;
}
const COMPETE_KINDS: StrategyKind[] = ["momentum", "mean_reversion", "news", "breakout", "dip", "dca"];

export async function planFleet(prompt: string): Promise<FleetDraft> {
  const text = prompt.trim();
  if (text.length < 8) throw new HttpError(422, "Describe the fleet you want, for example: create 3 agents to trade SOL, BTC and ETH in paper mode");
  const notes: string[] = [], missing: string[] = [];
  const total = money(text.match(/(?:allocate|give|with|budget|capital|fund)[^.]*?\$\s?[\d,.]+\s*[km]?/i)?.[0] ?? "") ?? money(text);
  const eachMatch = text.match(/\$\s?([\d,.]+\s*[km]?)\s*(?:in virtual funds\s*)?(?:each|per agent|apiece)|each\s+(?:with\s+)?\$\s?([\d,.]+\s*[km]?)/i);
  const each = eachMatch ? money(`$${(eachMatch[1] ?? eachMatch[2]).trim()}`) : null;
  const loss = text.match(/(\d+(?:\.\d+)?)\s*%[^.]*?(?:daily\s+)?loss|loss(?:es)?[^.]*?(\d+(?:\.\d+)?)\s*%/i);
  const dailyLossPct = loss ? Math.min(100, Number(loss[1] ?? loss[2])) : 2;
  if (!loss) notes.push("No daily loss limit given: using 2% of fleet capital (blocks new risk-increasing orders)");
  const daysM = text.match(/(\d{1,3})\s*days?/i);
  const lower = text.toLowerCase();
  if (/\blive\b|real money/.test(lower)) notes.push("Live trading can't be switched on from a prompt: this fleet runs in paper mode");
  const authorizeReadOnlyTrading = /(and|then) (trade|execute|mimic)|authori[sz]e (trading|execution|mimic)/.test(lower);

  const agents: DraftAgent[] = [];
  const push = (a: Omit<DraftAgent, "key" | "dependsOn" | "instructions" | "autonomy" | "capitalUsd"> & Partial<DraftAgent>) => {
    const def = roleById(a.role)!;
    agents.push({ key: `a${agents.length + 1}`, dependsOn: [], capitalUsd: 0, instructions: def.defaultInstructions, autonomy: def.trades ? 5 : 1, ...a });
  };
  const tradeAgentFor = async (sym: string, clause: string, kind?: StrategyKind | null) => {
    const crypto = await isCrypto(sym);
    const k = kind ?? strategyFrom(clause) ?? "momentum";
    push({ name: `${sym} ${STRATEGY_LABEL[k].split(" ")[0]}`, role: crypto ? (/meme/.test(clause.toLowerCase()) ? "memecoin" : "crypto_trading") : "stock_trading", assets: [sym], strategy: { kind: k }, instructions: `Trade ${sym} (${STRATEGY_LABEL[k].toLowerCase()}). ${clause.trim()}`.slice(0, 400) });
  };

  const n = countOf(text);
  const segments = text.split(/(?:[,;.]|\band\b)?\s*\b(?:one|another|a final one|the last one|the fifth|the fourth)\s+(?:agent\s+)?(?:to|that|for)\s+/i).slice(1);
  let mode: FleetDraft["operationMode"] = "parallel";
  let competition: FleetDraft["competition"];

  if (segments.length >= 2) {
    // "one to trade Solana, one to trade Bitcoin, one to scan NVIDIA and Tesla, one to monitor wallets, one to supervise all four"
    for (const seg of segments) {
      const role = roleFor(seg);
      const syms = await assetsIn(seg);
      if (role === "trade" || role === "memecoin") { if (syms.length) for (const s of syms) await tradeAgentFor(s, seg); else missing.push(`Which asset should "${seg.trim().slice(0, 50)}" trade?`); }
      else if (role === "supervisor") push({ name: "Risk Supervisor", role: "supervisor", assets: [] });
      else if (role === "wallet_tracking") push({ name: /solana/i.test(seg) ? "Solana Wallet Tracker" : "Wallet Tracker", role: "wallet_tracking", assets: [], instructions: seg.trim().slice(0, 400) });
      else if (role) push({ name: `${syms.slice(0, 3).join(" & ") || roleById(role)!.name} ${roleById(role)!.name.split(" ")[0] === (syms[0] ?? "") ? "" : roleById(role)!.name}`.replace(/\s+/g, " ").trim().slice(0, 60), role, assets: syms, instructions: seg.trim().slice(0, 400) });
      else notes.push(`Skipped unclear instruction: "${seg.trim().slice(0, 60)}"`);
    }
  } else if (/same asset|different strateg|compare (their|the)|compete|competition|arena/.test(lower)) {
    // Competitive strategy testing
    mode = "competition";
    const syms = await assetsIn(text);
    const sym = syms[0];
    if (!sym) missing.push("Which asset should the competing agents trade?");
    const count = Math.min(6, n ?? 5);
    const capEach = each ?? (total ? total / count : 10_000);
    competition = { days: daysM ? Math.min(365, Number(daysM[1])) : 30, capitalEach: capEach };
    for (let i = 0; i < count; i++) {
      const k = COMPETE_KINDS[i % COMPETE_KINDS.length];
      push({ name: `${sym ?? "Asset"} ${STRATEGY_LABEL[k]}`, role: sym && !(await isCrypto(sym)) ? "stock_trading" : "crypto_trading", assets: sym ? [sym] : [], strategy: { kind: k }, capitalUsd: capEach, instructions: `Arena entrant: trade ${sym ?? "the asset"} with ${STRATEGY_LABEL[k].toLowerCase()}.` });
    }
  } else if (/wallet/.test(lower) && n && n > 1) {
    for (let i = 0; i < Math.min(12, n); i++) push({ name: `Wallet Tracker ${i + 1}`, role: "wallet_tracking", assets: [], instructions: "Monitor one public Solana wallet; evaluate realised performance, liquidity, consistency and drawdown; flag eligible mimic opportunities for review." });
    missing.push(`Add the ${Math.min(12, n)} public wallet addresses (one per tracker) before approving`);
  } else {
    const syms = await assetsIn(text);
    const roleWords: [RegExp, string, string][] = [
      [/\bstocks?\b.*news|news.*\bstocks?\b/, "news", "Stocks News"], [/crypto.*news|news.*crypto/, "news", "Crypto News"], [/economic|macro/, "macro", "Macro"],
      [/sentiment|social/, "social_sentiment", "Social Sentiment"], [/risk|defen[cs]e|concentration|abnormal loss/, "risk_management", "Portfolio Defense"],
      [/scan|screen/, "market_scanner", "Market Scanner"], [/earnings/, "earnings", "Earnings"], [/counter|debate|bear case/, "counterargument", "Counterargument"],
    ];
    const wantsTrade = /trade|trading|buy|swing|momentum|accumulat|independent agents for|agents for/.test(lower);
    if (wantsTrade && syms.length) for (const s of syms) await tradeAgentFor(s, text);
    let addedNews = false;
    for (const [re, role, name] of roleWords) {
      if (!re.test(lower)) continue;
      if (role === "news" && addedNews && !/crypto/.test(name.toLowerCase())) continue;
      if (role === "news") addedNews = true;
      push({ name, role, assets: wantsTrade ? [] : syms, instructions: `${roleById(role)!.defaultInstructions}` });
    }
    if (!agents.length && syms.length) for (const s of syms) push({ name: `${s} Watcher`, role: "market_scanner", assets: [s] });
    if (!agents.length) missing.push("I couldn't tell which agents to create. Name the assets and what each agent should do.");
  }
  if (/supervis|combine their findings|coordinat/.test(lower) && !agents.some((a) => a.role === "supervisor")) push({ name: "Supervisor", role: "supervisor", assets: [] });
  if (/defen[cs]e|monitor all my running agents/.test(lower) && !agents.some((a) => a.role === "risk_management")) push({ name: "Portfolio Defense", role: "risk_management", assets: [] });

  if (mode !== "competition") {
    if (/combine|collaborat|share|together|validate/.test(lower)) mode = "collaborative";
    else if (/sequential|then (the )?(risk|execution)|hand ?off/.test(lower)) mode = "sequential";
    else if (agents.some((a) => a.role === "supervisor")) mode = "supervisor";
    else if (/independent/.test(lower)) mode = "independent";
  }
  // Read-only roles stay read-only unless trading was explicitly authorised for them.
  if (authorizeReadOnlyTrading) notes.push("You asked research agents to act on findings: they will prepare order previews (autonomy 3) for your approval, never trade directly");
  for (const a of agents) if (!roleById(a.role)!.trades && authorizeReadOnlyTrading) a.autonomy = 3;
  // Capital: equal split across trading agents, 10% reserve. Read-only agents get none.
  const traders = agents.filter((a) => roleById(a.role)!.trades);
  let capitalUsd = 0, reserveUsd = 0;
  if (mode === "competition") capitalUsd = traders.reduce((s, a) => s + a.capitalUsd, 0);
  else if (traders.length) {
    const pool = each ? each * traders.length : total ?? 1000 * traders.length;
    if (!total && !each) notes.push(`No budget given: suggested $1,000 per trading agent`);
    reserveUsd = each ? 0 : Math.round(pool * 0.1 * 100) / 100;
    const per = Math.floor(((pool - reserveUsd) / traders.length) * 100) / 100;
    for (const a of traders) { a.capitalUsd = per; a.strategy = { ...(a.strategy ?? { kind: "momentum" }), tradeUsd: Math.max(5, Math.round(per / 4)) }; }
    capitalUsd = pool;
    const readOnly = agents.filter((a) => !roleById(a.role)!.trades && ["market_scanner", "wallet_tracking"].includes(a.role));
    if (readOnly.length) notes.push(`${readOnly.map((a) => a.name).join(", ")} ${readOnly.length === 1 ? "is" : "are"} read-only: no capital assigned`);
  }
  if (n && agents.length !== n && segments.length < 2 && mode !== "competition") notes.push(`You asked for ${n} agents; the plan has ${agents.length}. Edit before approving.`);
  // Dependencies: research → traders → supervisor (directed, acyclic).
  const research = agents.filter((a) => !roleById(a.role)!.trades && !["supervisor", "risk_management"].includes(a.role));
  const sup = agents.filter((a) => ["supervisor", "risk_management"].includes(a.role));
  if (mode === "collaborative" || mode === "sequential") for (const t of traders) t.dependsOn = research.map((r) => r.key);
  for (const s of sup) s.dependsOn = agents.filter((a) => !sup.includes(a)).map((a) => a.key);
  const name = mode === "competition" ? `${traders[0]?.assets[0] ?? "Strategy"} Arena` : agents.length ? `${[...new Set(agents.flatMap((a) => a.assets))].slice(0, 3).join(" · ") || "Research"} Fleet` : "New Fleet";
  return { name, prompt: text, operationMode: mode, capitalUsd, reserveUsd, dailyLossPct, agents, notes, missing, competition };
}

/** Reject cycles: dependencies must form a DAG. */
export function validateGraph(agents: { key: string; dependsOn: string[] }[]) {
  const keys = new Set(agents.map((a) => a.key)), errors: string[] = [];
  for (const a of agents) for (const d of a.dependsOn) if (!keys.has(d)) errors.push(`${a.key} depends on unknown ${d}`);
  const state = new Map<string, number>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return false; if (state.get(k) === 2) return true;
    state.set(k, 1);
    for (const d of agents.find((a) => a.key === k)?.dependsOn ?? []) if (!visit(d)) return false;
    state.set(k, 2); return true;
  };
  for (const a of agents) if (!visit(a.key)) { errors.push("Dependencies contain a cycle"); break; }
  return errors;
}

export const FleetDraftSchema = z.object({
  name: z.string().min(1).max(80), prompt: z.string().max(4000).default(""),
  operationMode: z.enum(["independent", "parallel", "collaborative", "competition", "supervisor", "sequential"]),
  capitalUsd: z.number().min(0).max(100_000_000).default(0), reserveUsd: z.number().min(0).max(100_000_000).default(0), dailyLossPct: z.number().gt(0).max(100).default(2),
  agents: z.array(z.object({
    key: z.string().max(20), name: z.string().min(1).max(60), role: z.enum(ROLE_IDS), assets: z.array(z.string().max(120)).max(50).default([]), wallets: z.array(z.string()).max(20).optional(),
    strategy: z.record(z.string(), z.any()).optional(), autonomy: z.number().int().min(1).max(6), capitalUsd: z.number().min(0).max(100_000_000).default(0),
    instructions: z.string().max(4000).default(""), dependsOn: z.array(z.string().max(20)).default([]), scan: z.any().optional(),
  })).min(1).max(25),
  competition: z.object({ days: z.number().int().min(1).max(365), capitalEach: z.number().positive() }).optional(),
});

/** Persist an approved-for-review fleet: everything is created in pending_approval; nothing runs yet. */
export async function createFleet(userId: string, draft: z.infer<typeof FleetDraftSchema>, opts: { isOwner?: boolean; collection?: boolean } = {}) {
  const errs = validateGraph(draft.agents);
  if (errs.length) throw new HttpError(422, errs.join("; "));
  const fleet = await one<any>(
    `INSERT INTO agent_fleets (user_id, name, prompt, operation_mode, capital_usd, reserve_usd, daily_loss_pct, status, is_collection) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_approval',$8) RETURNING *`,
    [userId, draft.name, draft.prompt, draft.operationMode, draft.capitalUsd, draft.reserveUsd, draft.dailyLossPct, !!opts.collection]);
  const idByKey = new Map<string, string>();
  try {
    for (const a of draft.agents) {
      const created = await createAgent(userId, { name: a.name, role: a.role as any, instructions: a.instructions, assets: a.assets, wallets: a.wallets ?? [], scan: a.scan, strategy: a.strategy as any, autonomy: a.autonomy, capitalUsd: a.capitalUsd },
        { fleetId: fleet.id, status: "pending_approval", isOwner: opts.isOwner, lineage: "created" });
      idByKey.set(a.key, created.id);
    }
  } catch (e) { // all-or-nothing: remove the half-built fleet
    await q("DELETE FROM agents WHERE fleet_id=$1", [fleet.id]); await q("DELETE FROM agent_fleets WHERE id=$1", [fleet.id]);
    throw e;
  }
  const edges = draft.agents.flatMap((a) => a.dependsOn.map((d) => ({ from: idByKey.get(d), to: idByKey.get(a.key) })));
  const supervisor = draft.agents.find((a) => a.role === "supervisor");
  await q("UPDATE agent_fleets SET graph=$2, supervisor_id=$3 WHERE id=$1", [fleet.id, JSON.stringify({ edges }), supervisor ? idByKey.get(supervisor.key) : null]);
  if (draft.operationMode === "competition") {
    const days = draft.competition?.days ?? 30;
    const comp = await one<any>(
      `INSERT INTO agent_competitions (user_id, name, objective, rules, capital_each_usd, days, ends_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $6)) RETURNING id`,
      [userId, draft.name, draft.prompt || draft.name, JSON.stringify({ fees: "engine", slippage: "engine", sameAssets: true, futureData: "forbidden", sharedMemory: "forbidden", fleetId: fleet.id }), draft.competition?.capitalEach ?? draft.agents[0]?.capitalUsd ?? 10000, days]);
    for (const a of draft.agents) await q("INSERT INTO agent_competition_entries (competition_id, agent_id, strategy_label) VALUES ($1,$2,$3)", [comp.id, idByKey.get(a.key), STRATEGY_LABEL[(a.strategy?.kind as StrategyKind) ?? "momentum"] ?? "Strategy"]);
  }
  await emit(userId, { fleetId: fleet.id, kind: "approval", title: `Fleet "${fleet.name}" is waiting for your approval`, body: `${draft.agents.length} agents · ${draft.operationMode} · paper · daily loss stop ${draft.dailyLossPct}%` });
  await audit({ actorType: "user", actorId: userId, userId, action: "fleet.created", target: `fleet:${fleet.id}`, data: { agents: draft.agents.length, mode: draft.operationMode, capital: draft.capitalUsd } }).catch(() => {});
  return fleetDetail(userId, fleet.id);
}

export type FleetAction = "approve" | "pause" | "resume" | "stop" | "emergency_stop" | "close_positions" | "archive" | "unblock" | "save_collection" | "deploy_collection";
export async function fleetAction(userId: string, id: string, action: FleetAction, opts: { isOwner?: boolean } = {}) {
  const f = await one<any>("SELECT * FROM agent_fleets WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!f) throw new HttpError(404, "Fleet not found");
  const members = await q<any>("SELECT id, status, name FROM agents WHERE fleet_id=$1 AND user_id=$2 AND status <> 'archived'", [id, userId]);
  const each = async (act: any, statuses: string[]) => { for (const m of members) if (statuses.includes(m.status)) await agentAction(userId, m.id, act, { reason: `Fleet ${action.replace("_", " ")}` }).catch(() => {}); };
  let status = f.status;
  if (action === "approve") {
    if (!["pending_approval", "draft", "paused"].includes(f.status)) throw new HttpError(409, `Fleet is ${f.status}`);
    for (const m of members) if (["pending_approval", "configured", "draft", "paused", "completed"].includes(m.status)) await q("UPDATE agents SET status='queued', revision=revision+1 WHERE id=$1", [m.id]);
    status = "running";
    await emit(userId, { fleetId: id, kind: "state", title: `Fleet "${f.name}" approved: ${members.length} paper workers launching in parallel` });
  }
  if (action === "pause") { await each("pause", ["queued", "running", "risk_blocked"]); status = "paused"; }
  if (action === "resume") { await each("resume", ["paused"]); status = "running"; }
  if (action === "stop") { await each("stop", ["queued", "running", "paused", "risk_blocked", "pending_approval", "failed"]); status = "paused"; }
  if (action === "emergency_stop") {
    // Explicit semantics: disable new orders (pause) + cancel pending orders. Positions are NOT closed automatically.
    await each("pause", ["queued", "running", "risk_blocked"]);
    let n = 0; for (const m of members) n += await cancelAgentOrders(userId, m.id);
    status = "paused";
    await emit(userId, { fleetId: id, kind: "warning", title: `Emergency stop on "${f.name}"`, body: `New orders disabled for ${members.length} agents; ${n} pending order${n === 1 ? "" : "s"} cancelled. Open positions were left in place: use Close positions to exit.` });
  }
  if (action === "close_positions") for (const m of members) await closeAgentPositions(userId, m.id, "Fleet close positions");
  if (action === "archive") { for (const m of members) { await cancelAgentOrders(userId, m.id); await q("UPDATE agents SET status='archived', revision=revision+1 WHERE id=$1", [m.id]); } status = "archived"; }
  if (action === "unblock") {
    if (f.status !== "risk_blocked") throw new HttpError(409, "Fleet isn't risk-blocked");
    await q("UPDATE agents SET status='queued', revision=revision+1 WHERE fleet_id=$1 AND status='risk_blocked'", [id]); status = "running";
    await emit(userId, { fleetId: id, kind: "state", title: `You re-enabled "${f.name}" after its loss limit`, body: "New risk-increasing orders allowed again until the limit is reached again." });
  }
  if (action === "save_collection") { await q("UPDATE agent_fleets SET is_collection=true WHERE id=$1", [id]); return fleetDetail(userId, id); }
  if (action === "deploy_collection") return cloneFleet(userId, id, opts);
  await q("UPDATE agent_fleets SET status=$2, risk_blocked_at=CASE WHEN $2='risk_blocked' THEN risk_blocked_at ELSE NULL END, updated_at=now() WHERE id=$1", [id, status]);
  await audit({ actorType: "user", actorId: userId, userId, action: `fleet.${action}`, target: `fleet:${id}`, data: { from: f.status, to: status } }).catch(() => {});
  return fleetDetail(userId, id);
}

/** Agent Collections: deploy a saved fleet as a fresh paper fleet (pending approval). */
export async function cloneFleet(userId: string, id: string, opts: { isOwner?: boolean } = {}) {
  const f = await one<any>("SELECT * FROM agent_fleets WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!f) throw new HttpError(404, "Fleet not found");
  const members = await q<any>("SELECT * FROM agents WHERE fleet_id=$1 ORDER BY created_at", [id]);
  const keyOf = new Map(members.map((m, i) => [m.id, `a${i + 1}`]));
  const edges: { from: string; to: string }[] = f.graph?.edges ?? [];
  return createFleet(userId, {
    name: `${f.name} (copy)`.slice(0, 80), prompt: f.prompt ?? "", operationMode: f.operation_mode, capitalUsd: Number(f.capital_usd), reserveUsd: Number(f.reserve_usd), dailyLossPct: Number(f.daily_loss_pct),
    agents: members.map((m) => ({ key: keyOf.get(m.id)!, name: m.name, role: m.role, assets: m.asset_ids, wallets: m.universe?.wallets ?? [], strategy: m.strategy, autonomy: m.autonomy_level, capitalUsd: Number(m.capital_usd), instructions: m.instructions,
      dependsOn: edges.filter((e) => e.to === m.id && keyOf.has(e.from)).map((e) => keyOf.get(e.from)!), scan: m.universe?.scan ?? undefined })),
  }, opts);
}

export async function listFleets(userId: string, archived = false) {
  const fleets = await q<any>("SELECT * FROM agent_fleets WHERE user_id=$1 AND ($2 OR status <> 'archived') ORDER BY created_at DESC", [userId, archived]);
  return Promise.all(fleets.map(async (f) => {
    const members = await q<any>("SELECT * FROM agents WHERE fleet_id=$1 AND status <> 'archived'", [f.id]);
    const ms = await Promise.all(members.map(metricsFor));
    return { ...f, agents: members.length, running: members.filter((m) => m.status === "running").length,
      pnl: ms.reduce((s, m) => s + m.pnl, 0), pnl24h: ms.reduce((s, m) => s + m.pnl24h, 0), capital: ms.reduce((s, m) => s + m.capital, 0), pending: ms.reduce((s, m) => s + m.pendingApprovals, 0) };
  }));
}
export async function fleetDetail(userId: string, id: string) {
  const f = await one<any>("SELECT * FROM agent_fleets WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!f) throw new HttpError(404, "Fleet not found");
  const members = await q<any>("SELECT a.*, (SELECT array_agg(symbol) FROM assets WHERE id = ANY(a.asset_ids)) AS symbols FROM agents a WHERE a.fleet_id=$1 ORDER BY a.created_at", [id]);
  const agents = await Promise.all(members.map(async (m) => ({ ...m, roleName: roleById(m.role)?.name, metrics: await metricsFor(m) })));
  const competition = await one<any>("SELECT * FROM agent_competitions WHERE user_id=$1 AND rules->>'fleetId'=$2", [userId, id]);
  return { fleet: f, agents, competition };
}
export { postMessage };
