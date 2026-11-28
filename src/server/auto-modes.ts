import "@/lib/server-only-shim";
import { one, q } from "./db";
import { applyEdits } from "./ai/bulk-edit";

/**
 * Auto switches — four helpers that run on their own once switched on:
 *  - Auto trainer:  learns from each bot's results and tunes its settings (the existing trainer; this is its on/off).
 *  - Auto gainer:   raises a bot's $ per trade (an agent's capital) by part of each winning trade's profit — more buying
 *                   power after wins; gives it back toward the starting amount after losses. Capped (default 5× start).
 *  - Auto adjuster: fits stop-loss / take-profit / dip to how much the coin or stock is moving right now.
 *  - Auto scanner:  scans all coins and stocks for the strongest movers; a bot it's attached to that's sitting idle
 *                   (holding nothing) is pointed at the best one.
 * Each can be on for everything (scope 'all') or only for chosen bots/agents (from a map, a bot's page or a prompt).
 */
export type AutoMode = "trainer" | "gainer" | "adjuster" | "scanner";
export const MODES: AutoMode[] = ["trainer", "gainer", "adjuster", "scanner"];
export const MODE_INFO: Record<AutoMode, { name: string; blurb: string }> = {
  trainer: { name: "Auto trainer", blurb: "Learns from every trade and tunes your bots' settings" },
  gainer: { name: "Auto gainer", blurb: "Grows $ per trade from winning trades' profit (more buying power after wins)" },
  adjuster: { name: "Auto adjuster", blurb: "Fits stop-loss, take-profit and dip to how much each asset is moving" },
  scanner: { name: "Auto scanner", blurb: "Scans all coins & stocks for top movers and points idle bots at them" },
};
type Scope = "all" | "bot" | "agent";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The user's switches (global) plus the per-bot/agent ones. Auto trainer's global state comes from the trainer's own setting. */
export async function listModes(userId: string) {
  const rows = await q<any>("SELECT mode, scope, scope_ref, active, settings, last_run_at, last_note FROM auto_modes WHERE user_id=$1", [userId]);
  const tr = await one<any>("SELECT enabled FROM auto_training_settings WHERE user_id=$1", [userId]);
  const global = MODES.map((m) => {
    const r = rows.find((x) => x.mode === m && x.scope === "all");
    const active = m === "trainer" ? (tr ? !!tr.enabled : true) : !!r?.active;
    return { mode: m, ...MODE_INFO[m], active, settings: r?.settings ?? {}, last_run_at: r?.last_run_at ?? null, last_note: r?.last_note ?? null };
  });
  const scoped = rows.filter((x) => x.scope !== "all");
  return { global, scoped };
}

/** Switch one on/off, for everything or for one bot/agent. */
export async function setMode(userId: string, mode: AutoMode, active: boolean, scope: Scope = "all", scopeRef = "", settings?: Record<string, unknown>) {
  await q(`INSERT INTO auto_modes (user_id, mode, scope, scope_ref, active, settings) VALUES ($1,$2,$3,$4,$5,COALESCE($6::jsonb,'{}'))
           ON CONFLICT (user_id, mode, scope, scope_ref) DO UPDATE SET active=$5, settings = auto_modes.settings || COALESCE($6::jsonb,'{}'), updated_at=now()`,
    [userId, mode, scope, scope === "all" ? "" : scopeRef, active, settings ? JSON.stringify(settings) : null]);
  if (mode === "trainer") {
    if (scope === "all") await q(`INSERT INTO auto_training_settings (user_id, enabled) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET enabled=$2`, [userId, active]);
    else if (scope === "bot") await q("UPDATE trading_bots SET auto_training=$3 WHERE id=$1 AND user_id=$2", [scopeRef, userId, active ? "on" : "inherit"]);
  }
  return listModes(userId);
}

