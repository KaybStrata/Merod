import "@/lib/server-only-shim";
import { q, one } from "../db";
import { usdPx, moveTxt } from "../bots/strategies";

/**
 * Status questions about YOUR activity: bots, agents, trades/orders, positions, P&L, Auto/Modo, Mimic.
 * ("how are my bots doing?", "why hasn't ZERO sold?", "what did I buy today?", "why was my order cancelled?",
 *  "what's my P&L this week?", "status of my agents", "which coins is the meme bot holding?")
 * Commands ("buy…", "pause all bots", "open settings") are never treated as questions.
 */
const COMMAND = /^(please\s+)?(buy|sell|short|create|make|build|set|turn|pause|resume|stop|start|cancel|close|mimic|copy|alert|open|go to|take me|navigate|enable|disable|switch|change|add|remove|delete|approve|apply|rename|edit|update|withdraw|deposit|send|transfer|record|run|launch|deploy)\b/i;
const QUESTION = /\?|^(what|what's|whats|why|how|how's|hows|when|where|which|who|is|are|am|did|does|do|has|have|was|were|will|can you tell|tell me|show( me)?|list|give me|any|status|summar|explain|recap|report|update me|check)\b|\b(status|summary|recap|overview)\b/i;
const TOPIC = /\b(bots?|agents?|fleets?|trades?|trading|orders?|positions?|holdings?|holding|activity|activities|p&l|pnl|profits?|loss(es)?|gains?|portfolio|sold|bought|buys|sells|fills?|filled|cancel+ed|rejected|pending|expired|mimic(king)?|copy(ing)?|copied|auto( trading)?|autopilot|modo|balance|cash|spent|invested|stop.?loss|take.?profit|targets?|executions?|history)\b/i;

export function isStatusQuestion(text: string) {
  const t = text.trim();
  if (!t || COMMAND.test(t)) return false;
  if (/\b(page|screen|tab)\b/i.test(t)) return false; // "show me the bots page" opens the page
  if (!QUESTION.test(t)) return false;
  return TOPIC.test(t) || /\bmy\b/i.test(t) || /\b(did|have|has|was|were) (i|we)\b/i.test(t);
}

