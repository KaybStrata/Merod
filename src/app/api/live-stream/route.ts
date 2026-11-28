import { requireUser, isAdminRole } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { getSettings } from "@/server/auto/engine";

/**
 * One real-time stream of everything thinking, deciding and executing for you on Merod:
 * agents (thoughts/analysis/decisions/executions), bots (observations/triggers/orders/results), auto trading + Modo,
 * your orders and fills, copy/mimic trades, and Merod itself (platform trades, worker/system events for admins).
 * Newest first; `since` (ms) returns only newer items for live polling.
 */
type Item = { id: string; at: string; source: "agent" | "bot" | "auto" | "modo" | "order" | "copy" | "merod" | "update" | "auton"; kind: "thought" | "analysis" | "decision" | "execution" | "warning" | "state"; actor: string; title: string; body?: string; link?: string; side?: "buy" | "sell"; pnl?: number; pnlPct?: number; coin?: Coin; /** agent decision with a Why card */ eventId?: number };
/** The coin a bot line is about, with its live price and move (since the bot bought it, or 24h). */
type Coin = { symbol: string; price?: number; move?: number | null; basis?: string };
const BOT_KIND: Record<string, Item["kind"]> = { observation: "analysis", trigger: "decision", instruction: "decision", order: "execution", result: "execution", warning: "warning", error: "warning", control: "state" };
const AGENT_KIND: Record<string, Item["kind"]> = { thought: "thought", analysis: "analysis", decision: "decision", execution: "execution", warning: "warning", approval: "decision", training: "analysis", state: "state", message: "analysis", system: "state" };