/** "turn on auto gainer", "auto scanner off", "turn on all auto switches", "auto gainer 25%", "auto adjuster on for Dip A". */
export async function autoModeCommand(userId: string, text: string): Promise<string | null> {
  const t = text.toLowerCase();
  const names: [AutoMode, RegExp][] = [["trainer", /auto[\s-]?train(?:er|ing)?/], ["gainer", /auto[\s-]?gain(?:er)?/], ["adjuster", /auto[\s-]?adjust(?:er|ing)?/], ["scanner", /auto[\s-]?scan(?:ner|ning)?/]];
  let picked = names.filter(([, re]) => re.test(t)).map(([m]) => m);
  const all = /\b(all|every)\s+(?:the\s+|4\s+|four\s+)?auto\s*(?:switches|modes|toggles|helpers)\b|\ball (?:the )?autos\b|\bauto (?:switches|modes|toggles)\b/.test(t);
  if (all) picked = [...MODES];
  if (!picked.length) return null;
  const off = /\b(off|stop|disable|pause|deactivate|turn off|switch off)\b/.test(t);
  const on = /\b(on|start|enable|activate|turn on|switch on|use|add)\b/.test(t);
  const status = /\b(status|show|what|which|list)\b/.test(t) && !on && !off;
  if (status || (!on && !off)) {
    const m = await listModes(userId);
    return ["Your auto switches (use the switches below, or say “turn on auto gainer”):", ...m.global.map((g) => `• ${g.name}: ${g.active ? "ON" : "off"} — ${g.blurb}${g.last_note ? ` (last: ${g.last_note})` : ""}`)].join("\n");
  }
  const settings: Record<string, unknown> = {};
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct && picked.includes("gainer")) settings.share = clamp(Number(pct[1]) / 100, 0.01, 1);
  const cap = t.match(/(?:cap|max(?:imum)?|up to)\s*(?:of\s*)?\$?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (cap && picked.includes("gainer")) settings.max_usd = Number(cap[1].replace(/,/g, ""));
  // Scope: "for <bot name>" → just that bot/agent.
  const { parseTargets } = await import("./ai/bulk-edit");
  const forPart = t.match(/\b(?:for|on|to)\s+(?!all\b|every\b|everything\b)(.+)$/)?.[1];
  const targets = forPart ? await parseTargets(userId, forPart).catch(() => null) : null;
  const lines: string[] = [];
  for (const m of picked) {
    if (targets?.length) {
      for (const x of targets) await setMode(userId, m, !off, x.kind as Scope, x.id, Object.keys(settings).length ? settings : undefined);
      lines.push(`• ${MODE_INFO[m].name} ${off ? "off" : "on"} for ${targets.map((x) => x.name).join(", ")}.`);
    } else {
      await setMode(userId, m, !off, "all", "", Object.keys(settings).length ? settings : undefined);
      lines.push(`• ${MODE_INFO[m].name} ${off ? "off" : "ON"} for all bots and agents — ${MODE_INFO[m].blurb.toLowerCase()}.`);
    }
  }
  if (settings.share) lines.push(`  Auto gainer adds ${Math.round(Number(settings.share) * 100)}% of each winning trade's profit to $ per trade.`);
  if (settings.max_usd) lines.push(`  Auto gainer cap: $${settings.max_usd} per trade.`);
  return lines.join("\n");
}

// ───────────────────────────── worker ─────────────────────────────

/** Bots/agents a switch covers: scope 'all' → every running bot/agent of the user; otherwise just the one. */
async function targetsFor(row: any) {
  if (row.scope === "bot") return { bots: await q<any>("SELECT * FROM trading_bots WHERE id::text=$1 AND user_id=$2 AND status='running'", [row.scope_ref, row.user_id]), agents: [] as any[] };
  if (row.scope === "agent") return { bots: [] as any[], agents: await q<any>("SELECT * FROM agents WHERE id::text=$1 AND user_id=$2 AND status='running'", [row.scope_ref, row.user_id]) };
  return {
    bots: await q<any>("SELECT * FROM trading_bots WHERE user_id=$1 AND status='running'", [row.user_id]),
    agents: await q<any>("SELECT * FROM agents WHERE user_id=$1 AND status='running'", [row.user_id]).catch(() => []),
  };
}
async function botLog(botId: string, message: string, data: unknown = {}) {
  await q("INSERT INTO bot_activity_logs (bot_id, level, message, data) VALUES ($1,'instruction',$2,$3)", [botId, message, JSON.stringify(data)]).catch(() => {});
}
async function finish(row: any, note: string | null, state: any) {
  await q("UPDATE auto_modes SET last_run_at=now(), last_note=COALESCE($2,last_note), state=$3 WHERE id=$1", [row.id, note, JSON.stringify(state)]);
}