type Coin = { symbol: string; price: number; change24h: number | null };
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const ago = (d: string | Date) => {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172_800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`;
};
const PHASE: Record<string, string> = { waiting_dip: "waiting to buy (dip)", buy_pending: "buy placed, waiting to fill", holding: "holding", sell_pending: "sell placed, waiting to fill", done: "finished" };

/**
 * Everything Merod knows right now about the user's activity, as a compact data packet for the AI and as structured
 * rows for the plain (no-AI) answer. Windows: orders 7 days, P&L today + 7 days, logs latest per bot.
 */
export async function statusSnapshot(userId: string) {
  const [bots, positions, orders, pnl, agents, fleets, auto, follows, copies, cash, pending] = await Promise.all([
    q<any>(`SELECT id, name, status, strategy_id, params, state, asset_ids, is_paper, pnl_usd, trades_today, spent_today_usd, approval_required, allow_risky, updated_at
              FROM trading_bots WHERE user_id=$1 AND status <> 'archived' ORDER BY (status='running') DESC, updated_at DESC LIMIT 60`, [userId]),
    q<any>(`SELECT a.symbol, a.id AS asset_id, p.quantity, p.avg_cost, a.last_price, a.change_24h, t.kind = 'paper' AS paper
              FROM positions p JOIN assets a ON a.id=p.asset_id JOIN trading_accounts t ON t.id=p.account_id
             WHERE p.user_id=$1 AND p.quantity > 0 ORDER BY p.quantity * COALESCE(a.last_price,0) DESC LIMIT 100`, [userId]),
    q<any>(`SELECT o.id, o.updated_at, o.created_at, o.side, o.status, o.source, o.is_paper, o.quantity, o.filled_quantity, o.avg_fill_price, o.notional_usd, o.status_reason, o.realized_pnl, a.symbol, b.name AS bot_name
              FROM orders o JOIN assets a ON a.id=o.asset_id LEFT JOIN trading_bots b ON b.id = o.bot_id
             WHERE o.user_id=$1 AND o.updated_at > now() - interval '7 days' ORDER BY o.updated_at DESC LIMIT 60`, [userId])
      .catch(() => q<any>(`SELECT o.id, o.updated_at, o.created_at, o.side, o.status, o.source, o.is_paper, o.quantity, o.filled_quantity, o.avg_fill_price, o.notional_usd, o.status_reason, o.realized_pnl, a.symbol, NULL AS bot_name
              FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 AND o.updated_at > now() - interval '7 days' ORDER BY o.updated_at DESC LIMIT 60`, [userId])),
    one<any>(`SELECT COALESCE(SUM(realized_pnl) FILTER (WHERE updated_at >= date_trunc('day', now())),0) AS today,
                     COALESCE(SUM(realized_pnl) FILTER (WHERE updated_at >= now() - interval '7 days'),0) AS week,
                     COUNT(*) FILTER (WHERE side='sell' AND realized_pnl > 0 AND updated_at >= now() - interval '7 days')::int AS wins,
                     COUNT(*) FILTER (WHERE side='sell' AND realized_pnl < 0 AND updated_at >= now() - interval '7 days')::int AS losses
                FROM orders WHERE user_id=$1 AND status IN ('filled','partially_filled')`, [userId]),
    q<any>(`SELECT g.id, g.name, g.role, g.status, g.stop_reason, g.autonomy_level, g.capital_usd, g.realized_pnl_usd, g.last_tick_at, f.name AS fleet,
                   (SELECT json_agg(e ORDER BY e.id DESC) FROM (SELECT id, kind, title, created_at FROM agent_events WHERE agent_id=g.id ORDER BY id DESC LIMIT 2) e) AS events
              FROM agents g LEFT JOIN agent_fleets f ON f.id=g.fleet_id WHERE g.user_id=$1 AND g.status <> 'archived' ORDER BY (g.status='running') DESC, g.updated_at DESC LIMIT 40`, [userId]).catch(() => [] as any[]),
    q<any>("SELECT name, status, stop_reason FROM agent_fleets WHERE user_id=$1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT 20", [userId]).catch(() => [] as any[]),
    one<any>(`SELECT s.enabled, s.modo_autopilot, s.force_trading, s.risk_mode,
                     (SELECT COUNT(*)::int FROM auto_trades t WHERE t.user_id=s.user_id AND t.status='open') AS open,
                     (SELECT COUNT(*)::int FROM auto_trades t WHERE t.user_id=s.user_id AND t.closed_at > now() - interval '7 days') AS closed_week,
                     (SELECT COALESCE(AVG(return_pct),0) FROM auto_trades t WHERE t.user_id=s.user_id AND t.closed_at > now() - interval '7 days') AS avg_ret
                FROM auto_trading s WHERE s.user_id=$1`, [userId]).catch(() => null),
    q<any>("SELECT label, kind, status, last_error FROM copy_follows WHERE follower_id=$1 ORDER BY created_at DESC LIMIT 50", [userId]).catch(() => [] as any[]),
    q<any>(`SELECT e.created_at, e.side, e.symbol, e.status, e.reason, f.label FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id
             WHERE f.follower_id=$1 ORDER BY e.id DESC LIMIT 10`, [userId]).catch(() => [] as any[]),
    one<any>("SELECT COALESCE(SUM(cash_balance) FILTER (WHERE kind='paper'),0) AS paper, COALESCE(SUM(cash_balance) FILTER (WHERE kind<>'paper'),0) AS live FROM trading_accounts WHERE user_id=$1", [userId]),
    one<any>("SELECT COUNT(*)::int AS n FROM orders WHERE user_id=$1 AND status='pending_approval'", [userId]),
  ]);

  // Coins the bots trade, and each bot's latest notes.
  const ids = [...new Set(bots.flatMap((b) => (b.asset_ids ?? []) as string[]))];
  const coins = new Map<string, Coin>();
  if (ids.length) for (const a of await q<any>("SELECT id, symbol, last_price, change_24h FROM assets WHERE id = ANY($1::uuid[])", [ids]))
    coins.set(a.id, { symbol: a.symbol, price: Number(a.last_price), change24h: a.change_24h != null ? Number(a.change_24h) : null });
  const logs = bots.length ? await q<any>(
    `SELECT x.bot_id, x.level, x.message, x.created_at FROM trading_bots b CROSS JOIN LATERAL
       (SELECT bot_id, level, message, created_at FROM bot_activity_logs l WHERE l.bot_id=b.id AND l.level IN ('trigger','order','result','warning','error','control') ORDER BY l.id DESC LIMIT 3) x
      WHERE b.id = ANY($1::uuid[])`, [bots.map((b) => b.id)]) : [];

  const botRows = bots.map((b) => {
    const multi = (b.asset_ids?.length ?? 0) > 1 || (b.state && Object.keys(b.state).some((k) => /^[0-9a-f-]{36}$/.test(k)));
    const tp = Number(b.params?.take_profit_pct ?? 0), sl = Number(b.params?.stop_loss_pct ?? 0);
    const perCoin = ((b.asset_ids ?? []) as string[]).map((id) => {
      const c = coins.get(id); if (!c) return null;
      const st = (multi ? b.state?.[id] : b.state) ?? {};
      const entry = st.entry ? Number(st.entry) : null;
      const move = entry && c.price ? ((c.price - entry) / entry) * 100 : null;
      return { symbol: c.symbol, phase: PHASE[st.phase] ?? (st.phase || "watching"), price: c.price, entry, move,
        target: entry && tp ? entry * (1 + tp / 100) : null, stop: entry && sl ? entry * (1 - sl / 100) : null, cycles: st.cycles ?? 0, note: st.waitNote ?? null, change24h: c.change24h };
    }).filter(Boolean) as any[];
    return { id: b.id, name: b.name, status: b.status, strategy: b.strategy_id, paper: b.is_paper, pnl: Number(b.pnl_usd ?? 0), tradesToday: b.trades_today, spentToday: Number(b.spent_today_usd ?? 0),
      approval: b.approval_required, allowRisky: b.allow_risky, tp, sl, amount: b.params?.amount_usd ?? null, coins: perCoin,
      recent: logs.filter((l) => l.bot_id === b.id).map((l) => ({ at: l.created_at, level: l.level, text: String(l.message).slice(0, 220) })) };
  });
  const posRows = positions.map((p) => {
    const qty = Number(p.quantity), cost = Number(p.avg_cost), px = Number(p.last_price ?? 0);
    return { symbol: p.symbol, paper: p.paper, qty, cost, price: px, value: qty * px, upnl: qty * (px - cost), move: cost ? ((px - cost) / cost) * 100 : null, change24h: p.change_24h != null ? Number(p.change_24h) : null };
  });
  const orderRows = orders.map((o) => ({ at: o.updated_at, side: o.side, symbol: o.symbol, status: o.status, source: o.source, bot: o.bot_name, paper: o.is_paper,
    qty: Number(o.filled_quantity) || Number(o.quantity) || null, price: o.avg_fill_price ? Number(o.avg_fill_price) : null, usd: o.notional_usd ? Number(o.notional_usd) : null,
    reason: o.status_reason, pnl: o.side === "sell" && Number(o.realized_pnl) ? Number(o.realized_pnl) : null }));
  return {
    bots: botRows, positions: posRows, orders: orderRows, agents, fleets, auto, follows, copies, pendingApprovals: pending?.n ?? 0,
    pnl: { today: Number(pnl?.today ?? 0), week: Number(pnl?.week ?? 0), wins: pnl?.wins ?? 0, losses: pnl?.losses ?? 0 },
    cash: { paper: Number(cash?.paper ?? 0), live: Number(cash?.live ?? 0) },
  };
}
export type StatusSnapshot = Awaited<ReturnType<typeof statusSnapshot>>;

/** The snapshot as a compact, labelled data packet for the AI. */
export function statusPacket(s: StatusSnapshot) {
  const L: string[] = [`now_utc=${new Date().toISOString()}`];
  L.push(`cash: paper ${money(s.cash.paper)}, real ${money(s.cash.live)} · realized P&L today ${signed(s.pnl.today)}, last 7 days ${signed(s.pnl.week)} (${s.pnl.wins} winning / ${s.pnl.losses} losing sells) · orders waiting for approval: ${s.pendingApprovals}`);
  L.push(`\n## bots (${s.bots.length})`);
  for (const b of s.bots) {
    L.push(`- "${b.name}" [${b.status}${b.paper ? ", paper" : ", REAL MONEY"}] strategy=${b.strategy}${b.amount ? ` $${b.amount}/buy` : ""}${b.tp ? ` take-profit +${b.tp}%` : ""}${b.sl ? ` stop-loss −${b.sl}%` : " no stop-loss"} · bot P&L ${signed(b.pnl)} · trades today ${b.tradesToday} · spent today ${money(b.spentToday)}${b.approval ? " · asks approval before each trade" : ""}`);
    for (const c of b.coins.slice(0, 40))
      L.push(`    ${c.symbol}: ${c.phase}${c.entry ? `, bought at ${usdPx(c.entry)}, now ${usdPx(c.price)} (${moveTxt(c.move ?? 0)}), sells at ${c.target ? usdPx(c.target) : "?"}${c.stop ? ` or stop ${usdPx(c.stop)}` : ""}` : `, price ${usdPx(c.price)}${c.change24h != null ? ` (24h ${c.change24h >= 0 ? "+" : ""}${c.change24h.toFixed(2)}%)` : ""}`}${c.cycles ? `, ${c.cycles} cycles done` : ""}${c.note ? ` — ${c.note}` : ""}`);
    if (b.coins.length > 40) L.push(`    …and ${b.coins.length - 40} more coins`);
    for (const r of b.recent) L.push(`    log ${ago(r.at)} [${r.level}] ${r.text}`);
  }
  L.push(`\n## open positions (${s.positions.length})`);
  for (const p of s.positions.slice(0, 60)) L.push(`- ${p.symbol}${p.paper ? " (paper)" : " (real)"}: ${+p.qty.toPrecision(6)} @ cost ${usdPx(p.cost)}, now ${usdPx(p.price)} (${moveTxt(p.move ?? 0)}), value ${money(p.value)}, unrealized ${signed(p.upnl)}`);
  L.push(`\n## orders, last 7 days (${s.orders.length}, newest first)`);
  for (const o of s.orders.slice(0, 50)) L.push(`- ${ago(o.at)}: ${o.side} ${o.symbol} ${o.status}${o.qty ? ` qty ${+Number(o.qty).toPrecision(6)}` : ""}${o.price ? ` @ ${usdPx(o.price)}` : ""}${o.usd ? ` ($${o.usd})` : ""} via ${o.bot ? `bot "${o.bot}"` : o.source}${o.paper ? " (paper)" : " (real)"}${o.pnl != null ? ` realized ${signed(o.pnl)}` : ""}${o.reason ? ` — reason: ${String(o.reason).slice(0, 200)}` : ""}`);
  L.push(`\n## agents (${s.agents.length})${s.fleets.length ? ` · fleets: ${s.fleets.map((f: any) => `${f.name} [${f.status}${f.stop_reason ? `: ${f.stop_reason}` : ""}]`).join("; ")}` : ""}`);
  for (const a of s.agents) L.push(`- "${a.name}" (${a.role}${a.fleet ? `, fleet ${a.fleet}` : ""}) [${a.status}${a.stop_reason ? `: ${a.stop_reason}` : ""}] autonomy ${a.autonomy_level} · capital ${money(Number(a.capital_usd ?? 0))} · realized ${signed(Number(a.realized_pnl_usd ?? 0))}${a.last_tick_at ? ` · last ran ${ago(a.last_tick_at)}` : ""}${(a.events ?? []).map((e: any) => ` · ${ago(e.created_at)} ${e.kind}: ${String(e.title).slice(0, 140)}`).join("")}`);
  if (s.auto) L.push(`\n## auto trading: ${s.auto.enabled ? "ON" : "off"} · Modo autopilot: ${s.auto.modo_autopilot ? "ON" : "off"}${s.auto.force_trading ? " · force trading on" : ""} · open auto trades ${s.auto.open} · closed last 7 days ${s.auto.closed_week} (avg ${Number(s.auto.avg_ret).toFixed(2)}%)`);
  if (s.follows.length || s.copies.length) {
    L.push(`\n## mimic: ${s.follows.filter((f: any) => f.status === "active").length} active of ${s.follows.length}${s.follows.filter((f: any) => f.last_error).slice(0, 3).map((f: any) => ` · ${f.label}: ${f.last_error}`).join("")}`);
    for (const c of s.copies.slice(0, 8)) L.push(`- ${ago(c.created_at)} ${c.label} ${c.side} ${c.symbol ?? "?"} → ${c.status}${c.reason ? ` (${String(c.reason).slice(0, 120)})` : ""}`);
  }
  return L.join("\n");
}