/** trades = your orders + Mimic copies; automation = Auto + Modo. */
type Filter = "all" | "order" | "bot" | "agent" | "auto" | "modo" | "copy" | "update" | "auton" | "buy" | "sell" | "profit" | "loss" | "trades" | "automation";
const GROUP: Partial<Record<Filter, string[]>> = { trades: ["order", "copy"], automation: ["auto", "modo"] };
const TRADE_FILTERS = new Set(["buy", "sell", "profit", "loss"]);
/** Same predicate the panel uses: Buys/Sells by side across sources; Profit/Loss by realized $ (or % for theoretical trades). */
function matches(i: Item, f: Filter) {
  if (f === "all") return true;
  if (f === "buy" || f === "sell") return i.side === f;
  const p = i.pnl ?? i.pnlPct;
  if (f === "profit") return p !== undefined && p > 0;
  if (f === "loss") return p !== undefined && p < 0;
  return GROUP[f] ? GROUP[f]!.includes(i.source) : i.source === f;
}

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  // `filter` narrows the stream on the server, so chatty sources (bot status lines every tick) can't push trades out of
  // the list: all | order | bot | agent | auto | modo | copy | buy | sell | profit | loss. Filtered views look back 30 days.
  const filter = (sp.get("filter") ?? "all") as Filter;
  const since = sp.get("since") ? new Date(Number(sp.get("since"))) : new Date(Date.now() - (filter === "all" ? 24 : 30 * 24) * 3600_000);
  const lim = Math.min(300, Number(sp.get("limit") ?? 150));
  const owner = u.role === "super_admin";
  const want = (src: Item["source"]) => filter === "all" || filter === src || !!GROUP[filter]?.includes(src) || (TRADE_FILTERS.has(filter) && ["order", "copy", "auto", "modo", "merod"].includes(src));
  const none = Promise.resolve([] as any[]);
  // Orders: a side / P&L filter is applied in SQL so the newest 150 rows are the ones that match.
  const orderCond = filter === "buy" ? " AND o.side='buy'" : filter === "sell" ? " AND o.side='sell'"
    : filter === "profit" ? " AND o.side='sell' AND o.realized_pnl > 0" : filter === "loss" ? " AND o.side='sell' AND o.realized_pnl < 0" : "";
  const pnlOnly = filter === "profit" || filter === "loss";
  // A Talk tab's own activity: only what that conversation started (its prompts' orders, its bots, its agents, its Auton).
  const tab = sp.get("conv");
  const scope = tab ? await (await import("@/server/talk/tab-scope")).tabScope(u.id, tab) : null;
  const tabCond = scope ? (await import("@/server/talk/tab-scope")).tabOrderCond(4) : "";
  const tabArgs = scope ? [scope.msgIds, scope.botIds, scope.agentIds] : [];
  const [agentsAll, botsAll, orders, copies, platform, system] = await Promise.all([
    want("agent") && !TRADE_FILTERS.has(filter) ? q<any>(`SELECT e.id, e.created_at, e.kind, e.title, e.body, e.agent_id, a.name, (e.data ? 'orderId' OR (e.data ? 'signal' AND e.data ? 'inputs')) AS explainable FROM agent_events e LEFT JOIN agents a ON a.id=e.agent_id WHERE e.user_id=$1 AND e.created_at > $2 ORDER BY e.id DESC LIMIT $3`, [u.id, since, lim]) : none,
    want("bot") && !TRADE_FILTERS.has(filter) ? q<any>(`SELECT l.id, l.created_at, l.level, l.message, l.data, b.id AS bot_id, b.name FROM bot_activity_logs l JOIN trading_bots b ON b.id=l.bot_id WHERE b.user_id=$1 AND l.created_at > $2 ORDER BY l.id DESC LIMIT $3`, [u.id, since, lim]) : none,
    want("order") ? q<any>(`SELECT o.id, o.updated_at, o.side, o.status, o.source, o.is_paper, o.filled_quantity, o.avg_fill_price, o.notional_usd, o.status_reason, o.realized_pnl, a.symbol, a.id AS asset_id
              FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 AND o.updated_at > $2${orderCond}${tabCond} ORDER BY o.updated_at DESC LIMIT $3`, [u.id, since, lim, ...tabArgs]) : none,
    want("copy") && !pnlOnly && !scope ? q<any>(`SELECT e.id, e.created_at, e.side, e.symbol, e.status, e.reason, e.venue, f.label FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id WHERE f.follower_id=$1 AND e.created_at > $2${filter === "buy" || filter === "sell" ? ` AND e.side='${filter}'` : ""} ORDER BY e.id DESC LIMIT $3`, [u.id, since, lim]) : none,
    want("merod") && !pnlOnly && filter !== "order" && !scope ? q<any>(`SELECT x.id, x.executed_at, o.side, x.quantity, x.price, o.is_paper, o.source, a.symbol, a.id AS asset_id FROM executions x JOIN orders o ON o.id=x.order_id JOIN assets a ON a.id=o.asset_id
             WHERE x.executed_at > $1 AND o.user_id <> $2${filter === "buy" || filter === "sell" ? ` AND o.side='${filter}'` : ""} ORDER BY x.executed_at DESC LIMIT 60`, [since, u.id]) : none,
    isAdminRole(u.role) && filter === "all" && !scope ? q<any>(`SELECT id, created_at, source, level, message FROM system_events WHERE created_at > $1 ORDER BY id DESC LIMIT 40`, [since]) : none,
  ]);
  const agents = scope ? agentsAll.filter((e: any) => scope.agentIds.includes(String(e.agent_id))) : agentsAll;
  const bots = scope ? botsAll.filter((l: any) => scope.botIds.includes(String(l.bot_id))) : botsAll;
  const items: Item[] = [];
  for (const e of agents) items.push({ id: `ag${e.id}`, eventId: e.explainable ? Number(e.id) : undefined, at: e.created_at, source: "agent", kind: AGENT_KIND[e.kind] ?? "state", actor: e.name ?? "Agent", title: e.title, body: e.body || undefined, link: e.agent_id ? `/agents/${e.agent_id}` : "/agents" });
  for (const l of bots) {
    // Older lines carried the coin in the text ("ZERO @ 0.000270100 (dexscreener) — …"): lift it into the header too.
    let coin: Coin | undefined = l.data?.coin ?? undefined, title = l.message as string;
    const old = !coin && /^([A-Za-z0-9$._-]{1,20}) @ ([\d.e+-]+) \(([^)]+)\)(?: — (.*))?$/s.exec(title);
    if (old) {
      title = old[4] ?? `${old[1]} @ $${old[2]}`;
      const mv = /bought at [^,]+, now [^(]+\((up|down) ([\d.]+)%\)/.exec(title) ?? /Holding: ([+-]?)([\d.]+)%/.exec(title);
      const move = mv ? (mv[1] === "down" || mv[1] === "-" ? -1 : 1) * Number(mv[2]) : null;
      coin = { symbol: old[1], price: Number(old[2]), move, basis: mv ? "since buy" : undefined };
    }
    items.push({ id: `bt${l.id}`, at: l.created_at, source: "bot", kind: BOT_KIND[l.level] ?? "state", actor: l.name, title, coin, link: `/bots/${l.bot_id}` });
  }
  for (const o of orders) {
    const filled = Number(o.filled_quantity) > 0;
    const what = filled ? `${o.side === "buy" ? "Bought" : "Sold"} ${Number(o.filled_quantity).toPrecision(5)} ${o.symbol} @ $${Number(o.avg_fill_price).toPrecision(6)}` : `${o.side === "buy" ? "Buy" : "Sell"} ${o.symbol}${o.notional_usd ? ` $${Number(o.notional_usd).toFixed(2)}` : ""}: ${String(o.status).replace("_", " ")}`;
    const pnl = o.side === "sell" && filled && Number(o.realized_pnl) !== 0 ? Number(o.realized_pnl) : undefined;
    const cost = pnl !== undefined ? Number(o.filled_quantity) * Number(o.avg_fill_price) - pnl : 0;
    items.push({ id: `or${o.id}`, at: o.updated_at, source: "order", side: o.side, pnl, pnlPct: pnl !== undefined && cost > 0 ? (pnl / cost) * 100 : undefined, kind: filled ? "execution" : ["rejected", "failed"].includes(o.status) ? "warning" : "decision",
      actor: `${o.is_paper ? "Paper" : "Real money"} · ${o.source}`, title: what, body: o.status_reason || undefined, link: `/terminal/${o.asset_id}` });
  }
  // New mimics / watches show up in Activity → Mimic right away, before the first copied trade.
  if (!scope && (filter === "all" || filter === "copy")) {
    const follows = await q<any>(`SELECT id, created_at, label, kind, mode, wallet_address, status FROM copy_follows WHERE follower_id=$1 AND created_at > $2 ORDER BY created_at DESC LIMIT 200`, [u.id, since]);
    const n = follows.length;
    for (const f of n > 25 ? follows.slice(0, 1) : follows) items.push({ id: `cf${f.id}`, at: f.created_at, source: "copy", kind: "decision", actor: `Mimic · ${f.label}`,
      title: n > 25 ? `Started mimicking ${n} wallets/traders` : `${f.mode === "watch" ? "Now watching" : "Now mimicking"} ${f.label}${f.status !== "active" ? ` (${f.status})` : ""}`,
      body: f.kind === "wallet" ? (f.mode === "watch" ? "Every swap they make is reported here; nothing is copied." : "Every swap they make is copied with your mimic settings.") : undefined, link: "/mimic" });
  }
  for (const c of copies) items.push({ id: `cp${c.id}`, at: c.created_at, source: "copy", side: c.side, kind: c.status === "copied" ? "execution" : c.status === "failed" ? "warning" : "decision", actor: `Mimic · ${c.label}`, title: `${c.label} ${c.side === "buy" ? "bought" : "sold"} ${c.symbol ?? "a token"} on ${c.venue ?? "?"} → ${c.status.replace("_", " ")}`, body: c.reason || undefined, link: "/mimic" });
  for (const p of platform) items.push({ id: `pl${p.id}`, at: p.executed_at, source: "merod", side: p.side, kind: "execution", actor: `Merod trader${p.is_paper ? " (paper)" : ""}`, title: `${p.side === "buy" ? "Bought" : "Sold"} ${Number(p.quantity).toPrecision(4)} ${p.symbol} @ $${Number(p.price).toPrecision(6)} · via ${p.source}`, link: `/terminal/${p.asset_id}` });
  for (const s of system) items.push({ id: `sy${s.id}`, at: s.created_at, source: "merod", kind: s.level === "info" ? "state" : "warning", actor: `Merod · ${s.source}`, title: s.message });
  if (!scope && owner && (want("auto") || want("modo"))) {
    const auto = await q<any>(`SELECT t.id, t.created_at, t.closed_at, t.symbol, t.mode, t.origin, t.confidence, t.return_pct, t.explain_during, eo.realized_pnl AS exit_pnl FROM auto_trades t LEFT JOIN orders eo ON eo.id=t.exit_order_id WHERE t.user_id=$1 AND greatest(t.created_at, COALESCE(t.closed_at, t.created_at)) > $2 ORDER BY t.created_at DESC LIMIT 60`, [u.id, since]);
    for (const t of auto) {
      const who = t.origin === "modo" ? "modo" : "auto";
      items.push({ id: `at${t.id}`, at: t.created_at, source: who, side: "buy", kind: t.mode === "real" && t.explain_during ? "execution" : "decision", actor: who === "modo" ? "Modo Autopilot" : "Auto trading",
        title: t.mode === "real" && t.explain_during ? `${t.symbol}: ${String(t.explain_during).split(".")[0]}` : `Decided to buy ${t.symbol}${t.mode === "theory" ? " (theoretical)" : ""} · ${Math.round(Number(t.confidence) * 100)}% confidence`, link: "/auto" });
      if (t.closed_at && new Date(t.closed_at) > since) items.push({ id: `ac${t.id}`, at: t.closed_at, source: who, side: "sell", pnl: t.exit_pnl != null && Number(t.exit_pnl) !== 0 ? Number(t.exit_pnl) : undefined, pnlPct: t.return_pct != null ? Number(t.return_pct) : undefined, kind: "execution", actor: who === "modo" ? "Modo Autopilot" : "Auto trading", title: `Closed ${t.symbol} ${Number(t.return_pct) >= 0 ? "+" : ""}${Number(t.return_pct).toFixed(2)}%${t.mode === "theory" ? " (theoretical)" : ""}`, link: "/auto" });
    }
    const s = filter === "all" || filter === "modo" || filter === "automation" ? await getSettings(u.id) : { modo_thoughts: [] as any[] };
    for (const [i, th] of (s.modo_thoughts ?? []).slice(-80).entries()) {
      const at = new Date(th.at);
      if (at > since) items.push({ id: `mt${at.getTime()}${i}`, at: at.toISOString(), source: "modo", kind: th.kind === "idea" ? "decision" : "thought", actor: "Modo", title: th.text, link: "/auto" });
    }
  }
  // Auton: every thought, analysis, decision and action. ?conv= limits it to the Talk tab (conversation) Auton reports to.
  const conv = tab;
  if (want("auton") && !TRADE_FILTERS.has(filter)) {
    const ev = await q<any>(`SELECT id, created_at, kind, title, body FROM auton_events WHERE user_id=$1 AND created_at > $2 ${conv ? "AND conversation_id=$4" : ""} ORDER BY id DESC LIMIT $3`,
      conv ? [u.id, since, lim, conv] : [u.id, since, lim]).catch(() => []);
    for (const e of ev) items.push({ id: `au${e.id}`, at: e.created_at, source: "auton", kind: e.kind, actor: "Auton", title: e.title, body: e.body ?? undefined, link: "/map" });
  }
  // Update / Recording (Talk) and the Advisor: what was analysed, what it suggested, what got applied.
  if (!scope && want("update") && !TRADE_FILTERS.has(filter)) {
    const [ups, tips] = await Promise.all([
      q<any>("SELECT * FROM trade_updates WHERE user_id=$1 AND created_at > $2 ORDER BY id DESC LIMIT 60", [u.id, since]).catch(() => []),
      q<any>("SELECT * FROM advisor_tips WHERE user_id=$1 AND (created_at > $2 OR applied_at > $2) ORDER BY id DESC LIMIT 60", [u.id, since]).catch(() => []),
    ]);
    const span = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${h}h`);
    for (const x of ups) {
      const st = x.stats ?? {}, who = x.source === "record" ? "Recording" : "Update", decisions: any[] = x.decisions ?? [];
      const quiet = !st.orders && !decisions.length;
      if (quiet && filter !== "update") continue; // quiet recorder checks only show in the Updates tab
      items.push({ id: `tu${x.id}`, at: x.created_at, source: "update", kind: "analysis", actor: who, link: "/talk?update=1",
        title: quiet ? `Checked the last ${span(Number(x.hours))}: no new trades, nothing to change` : `Analyzed the last ${span(Number(x.hours))}: ${st.orders} orders, ${st.closed} closed${st.winRate != null ? ` (${st.winRate}% won)` : ""}, ${Number(st.net) >= 0 ? "+" : "-"}$${Math.abs(Number(st.net ?? 0)).toFixed(2)}`,
        body: quiet ? undefined : [st.best ? `Best ${st.best.name} +$${st.best.net}` : null, st.worst ? `worst ${st.worst.name} -$${Math.abs(st.worst.net)}` : null, decisions.length ? `${decisions.length} suggestion${decisions.length === 1 ? "" : "s"}` : "nothing needs changing"].filter(Boolean).join(" · ") });
      for (const [i, d] of decisions.entries()) {
        const ap = x.applied?.[i];
        items.push({ id: `td${x.id}-${i}`, at: new Date(new Date(x.created_at).getTime() + 1 + i).toISOString(), source: "update", kind: "decision", actor: who, link: "/talk?update=1",
          title: `Suggests: ${d.title}`, body: `${d.why}${ap ? "" : d.safe ? " · Waiting for you (lowers risk)." : " · Waiting for you."}` });
        if (ap) items.push({ id: `tx${x.id}-${i}`, at: typeof ap === "string" ? x.created_at : ap.at, source: "update", kind: "execution", actor: who, title: `Applied: ${d.title}`, body: typeof ap === "string" ? ap : ap.line, link: "/talk?update=1" });
      }
    }
    for (const t of tips) {
      if (new Date(t.created_at) > since) items.push({ id: `av${t.id}`, at: t.created_at, source: "update", kind: t.priority === 1 ? "decision" : "analysis", actor: `Advisor · ${t.topic}`, title: t.title, body: t.body, link: t.link ?? "/advisor" });
      if (t.applied_at && new Date(t.applied_at) > since) items.push({ id: `ax${t.id}`, at: t.applied_at, source: "update", kind: "execution", actor: "Advisor", title: `Done: ${t.title}`, body: t.applied_note ?? undefined, link: "/advisor" });
    }
  }
  for (const it of items) it.at = new Date(it.at as any).toISOString();
  const kept = items.filter((i) => matches(i, filter));
  kept.sort((a, b) => b.at.localeCompare(a.at));
  if (filter !== "all") return ok({ items: kept.slice(0, lim), filter, now: Date.now() });
  // "All": up to half the list is reserved for trades (orders, fills, Mimic, Auto/Modo buys and closes), so a bot that
  // logs a status line every few seconds can never push your buys and sells out of view.
  const isTrade = (i: Item) => i.side !== undefined || i.pnl !== undefined;
  const trades = kept.filter(isTrade).slice(0, Math.ceil(lim / 2));
  const rest = kept.filter((i) => !isTrade(i)).slice(0, lim - trades.length);
  return ok({ items: [...trades, ...rest].sort((a, b) => b.at.localeCompare(a.at)), filter, now: Date.now() });
});
