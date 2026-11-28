import "@/lib/server-only-shim";
import { one, q } from "../db";
import { publish } from "../realtime";

/**
 * Auton: Merod's autonomous trader (a "brain" next to Modo, OpenAI and Claude; it needs no outside AI).
 *
 * Every cycle it:
 *   1. reads ALL your history (every filled order, by bot / agent / source / coin), your skills, points and prompts,
 *      and the live + historical market (every liquid coin and stock with a real price);
 *   2. manages what it made: turns off its losing bots, gives its winners a bigger size (inside its budget);
 *   3. opens new bots on the best candidates (momentum, liquidity, your own track record on that coin, your goals),
 *      never on coins you or it kept losing on, never above its budget or bot limit;
 *   4. keeps its own e-wallet ("Auton profits", 20% of each Auton bot's profit), its own skill (rules that apply only to
 *      its own bots, so your trading isn't affected), a scout agent, the prompts it trades by, and a map ("Auton") that
 *      wires all of it together;
 *   5. writes every thought, decision and action to its activity feed (and to the Talk tab it reports to).
 * Paper money by default; real money only if you turn it on, and then the order engine's real-money checks still apply.
 */
export type AutonSettings = { user_id: string; active: boolean; every_sec: number; max_capital_usd: number; max_bots: number; real_money: boolean; goals: string; conversation_id: string | null; memory: any; last_run_at: string | null };

export async function getAuton(userId: string): Promise<AutonSettings> {
  const s = await one<any>("SELECT * FROM auton_settings WHERE user_id=$1", [userId]);
  const d = s ?? { user_id: userId, active: false, every_sec: 300, max_capital_usd: 1000, max_bots: 5, real_money: false, goals: "", conversation_id: null, memory: {}, last_run_at: null };
  return { ...d, max_capital_usd: Number(d.max_capital_usd), max_bots: Number(d.max_bots), every_sec: Number(d.every_sec) };
}
export async function setAuton(userId: string, p: Partial<{ active: boolean; everySec: number; maxCapitalUsd: number; maxBots: number; realMoney: boolean; goals: string; conversationId: string | null }>) {
  const c = await getAuton(userId);
  const row = await one<any>(
    `INSERT INTO auton_settings (user_id, active, every_sec, max_capital_usd, max_bots, real_money, goals, conversation_id, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (user_id) DO UPDATE SET active=$2, every_sec=$3, max_capital_usd=$4, max_bots=$5, real_money=$6, goals=$7, conversation_id=$8,
       next_run_at = CASE WHEN $2 AND NOT auton_settings.active THEN now() ELSE auton_settings.next_run_at END
     RETURNING *`,
    [userId, p.active ?? c.active, Math.max(60, Math.min(86_400, Math.round(p.everySec ?? c.every_sec))), Math.max(0, p.maxCapitalUsd ?? c.max_capital_usd), Math.max(0, Math.min(50, Math.round(p.maxBots ?? c.max_bots))),
     p.realMoney ?? c.real_money, (p.goals ?? c.goals).slice(0, 1000), p.conversationId !== undefined ? p.conversationId : c.conversation_id]);
  await log(userId, row.conversation_id, "thought", row.active ? `Auton is ${c.active ? "running" : "on"}: budget $${Number(row.max_capital_usd)}, up to ${row.max_bots} bots, every ${Math.round(row.every_sec / 60)} min${row.real_money ? ", REAL money allowed" : ", paper money"}` : "Auton is off", row.goals ? `Goals: ${row.goals}` : undefined);
  return row;
}