/** A direct answer without an AI: picks the part of the snapshot the question is about. */
export function statusAnswer(question: string, s: StatusSnapshot) {
  const t = question.toLowerCase();
  const out: string[] = [];
  const named = s.bots.filter((b) => b.name.length > 2 && t.includes(b.name.toLowerCase().slice(0, Math.min(18, b.name.length))));
  const syms = new Set([...s.positions.map((p) => p.symbol), ...s.bots.flatMap((b) => b.coins.map((c: any) => c.symbol)), ...s.orders.map((o) => o.symbol)]);
  const coin = [...syms].find((x) => x && x.length >= 2 && new RegExp(`(^|[^a-z0-9])${x.toLowerCase().replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`).test(t));

  if (coin) {
    out.push(`**${coin}**`);
    const p = s.positions.find((x) => x.symbol === coin);
    out.push(p ? `You hold ${+p.qty.toPrecision(6)} ${coin}: bought at ${usdPx(p.cost)}, now ${usdPx(p.price)} (${moveTxt(p.move ?? 0)}), worth ${money(p.value)}, unrealized ${signed(p.upnl)}.` : `You don't hold any ${coin} right now.`);
    for (const b of s.bots) for (const c of b.coins.filter((c: any) => c.symbol === coin))
      out.push(`Bot "${b.name}" (${b.status}): ${c.phase}${c.entry ? `. Bought at ${usdPx(c.entry)}, now ${usdPx(c.price)} (${moveTxt(c.move ?? 0)}). Sells at ${c.target ? usdPx(c.target) : "its target"}${c.stop ? ` or stop-loss ${usdPx(c.stop)}` : b.sl ? "" : "; no stop-loss, so it waits for the target"}` : ""}.${c.note ? ` ${c.note}` : ""}`);
    const os = s.orders.filter((o) => o.symbol === coin).slice(0, 5);
    if (os.length) out.push(`Recent orders:\n${os.map(orderLine).join("\n")}`);
    return out.join("\n");
  }
  if (named.length) {
    for (const b of named.slice(0, 3)) out.push(botBlock(b));
    return out.join("\n\n");
  }
  const want = (re: RegExp) => re.test(t);
  const any = !want(/\b(bots?|agents?|fleets?|orders?|trades?|bought|sold|positions?|holdings?|p&l|pnl|profits?|loss|mimic|copy|auto|modo|cash|balance)\b/);
  if (any || want(/\b(p&l|pnl|profits?|loss(es)?|gains?|how am i doing|performance)\b/))
    out.push(`Realized P&L: today ${signed(s.pnl.today)}, last 7 days ${signed(s.pnl.week)} (${s.pnl.wins} winning, ${s.pnl.losses} losing sells). Unrealized on open positions: ${signed(s.positions.reduce((a, p) => a + p.upnl, 0))}. Paper cash ${money(s.cash.paper)}.`);
  if (any || want(/\bbots?\b/)) {
    const run = s.bots.filter((b) => b.status === "running");
    out.push(`Bots: ${run.length} running of ${s.bots.length}.`);
    for (const b of (run.length ? run : s.bots).slice(0, 6)) out.push(botBlock(b, 6));
  }
  if (any || want(/\b(positions?|holdings?|holding|cash|balance)\b/)) {
    out.push(s.positions.length ? `Open positions (${s.positions.length}):\n${s.positions.slice(0, 12).map((p) => `• ${p.symbol}: ${moveTxt(p.move ?? 0)} from ${usdPx(p.cost)} (now ${usdPx(p.price)}), ${signed(p.upnl)}`).join("\n")}` : "No open positions.");
  }
  if (any || want(/\b(orders?|trades?|bought|sold|buys|sells|fills?|filled|cancel+ed|rejected|pending|history|activity)\b/)) {
    const os = want(/cancel/) ? s.orders.filter((o) => ["cancelled", "expired"].includes(o.status)) : want(/reject|fail/) ? s.orders.filter((o) => ["rejected", "failed"].includes(o.status))
      : want(/pending|waiting/) ? s.orders.filter((o) => ["pending_approval", "pending", "submitted", "accepted", "open"].includes(o.status))
      : want(/\bsold|sells?\b/) ? s.orders.filter((o) => o.side === "sell") : want(/\bbought|buys?\b/) ? s.orders.filter((o) => o.side === "buy") : s.orders;
    out.push(os.length ? `Orders, last 7 days (${os.length}):\n${os.slice(0, 10).map(orderLine).join("\n")}` : "No matching orders in the last 7 days.");
  }
  if (any || want(/\b(agents?|fleets?)\b/)) {
    out.push(s.agents.length ? `Agents (${s.agents.filter((a: any) => a.status === "running").length} running of ${s.agents.length}):\n${s.agents.slice(0, 8).map((a: any) => `• ${a.name} (${a.role}) ${a.status}${a.stop_reason ? `: ${a.stop_reason}` : ""}, realized ${signed(Number(a.realized_pnl_usd ?? 0))}${a.events?.[0] ? `. Latest: ${String(a.events[0].title).slice(0, 120)}` : ""}`).join("\n")}` : "No agents yet.");
  }
  if ((any || want(/\b(auto|modo|autopilot)\b/)) && s.auto) out.push(`Auto trading is ${s.auto.enabled ? "on" : "off"}, Modo autopilot ${s.auto.modo_autopilot ? "on" : "off"}: ${s.auto.open} open, ${s.auto.closed_week} closed this week (avg ${Number(s.auto.avg_ret).toFixed(2)}%).`);
  if ((any || want(/\b(mimic|copy|copying)\b/)) && s.follows.length) out.push(`Mimic: ${s.follows.filter((f: any) => f.status === "active").length} active of ${s.follows.length}.${s.copies[0] ? ` Latest: ${s.copies[0].label} ${s.copies[0].side} ${s.copies[0].symbol ?? ""} → ${s.copies[0].status}.` : ""}`);
  if (s.pendingApprovals) out.push(`${s.pendingApprovals} order${s.pendingApprovals > 1 ? "s are" : " is"} waiting for your approval (Portfolio → Orders).`);
  return out.join("\n\n") || "Nothing to report yet: no bots, agents, positions or orders.";
}

