import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { ROLES, roleById, STRATEGY_LABEL, defaultStrategy } from "./catalog";
import { createAgent, emit, metricsFor, snapshotsFor, updateAgent } from "./service";
import { createFleet } from "./fleets";

/* ───────────────────────── Agent Arena (spec §07) ───────────────────────── */
function curveStats(points: { t: number; v: number }[], start: number) {
  let peak = start, maxDD = 0; const rets: number[] = []; let prev = start;
  for (const p of points) { peak = Math.max(peak, p.v); maxDD = Math.max(maxDD, peak > 0 ? (peak - p.v) / peak : 0); rets.push(prev ? (p.v - prev) / prev : 0); prev = p.v; }
  const mean = rets.reduce((a, x) => a + x, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, rets.length));
  const pos = rets.filter((r) => r > 0).length;
  return { maxDrawdownPct: maxDD * 100, sharpe: sd > 0 ? mean / sd * Math.sqrt(rets.length) : null, consistency: rets.length ? (pos / rets.length) * 100 : null };
}
export async function listCompetitions(userId: string) {
  const comps = await q<any>("SELECT * FROM agent_competitions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [userId]);
  return Promise.all(comps.map((c) => competitionDetail(userId, c.id)));
}
export async function competitionDetail(userId: string, id: string) {
  const c = await one<any>("SELECT * FROM agent_competitions WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!c) throw new HttpError(404, "Competition not found");
  const entries = await q<any>("SELECT e.*, a.name, a.status, a.capital_usd, a.realized_pnl_usd, a.asset_ids, a.role, a.strategy, a.version FROM agent_competition_entries e JOIN agents a ON a.id=e.agent_id WHERE e.competition_id=$1", [id]);
  const bench = entries[0]?.asset_ids?.[0] ? await one<any>(
    `SELECT (SELECT close FROM price_bars WHERE asset_id=$1 AND timeframe='1h' AND ts >= $2 ORDER BY ts LIMIT 1) AS start, (SELECT last_price FROM assets WHERE id=$1) AS now, (SELECT symbol FROM assets WHERE id=$1) AS symbol`,
    [entries[0].asset_ids[0], c.started_at]) : null;
  const rows = await Promise.all(entries.map(async (e) => {
    const m = await metricsFor({ ...e, id: e.agent_id });
    const spark = await snapshotsFor(e.agent_id, 400);
    const st = curveStats(spark, Number(c.capital_each_usd));
    const ret = Number(c.capital_each_usd) > 0 ? (m.pnl / Number(c.capital_each_usd)) * 100 : 0;
    const score = ret - 0.5 * st.maxDrawdownPct + (st.sharpe ?? 0) * 0.5 - (m.trades < 3 ? 1 : 0);
    return { agentId: e.agent_id, name: e.name, strategy: e.strategy_label, status: e.status, version: e.version, disqualified: e.disqualified, returnPct: ret, pnl: m.pnl, fees: m.fees, trades: m.trades, winRate: m.winRate, ...st, score, spark, sampleWarning: m.trades < 10 ? "Small sample: fewer than 10 trades" : null };
  }));
  rows.sort((a, b) => (a.disqualified ? 1 : 0) - (b.disqualified ? 1 : 0) || b.score - a.score);
  return { ...c, environment: "paper", entries: rows, benchmark: bench?.start && bench?.now ? { symbol: bench.symbol, returnPct: ((Number(bench.now) - Number(bench.start)) / Number(bench.start)) * 100, label: `Buy & hold ${bench.symbol}` } : null,
    scoring: "Risk-adjusted: net return − ½ × max drawdown + ½ × Sharpe; small samples penalised. Same asset, same capital, same engine fees and slippage. Paper results, not live." };
}
/** Create a competition from existing agents or from a strategy list on one asset. */
export async function createCompetition(userId: string, b: { name: string; asset: string; strategies: string[]; capitalEach: number; days: number }, isOwner = false) {
  const kinds = b.strategies.filter((k) => k in STRATEGY_LABEL && k !== "none" && k !== "mimic").slice(0, 8);
  if (kinds.length < 2) throw new HttpError(422, "Pick at least two strategies to compete");
  const crypto = !!(await one("SELECT 1 FROM assets WHERE upper(symbol)=upper($1) AND asset_class='crypto' LIMIT 1", [b.asset]));
  return createFleet(userId, {
    name: b.name, prompt: `Arena: ${kinds.length} strategies on ${b.asset}`, operationMode: "competition", capitalUsd: b.capitalEach * kinds.length, reserveUsd: 0, dailyLossPct: 100,
    agents: kinds.map((k, i) => ({ key: `a${i + 1}`, name: `${b.asset.toUpperCase()} ${STRATEGY_LABEL[k as keyof typeof STRATEGY_LABEL]}`.slice(0, 60), role: crypto ? "crypto_trading" : "stock_trading", assets: [b.asset], strategy: { ...defaultStrategy(k as any), tradeUsd: Math.round(b.capitalEach / 4) }, autonomy: 5, capitalUsd: b.capitalEach, instructions: `Arena entrant (${STRATEGY_LABEL[k as keyof typeof STRATEGY_LABEL]}).`, dependsOn: [] })),
    competition: { days: b.days, capitalEach: b.capitalEach },
  }, { isOwner });
}

/* ───────────────────────── Auto-Training decisions (spec §10) ───────────────────────── */
export async function listCandidates(userId: string) {
  return q<any>(`SELECT c.*, a.name AS agent_name, a.strategy AS current_strategy, a.version AS current_version, a.locked_strategy
                   FROM agent_training_candidates c JOIN agents a ON a.id=c.agent_id WHERE c.user_id=$1 ORDER BY (c.status='proposed') DESC, c.created_at DESC LIMIT 50`, [userId]);
}
export async function decideCandidate(userId: string, id: string, decision: "approve" | "reject") {
  const c = await one<any>("SELECT c.*, a.version AS current_version, a.locked_strategy FROM agent_training_candidates c JOIN agents a ON a.id=c.agent_id WHERE c.id=$1 AND c.user_id=$2", [id, userId]);
  if (!c) throw new HttpError(404, "Candidate not found");
  if (c.status !== "proposed") throw new HttpError(409, `Already ${c.status}`);
  if (decision === "approve") {
    if (c.current_version !== c.base_version) throw new HttpError(409, `The agent changed since this proposal (v${c.base_version} → v${c.current_version}). Re-run the review.`);
    if (c.locked_strategy) throw new HttpError(409, "The agent's strategy is locked. Unlock it first.");
    const { kind: _k, ...rest } = c.proposed;
    await updateAgent(userId, c.agent_id, { strategy: { ...rest, kind: c.proposed.kind }, note: `Auto-training candidate approved: ${(c.diagnosis?.reasons ?? []).join("; ")}`.slice(0, 300) }, { by: "auto_training" });
  }
  await q("UPDATE agent_training_candidates SET status=$2, decided_at=now() WHERE id=$1", [id, decision === "approve" ? "approved" : "rejected"]);
  await emit(userId, { agentId: c.agent_id, kind: "training", title: `Improvement ${decision === "approve" ? "approved: new version deployed (rollback available in Versions)" : "rejected"}` });
  await audit({ actorType: "user", actorId: userId, userId, action: `agent.training_${decision}`, target: `agent:${c.agent_id}`, data: { candidate: id } }).catch(() => {});
  return { ok: true };
}

/* ───────────────────────── Merod Exchange marketplace (spec §12) ───────────────────────── */
const BUILTIN = [
  { id: "builtin:sol-momentum", kind: "agent", name: "SOL Momentum", category: "Crypto", risk: "medium", description: "Trades SOL on 24h momentum with MACD and RSI confirmation; 4% take-profit, 2% stop.", config: { role: "crypto_trading", assets: ["SOL"], strategy: { kind: "momentum" }, autonomy: 5 } },
  { id: "builtin:nvda-swing", kind: "agent", name: "NVDA Swing", category: "Stocks", risk: "medium", description: "Buys NVDA dips of 3% and sells at 5% profit.", config: { role: "stock_trading", assets: ["NVDA"], strategy: { kind: "dip", dipPct: 3, takeProfitPct: 5 }, autonomy: 5 } },
  { id: "builtin:btc-accumulation", kind: "agent", name: "BTC Accumulation", category: "Crypto", risk: "low", description: "Daily dollar-cost averaging into BTC.", config: { role: "crypto_trading", assets: ["BTC"], strategy: { kind: "dca", everyHours: 24, takeProfitPct: 0, stopLossPct: 0 }, autonomy: 5 } },
  { id: "builtin:meme-scanner", kind: "agent", name: "Memecoin Scanner", category: "Discovery", risk: "high", description: "Scans liquid meme coins for strong 24h moves. Read-only.", config: { role: "market_scanner", assets: [], scan: { assetClass: "crypto", meme: true, minChangePct: 8 }, autonomy: 1 } },
  { id: "builtin:risk-supervisor", kind: "agent", name: "Risk Supervisor", category: "Oversight", risk: "low", description: "Watches combined daily loss, concentration and failures; blocks new risk at the limit.", config: { role: "supervisor", assets: [], autonomy: 1 } },
  { id: "builtin:news-desk", kind: "agent", name: "News Desk", category: "Research", risk: "low", description: "Tracks headlines for your assets with sources and tone.", config: { role: "news", assets: ["BTC", "NVDA"], autonomy: 1 } },
  { id: "builtin:multi-asset-fleet", kind: "fleet", name: "Multi-Asset Trading Fleet", category: "Fleet", risk: "medium", description: "Independent agents for BTC, SOL, NVDA, AAPL and TSLA with a supervisor, in paper mode.", config: { prompt: "Create independent agents for BTC, SOL, NVDA, AAPL and TSLA. Give each its own strategy and capital allocation of $10,000 total. Run them simultaneously in paper mode with a supervisor." } },
  { id: "builtin:news-intel-fleet", kind: "fleet", name: "Market News Intelligence", category: "Fleet", risk: "low", description: "Stocks, crypto, macro and sentiment agents with a supervisor combining findings.", config: { prompt: "Create separate agents for stocks news, crypto news, economic news and public social sentiment. Have a supervisor combine their findings." } },
  { id: "builtin:portfolio-defense", kind: "fleet", name: "Portfolio Defense", category: "Fleet", risk: "low", description: "Monitors running agents and positions; flags concentration, stale data and abnormal losses.", config: { prompt: "Monitor all my running agents and portfolio positions. Flag excessive concentration, stale market data and abnormal losses. Pause new automated orders when approved risk limits are breached." } },
];
export async function listListings(userId: string, opts: { q?: string | null; category?: string | null } = {}) {
  const rows = await q<any>(
    `SELECT l.*, p.handle AS creator_handle FROM agent_listings l LEFT JOIN user_profiles p ON p.user_id=l.creator_id
      WHERE l.moderation='approved' AND (l.visibility='public' OR l.creator_id=$1) ORDER BY l.installs DESC, l.created_at DESC LIMIT 100`, [userId]);
  const mine = rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, category: r.category, risk: r.risk_profile, description: r.description, config: r.config, creator: r.creator_handle ? `@${r.creator_handle}` : "Unknown", visibility: r.visibility, version: r.version, installs: r.installs, performance: r.performance, permissions: r.permissions, own: r.creator_id === userId, builtin: false }));
  const all = [...BUILTIN.map((b) => ({ ...b, creator: "Merod", visibility: "public", version: 1, installs: null, performance: { label: "No verified track record (template)" }, permissions: permissionsOf(b.config), own: false, builtin: true })), ...mine];
  const ql = opts.q?.toLowerCase();
  return all.filter((l) => (!ql || `${l.name} ${l.description} ${l.category}`.toLowerCase().includes(ql)) && (!opts.category || l.category === opts.category));
}
function permissionsOf(cfg: any) {
  if (cfg?.prompt) return { note: "Fleet: every agent is reviewed before it runs", trading: "per agent", live: false };
  const r = roleById(cfg?.role);
  return { role: r?.name, tools: r?.tools ?? [], trading: !!r?.trades && (cfg?.autonomy ?? 1) >= 4, autonomy: cfg?.autonomy ?? 1, live: false };
}
/** Publish one of your agents as a template (config only: never memory, keys, capital or positions). */
export async function publishListing(userId: string, agentId: string, b: { visibility: "private" | "public"; description?: string; category?: string }) {
  const a = await one<any>("SELECT * FROM agents WHERE id=$1 AND user_id=$2", [agentId, userId]);
  if (!a) throw new HttpError(404, "Agent not found");
  const symbols = (await q<any>("SELECT symbol FROM assets WHERE id = ANY($1)", [a.asset_ids])).map((x) => x.symbol);
  const config = { role: a.role, assets: symbols, strategy: a.strategy, autonomy: Math.min(a.autonomy_level, 5), instructions: a.instructions, scan: a.universe?.scan ?? undefined, schedule: a.schedule };
  const m = await metricsFor(a);
  const perf = { environment: "paper", returnPct: m.pnlPct, trades: m.trades, winRate: m.winRate, since: a.created_at, verified: true, label: "Verified Merod paper results (not live)" };
  const existing = await one<any>("SELECT id, version FROM agent_listings WHERE creator_id=$1 AND name=$2", [userId, a.name]);
  const row = existing
    ? await one<any>("UPDATE agent_listings SET config=$2, permissions=$3, version=version+1, visibility=$4, description=$5, performance=$6, change_note='Updated from agent', updated_at=now() WHERE id=$1 RETURNING *", [existing.id, JSON.stringify(config), JSON.stringify(permissionsOf(config)), b.visibility, b.description ?? a.instructions.slice(0, 300), JSON.stringify(perf)])
    : await one<any>("INSERT INTO agent_listings (creator_id, kind, name, description, category, risk_profile, config, permissions, visibility, performance) VALUES ($1,'agent',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [userId, a.name, b.description ?? a.instructions.slice(0, 300), b.category ?? (roleById(a.role)?.group === "market" ? "Strategy" : "Oversight"), a.autonomy_level >= 5 ? "medium" : "low", JSON.stringify(config), JSON.stringify(permissionsOf(config)), b.visibility, JSON.stringify(perf)]);
  await audit({ actorType: "user", actorId: userId, userId, action: "listing.published", target: `listing:${row.id}`, data: { visibility: b.visibility } }).catch(() => {});
  return row;
}
/** Install = clone the template into your workspace as a paper agent that is NOT running (review, then start). */
export async function installListing(userId: string, id: string, isOwner = false) {
  const l = id.startsWith("builtin:") ? BUILTIN.find((b) => b.id === id) : await one<any>("SELECT * FROM agent_listings WHERE id=$1 AND moderation='approved' AND (visibility='public' OR creator_id=$2)", [id, userId]);
  if (!l) throw new HttpError(404, "Listing not found");
  const cfg = l.config;
  if (cfg.prompt) {
    const { planFleet } = await import("./fleets");
    const draft = await planFleet(cfg.prompt);
    return { kind: "fleet", draft };
  }
  const agent = await createAgent(userId, { name: l.name, role: cfg.role, instructions: cfg.instructions ?? "", assets: cfg.assets ?? [], scan: cfg.scan, strategy: cfg.strategy, autonomy: Math.min(cfg.autonomy ?? 1, 5), capitalUsd: 0, schedule: cfg.schedule },
    { lineage: id.startsWith("builtin:") ? "templated" : "installed", status: "configured", isOwner });
  if (!id.startsWith("builtin:")) await q("UPDATE agent_listings SET installs=installs+1 WHERE id=$1", [id]);
  return { kind: "agent", agent };
}

/* ───────────────────────── Analytics (spec §16 screen 10) ───────────────────────── */
export async function analytics(userId: string) {
  const agents = await q<any>("SELECT * FROM agents WHERE user_id=$1 AND status <> 'archived' ORDER BY created_at", [userId]);
  const rows = await Promise.all(agents.map(async (a) => {
    const m = await metricsFor(a);
    const sp = await snapshotsFor(a.id, 500);
    const st = curveStats(sp, Number(a.capital_usd) || 1);
    const pf = await one<any>("SELECT COALESCE(SUM(realized_pnl) FILTER (WHERE realized_pnl>0),0) AS gp, COALESCE(-SUM(realized_pnl) FILTER (WHERE realized_pnl<0),0) AS gl FROM orders WHERE source='agent' AND source_ref=$1", [a.id]);
    const gp = Number(pf?.gp ?? 0), gl = Number(pf?.gl ?? 0);
    return { id: a.id, name: a.name, role: roleById(a.role)?.name, fleetId: a.fleet_id, status: a.status, ...m, maxDrawdownPct: st.maxDrawdownPct, sharpe: st.sharpe, profitFactor: gl > 0 ? gp / gl : null, spark: sp.slice(-60) };
  }));
  const fleets = await q<any>("SELECT id, name FROM agent_fleets WHERE user_id=$1 AND status <> 'archived'", [userId]);
  const byFleet = fleets.map((f) => { const r = rows.filter((x) => x.fleetId === f.id); return { id: f.id, name: f.name, agents: r.length, pnl: r.reduce((s, x) => s + x.pnl, 0), capital: r.reduce((s, x) => s + x.capital, 0), fees: r.reduce((s, x) => s + x.fees, 0), trades: r.reduce((s, x) => s + x.trades, 0) }; });
  const trades = await q<any>(
    `SELECT o.id, o.created_at, o.side, o.status, o.filled_quantity, o.avg_fill_price, o.realized_pnl, o.fees_usd, a.symbol, g.name AS agent
       FROM orders o JOIN assets a ON a.id=o.asset_id JOIN agents g ON g.id::text=o.source_ref WHERE o.user_id=$1 AND o.source='agent' ORDER BY o.created_at DESC LIMIT 200`, [userId]);
  const total = { pnl: rows.reduce((s, x) => s + x.pnl, 0), capital: rows.reduce((s, x) => s + x.capital, 0), fees: rows.reduce((s, x) => s + x.fees, 0), trades: rows.reduce((s, x) => s + x.trades, 0) };
  const btc = await one<any>("SELECT symbol, change_24h FROM assets WHERE upper(symbol)='BTC' AND last_price IS NOT NULL ORDER BY market_cap DESC NULLS LAST LIMIT 1");
  const spy = await one<any>("SELECT symbol, change_24h FROM assets WHERE upper(symbol)='SPY' AND last_price IS NOT NULL ORDER BY market_cap DESC NULLS LAST LIMIT 1");
  return { environment: "paper", agents: rows, fleets: byFleet, trades, total, benchmarks: [btc, spy].filter(Boolean).map((b: any) => ({ symbol: b.symbol, change24h: Number(b.change_24h ?? 0) })) };
}

export { ROLES };