/** Auto gainer: profits from wins since the last check grow $ per trade (bots) / capital (agents). Losses shrink it back toward the start. */
export async function runGainer(row: any) {
  const share = Number(row.settings?.share ?? 0.5), maxMult = Number(row.settings?.max_mult ?? 5), maxUsd = Number(row.settings?.max_usd ?? 0);
  const state = { base: {}, since: null, ...(row.state ?? {}) } as { base: Record<string, number>; since: string | null };
  const since = state.since ?? new Date(Date.now() - 60_000).toISOString();
  const { bots, agents } = await targetsFor(row);
  const notes: string[] = [];
  let newest = since;
  for (const [kind, list] of [["bot", bots], ["agent", agents]] as const) {
    for (const b of list) {
      const sells = await q<any>(`SELECT realized_pnl, updated_at FROM orders WHERE user_id=$1 AND source=$2 AND source_ref=$3 AND side='sell' AND status IN ('filled','partially_filled')
                                    AND updated_at > $4 ORDER BY updated_at`, [row.user_id, kind, String(b.id), since]);
      if (!sells.length) continue;
      const pnl = sells.reduce((s, o) => s + Number(o.realized_pnl ?? 0), 0);
      for (const o of sells) if (new Date(o.updated_at).toISOString() > newest) newest = new Date(o.updated_at).toISOString();
      if (Math.abs(pnl) < 0.01) continue;
      const cur = kind === "bot" ? Number(b.params?.amount_usd ?? 0) : Number(b.capital_usd ?? 0);
      if (!(cur > 0)) continue;
      const base = state.base[b.id] ?? cur; state.base[b.id] = base;
      const cap = maxUsd > 0 ? maxUsd : base * maxMult;
      const next = r2(pnl > 0 ? Math.min(cap, cur + pnl * share) : Math.max(base, cur + pnl * share));
      if (Math.abs(next - cur) < 0.01) continue;
      await applyEdits(row.user_id, [{ kind, id: b.id, name: b.name }], kind === "bot" ? { amountUsd: next } : { capitalUsd: next });
      const msg = `Auto gainer: ${pnl > 0 ? "won" : "lost"} $${Math.abs(r2(pnl))} → ${kind === "bot" ? "$ per trade" : "capital"} $${r2(cur)} → $${next}${next >= cap ? " (at cap)" : ""}`;
      if (kind === "bot") await botLog(b.id, msg, { pnl, from: cur, to: next });
      notes.push(`${b.name} $${r2(cur)}→$${next}`);
    }
  }
  state.since = newest > since ? newest : new Date().toISOString();
  await finish(row, notes.length ? notes.slice(0, 4).join(", ") : null, state);
  return notes;
}

/** Auto adjuster: stop-loss / take-profit / dip sized to the asset's 24h move. At most once per 5 minutes per bot. */
export async function runAdjuster(row: any) {
  const state = { last: {}, ...(row.state ?? {}) } as { last: Record<string, number> };
  const { bots } = await targetsFor(row);
  const notes: string[] = [];
  for (const b of bots) {
    if (Date.now() - (state.last[b.id] ?? 0) < 5 * 60_000) continue;
    state.last[b.id] = Date.now();
    const a = await one<any>("SELECT symbol, change_24h FROM assets WHERE id = ANY($1::uuid[]) ORDER BY abs(COALESCE(change_24h,0)) DESC LIMIT 1", [b.asset_ids ?? []]).catch(() => null);
    const vol = Math.abs(Number(a?.change_24h ?? NaN));
    if (!Number.isFinite(vol)) continue;
    const p = b.params ?? {};
    const edit: any = {};
    const tp = r2(clamp(vol * 0.6, 1.5, 25)), sl = r2(clamp(vol * 0.5, 1, 15)), dip = r2(clamp(vol * 0.3, 0.5, 10));
    if (p.take_profit_pct != null && Math.abs(Number(p.take_profit_pct) - tp) >= 0.25) edit.takeProfitPct = tp;
    if (p.stop_loss_pct != null && Number(p.stop_loss_pct) > 0 && Math.abs(Number(p.stop_loss_pct) - sl) >= 0.25) edit.stopLossPct = sl;
    if (p.dip_pct != null && Number(p.dip_pct) > 0 && Math.abs(Number(p.dip_pct) - dip) >= 0.25) edit.dipPct = dip;
    if (!Object.keys(edit).length) continue;
    await applyEdits(row.user_id, [{ kind: "bot", id: b.id, name: b.name }], edit);
    const msg = `Auto adjuster: ${a.symbol} moved ${r2(vol)}% in 24h → ${[edit.takeProfitPct && `take-profit +${edit.takeProfitPct}%`, edit.stopLossPct && `stop-loss −${edit.stopLossPct}%`, edit.dipPct && `dip ${edit.dipPct}%`].filter(Boolean).join(", ")}`;
    await botLog(b.id, msg, { vol, edit });
    notes.push(`${b.name}: ${Object.keys(edit).length} setting(s)`);
  }
  await finish(row, notes.length ? notes.slice(0, 4).join(", ") : null, state);
  return notes;
}