function orderLine(o: StatusSnapshot["orders"][number]) {
  return `• ${ago(o.at)}: ${o.side === "buy" ? "Buy" : "Sell"} ${o.symbol} ${o.status.replace("_", " ")}${o.price ? ` @ ${usdPx(o.price)}` : ""}${o.usd ? ` ($${o.usd})` : ""}${o.bot ? ` · bot "${o.bot}"` : ` · ${o.source}`}${o.pnl != null ? ` · P&L ${signed(o.pnl)}` : ""}${o.reason && o.status !== "filled" ? ` · ${String(o.reason).slice(0, 140)}` : ""}`;
}
function botBlock(b: StatusSnapshot["bots"][number], maxCoins = 15) {
  const held = b.coins.filter((c: any) => c.entry);
  const lines = [`"${b.name}" is ${b.status}${b.paper ? " (paper)" : " (real money)"}: P&L ${signed(b.pnl)}, ${b.tradesToday} trades today, holding ${held.length} of ${b.coins.length} coin${b.coins.length === 1 ? "" : "s"}.`];
  for (const c of (held.length ? held : b.coins).slice(0, maxCoins))
    lines.push(`• ${c.symbol}: ${c.phase}${c.entry ? `, bought ${usdPx(c.entry)}, now ${usdPx(c.price)} (${moveTxt(c.move ?? 0)}), sells at ${c.target ? usdPx(c.target) : "?"}` : ""}`);
  if ((held.length ? held : b.coins).length > maxCoins) lines.push(`• …and ${(held.length ? held : b.coins).length - maxCoins} more`);
  const issue = b.recent.find((r: any) => ["warning", "error"].includes(r.level));
  if (issue) lines.push(`Latest issue (${ago(issue.at)}): ${issue.text}`);
  return lines.join("\n");
}