export async function log(userId: string, conversationId: string | null, kind: "thought" | "analysis" | "decision" | "execution" | "warning", title: string, body?: string, data?: unknown) {
  await q("INSERT INTO auton_events (user_id, conversation_id, kind, title, body, data) VALUES ($1,$2,$3,$4,$5,$6)", [userId, conversationId, kind, title.slice(0, 300), body?.slice(0, 2000) ?? null, data ? JSON.stringify(data) : null]);
  await publish(`user:${userId}`, "auton", { kind, title }).catch(() => {});
}
async function own(userId: string, kind: string) { return q<any>("SELECT ref_id, label FROM auton_assets WHERE user_id=$1 AND kind=$2", [userId, kind]); }
async function remember(userId: string, kind: string, ref: string, label: string) {
  await q("INSERT INTO auton_assets (user_id, kind, ref_id, label) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, kind, ref_id) DO UPDATE SET label=$4", [userId, kind, ref, label.slice(0, 120)]);
}
const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Goal text → which part of the market Auton hunts in. */
export function goalFilter(goals: string) {
  const g = goals.toLowerCase();
  const syms = [...new Set((goals.match(/\b[A-Z]{2,6}\b/g) ?? []).filter((s) => !/^(USD|AND|THE|FOR|ALL|BUY|SELL|BOT|BOTS|AI|PNL|ETF)$/.test(s)))];
  return {
    stocks: /\b(stocks?|equit|shares|nasdaq|s&p|nyse)\b/.test(g) && !/\b(crypto|coins?|tokens?)\b/.test(g),
    crypto: /\b(crypto|coins?|tokens?|solana|meme|eth|btc)\b/.test(g) && !/\bstocks?\b/.test(g),
    solana: /\bsol(ana)?\b/.test(g), meme: /\bmeme/.test(g), safe: /\b(safe|low risk|conservative|careful|blue ?chip|large ?cap)\b/.test(g),
    aggressive: /\b(aggressive|high risk|degen|moon|fast)\b/.test(g), syms,
  };
}