/** The strongest movers right now (big 24h move with real volume), coins and stocks. */
export async function topMovers(limit = 8) {
  return q<any>(`SELECT id, symbol, asset_class, change_24h, volume_24h, last_price FROM assets
                  WHERE last_price > 0 AND change_24h IS NOT NULL AND COALESCE(volume_24h,0) > 50000 AND change_24h > 0
                  ORDER BY change_24h * ln(GREATEST(volume_24h, 2)) DESC LIMIT $1`, [limit]).catch(() => []);
}

/** Auto scanner: finds top movers; idle bots it covers (holding nothing) are pointed at the best one they don't already watch. */
export async function runScanner(row: any) {
  const state = { last: {}, ...(row.state ?? {}) } as { last: Record<string, number>; top?: any[] };
  const movers = await topMovers(8);
  state.top = movers.map((m) => ({ symbol: m.symbol, change: r2(Number(m.change_24h)) }));
  const notes: string[] = [];
  if (row.scope === "bot") {
    const { bots } = await targetsFor(row);
    for (const b of bots) {
      if (Date.now() - (state.last[b.id] ?? 0) < 10 * 60_000) continue;
      const held = await one<any>(`SELECT COALESCE(SUM(CASE WHEN side='buy' THEN filled_quantity ELSE -filled_quantity END),0) AS qty FROM orders
                                    WHERE user_id=$1 AND source='bot' AND source_ref=$2 AND status IN ('filled','partially_filled')`, [row.user_id, String(b.id)]);
      if (Number(held?.qty ?? 0) > 1e-9) continue; // mid-trade: leave it alone
      const pick = movers.find((m) => !(b.asset_ids ?? []).includes(m.id));
      if (!pick) continue;
      state.last[b.id] = Date.now();
      await q("UPDATE trading_bots SET asset_ids=ARRAY[$3::uuid], updated_at=now() WHERE id=$1 AND user_id=$2", [b.id, row.user_id, pick.id]);
      await botLog(b.id, `Auto scanner: switched to ${pick.symbol} (+${r2(Number(pick.change_24h))}% in 24h, top mover)`, { symbol: pick.symbol });
      notes.push(`${b.name} → ${pick.symbol}`);
    }
  }
  const note = notes.length ? notes.join(", ") : movers.length ? `Top movers: ${movers.slice(0, 4).map((m) => `${m.symbol} +${r2(Number(m.change_24h))}%`).join(", ")}` : null;
  await finish(row, note, state);
  return notes;
}

/** Worker entry: every switched-on gainer/adjuster/scanner, once per ~30 s (trainer runs in the trainer's own loop). */
export async function runAutoModes() {
  const rows = await q<any>("SELECT * FROM auto_modes WHERE active AND mode <> 'trainer' AND (last_run_at IS NULL OR last_run_at < now() - interval '25 seconds') LIMIT 500");
  let n = 0;
  for (const row of rows) {
    try {
      if (row.mode === "gainer") await runGainer(row);
      else if (row.mode === "adjuster") await runAdjuster(row);
      else if (row.mode === "scanner") await runScanner(row);
      n++;
    } catch (e: any) { await q("UPDATE auto_modes SET last_run_at=now(), last_note=$2 WHERE id=$1", [row.id, `error: ${String(e.message).slice(0, 120)}`]).catch(() => {}); }
  }
  return n;
}