export async function runAuton(userId: string, opts: { goal?: string; conversationId?: string | null; instructions?: string[]; managedBotIds?: string[] } = {}) {
  const s = await getAuton(userId);
  const conv = opts.conversationId ?? s.conversation_id;
  const goals = [s.goals, opts.goal, ...(opts.instructions ?? [])].filter(Boolean).join(". ");
  const out: string[] = [];
  const L = async (kind: Parameters<typeof log>[2], title: string, body?: string, data?: unknown) => { await log(userId, conv, kind, title, body, data); if (kind === "execution" || kind === "decision" || kind === "warning") out.push(`• ${title}`); };
  await L("thought", "Starting a cycle: reading all your trades, bots, agents, skills, prompts and the market", goals ? `Goals: ${goals}` : undefined);

  // 1) History: everything you've traded (30 days), and what the user's skills/points/prompts say.
  const { analyze } = await import("../trade-updates");
  const hist = await analyze(userId, 24 * 30).catch(() => null);
  const st: any = hist?.stats ?? { closed: 0, coins: [], actors: [] };
  const lostOn = new Set<string>((st.coins ?? []).filter((c: any) => c.losses >= 3 && c.net < 0).map((c: any) => c.symbol));
  const wonOn = new Map<string, number>((st.coins ?? []).filter((c: any) => c.net > 0).map((c: any) => [c.symbol, c.net]));
  const { activeRules } = await import("../skills");
  const rules = await activeRules(userId).catch(() => ({} as any));
  const never = new Set<string>((rules.neverBuy ?? []).map((x: string) => x.toUpperCase()));
  const promptCount = (await one<any>("SELECT count(*)::int AS n FROM trading_prompts WHERE user_id=$1 AND role='user'", [userId]))?.n ?? 0;
  await L("analysis", `History: ${st.orders ?? 0} filled orders in 30 days, ${st.closed} closed (${st.winRate ?? "—"}% won), realized ${st.net >= 0 ? "+" : "-"}${money(Number(st.net ?? 0))}`,
    [st.best ? `Best: ${st.best.name} +${money(st.best.net)}` : null, st.worst ? `Worst: ${st.worst.name} -${money(st.worst.net)}` : null,
     lostOn.size ? `Coins that keep losing (avoided): ${[...lostOn].slice(0, 10).join(", ")}` : null, wonOn.size ? `Coins that paid off: ${[...wonOn.keys()].slice(0, 10).join(", ")}` : null,
     never.size ? `Your never-buy rules: ${[...never].slice(0, 10).join(", ")}` : null, `${promptCount} prompts read`].filter(Boolean).join(" · "));

  // 2) Manage its own bots (+ any you attached to Auton on the map).
  const mine = await own(userId, "bot");
  const managed = [...new Set([...(await own(userId, "managed_bot")).map((r) => r.ref_id), ...(opts.managedBotIds ?? [])])];
  const ids = [...new Set([...mine.map((r) => r.ref_id), ...managed])];
  const bots = ids.length ? await q<any>(
    `SELECT b.id, b.name, b.status, b.params, b.asset_ids,
            (SELECT count(*)::int FROM orders o WHERE o.source='bot' AND o.source_ref=b.id::text AND o.side='sell' AND o.status='filled') AS closed,
            (SELECT count(*)::int FROM orders o WHERE o.source='bot' AND o.source_ref=b.id::text AND o.side='sell' AND o.status='filled' AND o.realized_pnl > 0) AS wins,
            (SELECT COALESCE(sum(realized_pnl),0) FROM orders o WHERE o.source='bot' AND o.source_ref=b.id::text AND o.status='filled') AS net
       FROM trading_bots b WHERE b.user_id=$1 AND b.id = ANY($2::uuid[]) AND b.status <> 'archived'`, [userId, ids]) : [];
  const { runControl } = await import("../ai/control");
  const { applyEdits } = await import("../ai/bulk-edit");
  const perBot = Math.max(5, Math.floor(s.max_capital_usd / Math.max(1, s.max_bots)));
  for (const b of bots) {
    const closed = Number(b.closed), wins = Number(b.wins), net = Number(b.net), wr = closed ? wins / closed : 0;
    if (b.status === "running" && closed >= 3 && net < 0 && wr < 0.4) {
      await L("decision", `Turning off ${b.name}`, `${closed - wins} of ${closed} trades lost, net -${money(-net)}. Freeing its budget for better setups.`);
      await runControl(userId, "pause", [{ kind: "bot", id: b.id, name: b.name, status: b.status }], true);
      await L("execution", `Paused ${b.name}`);
    } else if (closed >= 3 && wr >= 0.65 && net > 0) {
      const cur = Number(b.params?.amount_usd ?? 0), next = Math.min(perBot * 2, Math.round(cur * 1.25 * 100) / 100);
      if (cur > 0 && next > cur) { await applyEdits(userId, [{ kind: "bot", id: b.id, name: b.name }], { amountUsd: next }); await L("execution", `Gave ${b.name} more per trade: ${money(cur)} → ${money(next)}`, `${wins}/${closed} wins, +${money(net)}.`); }
    }
  }

  // 3) New bots on the best candidates.
  const running = bots.filter((b) => b.status === "running" && mine.some((m) => m.ref_id === b.id));
  const traded = new Set<string>(running.flatMap((b) => b.asset_ids ?? []));
  const f = goalFilter(goals);
  const slots = Math.max(0, s.max_bots - running.length);
  const budgetUsed = running.reduce((a, b) => a + Number(b.params?.amount_usd ?? 0), 0);
  if (slots > 0 && budgetUsed + perBot <= s.max_capital_usd + 0.01) {
    const where = [
      "a.last_price IS NOT NULL", "a.change_24h IS NOT NULL", "a.price_updated_at > now() - interval '6 hours'",
      "NOT ('demo_data' = ANY(a.risk_flags))", f.aggressive ? "TRUE" : "NOT ('low_liquidity' = ANY(a.risk_flags))",
      f.safe ? "COALESCE(a.market_cap,0) >= 1000000000" : f.aggressive ? "(COALESCE(a.liquidity_usd,0) >= 100000 OR COALESCE(a.market_cap,0) >= 10000000)" : "(COALESCE(a.liquidity_usd,0) >= 1000000 OR COALESCE(a.market_cap,0) >= 100000000)",
      f.stocks ? "a.asset_class IN ('stock','etf')" : f.crypto ? "a.asset_class = 'crypto'" : "TRUE",
      f.solana ? "a.venue = 'solana'" : "TRUE", f.meme ? "'meme' = ANY(a.categories)" : "TRUE",
    ];
    const symFilter = f.syms.length ? `AND upper(a.symbol) = ANY($1)` : "";
    const cands = await q<any>(`SELECT a.id, a.symbol, a.asset_class, a.venue, a.change_24h, a.liquidity_usd, a.market_cap FROM assets a WHERE ${where.join(" AND ")} ${symFilter}
                                ORDER BY a.change_24h DESC NULLS LAST LIMIT 80`, f.syms.length ? [f.syms.map((x) => x.toUpperCase())] : []).catch(() => []);
    const scored = cands
      .filter((c) => !traded.has(c.id) && !never.has(String(c.symbol).toUpperCase()) && !lostOn.has(c.symbol))
      .map((c) => {
        const ch = Number(c.change_24h);
        // Momentum that isn't already a blow-off top, plus a bonus where you've made money before.
        const mom = ch >= 2 && ch <= (f.aggressive ? 80 : 30) ? ch : ch > 30 ? 30 - (ch - 30) / 2 : ch / 2;
        return { ...c, score: mom + (wonOn.has(c.symbol) ? 5 : 0) + (f.syms.includes(String(c.symbol).toUpperCase()) ? 20 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    const pick = scored.slice(0, Math.min(slots, 2, Math.floor((s.max_capital_usd - budgetUsed) / perBot)));
    if (!pick.length) await L("thought", "No new setups worth opening right now", cands.length ? "The movers are either stretched, illiquid, on your never-buy list, or coins that kept losing." : "No liquid coins/stocks with fresh real prices matched your goals.");
    const { BotConfigSchema, createBot } = await import("../bots/service");
    for (const c of pick) {
      const vol = Math.abs(Number(c.change_24h));
      const dip = f.safe ? 1.5 : vol > 15 ? 3 : 2, tp = f.safe ? 2.5 : vol > 15 ? 5 : 3, sl = f.safe ? 3 : vol > 15 ? 6 : 4;
      const name = `Auton · ${c.symbol} dip ${dip}% → +${tp}%`;
      await L("decision", `Opening ${name}`, `${c.symbol} is ${Number(c.change_24h) >= 0 ? "+" : ""}${Number(c.change_24h).toFixed(1)}% in 24h with ${c.liquidity_usd ? `$${Math.round(Number(c.liquidity_usd)).toLocaleString()} liquidity` : `$${Math.round(Number(c.market_cap)).toLocaleString()} market cap`}${wonOn.has(c.symbol) ? `; you've made +${money(wonOn.get(c.symbol)!)} on it before` : ""}. Buys ${dip}% dips, sells at +${tp}%, stop-loss -${sl}%, ${money(perBot)} per trade.`);
      try {
        const cfg = BotConfigSchema.parse({ name, description: "Created and managed by Auton", strategyId: "dip_rebound_loop", assetIds: [c.id], isPaper: !s.real_money, start: true, schedule: "every_1m",
          minLiquidityUsd: 0, maxSlippageBps: 300, maxPositionUsd: perBot * 2, createdFromPrompt: `Auton: ${goals || "find profitable setups"}`.slice(0, 2000),
          params: { amount_usd: perBot, dip_pct: dip, take_profit_pct: tp, stop_loss_pct: sl, repeat: true } });
        const bot: any = await createBot(userId, cfg, "ai");
        const id = bot?.id ?? bot?.bot?.id;
        if (id) { await remember(userId, "bot", id, name); await remember(userId, "prompt", `${id}:p`, `buy ${c.symbol} on a ${dip}% dip, take profit ${tp}%, stop loss ${sl}%, $${perBot} per trade`); }
        await L("execution", `Created and started ${name} (${s.real_money ? "real money" : "paper"})`);
      } catch (e: any) { await L("warning", `Couldn't open ${name}`, String(e?.message ?? e).slice(0, 300)); }
    }
  } else if (slots === 0) await L("thought", `All ${s.max_bots} Auton bot slots are in use`, "Raise its bot limit (“auton max 8 bots”) for more.");
  else await L("thought", `Budget fully used (${money(budgetUsed)} of ${money(s.max_capital_usd)})`, "Raise it with “auton budget $2000”.");

  // 4) Its own e-wallet, skill, scout agent and map.
  await ensureExtras(userId, s, conv, L).catch(async (e) => L("warning", "Couldn't update Auton's extras", String(e?.message ?? e)));

  await q("UPDATE auton_settings SET last_run_at=now() WHERE user_id=$1", [userId]);
  const summary = out.length ? `Auton cycle done:\n${out.join("\n")}` : "Auton cycle done: nothing needed changing.";
  await log(userId, conv, "thought", out.length ? `Cycle done: ${out.length} action${out.length === 1 ? "" : "s"}` : "Cycle done: nothing needed changing");
  if (conv && out.length) await q("INSERT INTO trading_prompts (user_id, conversation_id, role, content, ai_provider, ai_model, status) VALUES ($1,$2,'assistant',$3,'auton','auton','info')", [userId, conv, summary]).catch(() => {});
  return { summary, actions: out };
}

async function ensureExtras(userId: string, s: AutonSettings, conv: string | null, L: (k: any, t: string, b?: string) => Promise<void>) {
  const botsMine = await own(userId, "bot");
  const live = botsMine.length ? await q<any>("SELECT id, name FROM trading_bots WHERE user_id=$1 AND id = ANY($2::uuid[]) AND status <> 'archived'", [userId, botsMine.map((b) => b.ref_id)]) : [];
  // E-wallet: "Auton profits", 20% of each Auton bot's profit.
  const { createWallet, addRule } = await import("../ewallets");
  let wid = (await own(userId, "e_wallet"))[0]?.ref_id;
  if (!wid) { const w = await createWallet(userId, "Auton profits"); wid = w.id; await remember(userId, "e_wallet", w.id, w.name); await L("execution", "Created e-wallet “Auton profits” (20% of every Auton bot's profit goes there)"); }
  for (const b of live) {
    const has = await one("SELECT 1 FROM e_wallet_rules WHERE user_id=$1 AND wallet_id=$2 AND scope='bot' AND scope_ref=$3", [userId, wid, b.id]);
    if (!has) await addRule(userId, wid!, { percent: 20, scope: "bot", scopeRef: b.id, scopeLabel: b.name }).catch(() => {});
  }
  // Skill: Auton's own rules, map-only (switched off globally, so it never changes your other bots).
  let sid = (await own(userId, "skill"))[0]?.ref_id;
  if (!sid) {
    const { createMapInstruction } = await import("../map");
    const sk = await createMapInstruction(userId, "skill", "Auton rules", "stop loss 4%, take profit 3%, buy on a 2% dip; skip coins that kept losing; never more than its budget", false);
    sid = sk.id; await remember(userId, "skill", sk.id, "Auton rules");
    await L("execution", "Created skill “Auton rules” (applies only to Auton's own bots)");
  }
  // Scout agent: research-only, no capital (it watches the market and reports; Auton decides).
  if (!(await own(userId, "agent")).length) {
    try {
      const { createAgent } = await import("../agents/service");
      const { ROLE_IDS } = await import("../agents/catalog");
      const role = ROLE_IDS.includes("market_scanner") ? "market_scanner" : ROLE_IDS.includes("news") ? "news" : ROLE_IDS[0];
      const ag: any = await createAgent(userId, { name: "Auton Scout", role, assets: ["BTC", "ETH", "SOL"], autonomy: 1, capitalUsd: 0 } as any);
      if (ag?.id) { await remember(userId, "agent", ag.id, "Auton Scout"); await L("execution", "Created agent “Auton Scout” (watches the market for Auton, no capital)"); }
    } catch (e: any) { await log(userId, conv, "warning", "Couldn't create the scout agent", String(e?.message ?? e).slice(0, 200)); }
  }
  // Map "Auton": Auton → plan method ← its prompt + skill, → its bots.
  const { listMaps, createMap, getMap, saveMap } = await import("../map");
  let mapId = (await own(userId, "map"))[0]?.ref_id;
  if (mapId && !(await one("SELECT 1 FROM strategy_maps WHERE id=$1 AND user_id=$2", [mapId, userId]))) mapId = undefined;
  if (!mapId) { const existing = (await listMaps(userId)).find((m: any) => m.name === "Auton"); const m = existing ?? (await createMap(userId, "Auton")); mapId = m.id; await remember(userId, "map", m.id, "Auton"); }
  const m = await getMap(userId, mapId);
  const nodes: any[] = (m.nodes ?? []).filter((n: any) => !String(n.id).startsWith("auton-")), edges: any[] = (m.edges ?? []).filter((e: any) => !String(e.id).startsWith("auton-"));
  const N = (id: string, type: string, x: number, y: number, data: any) => nodes.push({ id: `auton-${id}`, type, position: { x, y }, data });
  const E = (a: string, b: string) => edges.push({ id: `auton-e-${a}-${b}`, source: `auton-${a}`, target: `auton-${b}` });
  N("brain", "auton", 0, 0, { label: "Auton" });
  N("plan", "method", 340, 0, { label: "Auton plan" });
  N("prompt", "prompt", 340, -210, { label: "Auton prompt", text: `${s.goals ? `${s.goals}. ` : ""}buy on a 2% dip, take profit 3%, stop loss 4%, $${Math.max(5, Math.floor(s.max_capital_usd / Math.max(1, s.max_bots)))} per trade` });
  N("skill", "skill", 340, 210, { refId: sid, label: "Auton rules" });
  E("brain", "plan"); E("prompt", "plan"); E("skill", "plan");
  live.forEach((b, i) => { N(`b${i}`, "bot", 700, (i - (live.length - 1) / 2) * 150, { refId: b.id, label: b.name }); E("plan", `b${i}`); });
  await saveMap(userId, mapId!, { nodes, edges });
}

/** Worker: run every active Auton that's due. */
export async function runDueAutons() {
  const due = await q<any>("UPDATE auton_settings SET next_run_at = now() + make_interval(secs => every_sec) WHERE active AND next_run_at <= now() RETURNING user_id");
  for (const d of due) await runAuton(d.user_id).catch((e) => log(d.user_id, null, "warning", "Cycle failed", String(e?.message ?? e).slice(0, 300)));
  return due.length;
}

/** Prompt box with AI = Auton (or "auton …" anywhere): settings, goals and an immediate cycle. */
export async function autonCommand(userId: string, text: string, conversationId: string | null): Promise<string> {
  const t = text.trim(), tl = t.toLowerCase();
  if (/\b(stop|turn off|pause|disable|halt)\b/.test(tl) && !/\b(stop.?loss)\b/.test(tl)) { await setAuton(userId, { active: false }); return "Auton is off. Its bots keep running as they are (turn them off from Edit all, or say “turn off all bots”). Say “start Auton” to turn it back on."; }
  const patch: any = { conversationId };
  const budget = t.match(/\b(?:budget|capital|spend|use|with)\b[^$\d]{0,12}\$?\s*([\d,]+(?:\.\d+)?k?)/i);
  if (budget) { const r = budget[1].replace(/,/g, ""); patch.maxCapitalUsd = r.endsWith("k") ? Number(r.slice(0, -1)) * 1000 : Number(r); }
  const mb = t.match(/\b(?:max(?:imum)?|up to|at most)\s*(\d{1,2})\s*bots?\b|\b(\d{1,2})\s*bots?\s*max\b/i);
  if (mb) patch.maxBots = Number(mb[1] ?? mb[2]);
  const ev = t.match(/\bevery\s*(\d+)\s*(min|minute|hour|hr)s?\b/i);
  if (ev) patch.everySec = Number(ev[1]) * (/h/i.test(ev[2]) ? 3600 : 60);
  if (/\breal money\b/i.test(t)) patch.realMoney = !/\b(no|not|without|off|paper only)\b.{0,12}real money|\breal money\b.{0,8}\b(off|no)\b/i.test(t);
  if (/\bpaper( only)?\b/i.test(t) && !/real money/i.test(t)) patch.realMoney = false;
  // Anything else is a goal ("focus on solana meme coins", "safe large caps", "make steady small profits on NVDA and TSLA").
  const goal = t.replace(/\b(auton|start|turn on|run|go|now|please|budget|capital)\b/gi, " ").replace(/\$?\s*[\d,]+(\.\d+)?k?\s*(usd|dollars)?/gi, " ").replace(/\b(max(imum)?|up to|at most|every)\b.*?\b(bots?|min(ute)?s?|hours?)\b/gi, " ").replace(/\b(real money|paper( only)?)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (goal.length >= 4) patch.goals = goal;
  patch.active = true;
  const s = await setAuton(userId, patch);
  const r = await runAuton(userId, { conversationId });
  return `Auton is on (${s.real_money ? "real money allowed" : "paper money"}, budget $${Number(s.max_capital_usd)}, up to ${s.max_bots} bots, checks every ${Math.round(Number(s.every_sec) / 60)} min${s.goals ? `, goals: “${s.goals}”` : ""}).\n${r.summary}\n\nEverything it thinks and does is in Activity → Auton. Its setup is on the “Auton” map. Say “stop Auton” to turn it off, or “auton budget $2000” / “auton max 8 bots” to change its limits.`;
}
