import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { getStrategy } from "@/server/bots/strategies";

type Ctx = { params: Promise<{ id: string }> };
const TF = new Set(["1m", "5m", "1h", "1d"]);

/**
 * Trade markers for the chart:
 *  mine   — your real (paper or live) fills on this asset
 *  bots   — fills made by your bots
 *  others — anonymized fills by other Merod users
 *  ghost  — HYPOTHETICAL trades a strategy would have made on this chart's history (never real orders)
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const tf = TF.has(sp.get("tf") ?? "") ? sp.get("tf")! : "1h";
  const strategy = sp.get("strategy") === "technical_indicator" ? "technical_indicator" : "dip_rebound_loop";

  const bars = (await q<any>(`SELECT extract(epoch from ts)::bigint AS t, close FROM price_bars WHERE asset_id=$1 AND timeframe=$2 ORDER BY ts DESC LIMIT 500`, [id, tf]))
    .reverse().map((b) => ({ t: Number(b.t), c: Number(b.close) }));
  const since = bars.length ? new Date(bars[0].t * 1000) : new Date(Date.now() - 86400e3);

  const AUTO = new Set(["bot", "auto", "copy", "agent"]);
  const fills = await q<any>(
    `SELECT extract(epoch from e.executed_at)::bigint AS t, o.side, e.price, e.quantity, e.fee_usd, o.source, o.source_ref, o.user_id = $2 AS mine, o.is_paper,
            o.realized_pnl, o.filled_quantity, o.status_reason,
            (SELECT name FROM trading_bots b WHERE o.source='bot' AND b.id::text=o.source_ref) AS bot_name,
            (SELECT name FROM agents g WHERE o.source='agent' AND g.id::text=o.source_ref) AS agent_name
       FROM executions e JOIN orders o ON o.id=e.order_id WHERE o.asset_id=$1 AND e.executed_at >= $3 ORDER BY e.executed_at DESC LIMIT 400`, [id, u.id, since]);
  // A summary for every trade marker (shown when you hover its candle). Other users stay anonymous.
  const SRC: Record<string, string> = { manual: "You (manual)", prompt: "You (prompt)", shortcut: "You (shortcut)", conditional: "Your conditional order", system: "Merod", auto: "Auto trading", copy: "Mimic" };
  const info = (f: any) => {
    const qty = Number(f.quantity), price = Number(f.price), share = Number(f.filled_quantity) > 0 ? qty / Number(f.filled_quantity) : 1;
    const pnl = f.mine && f.side === "sell" && Number(f.realized_pnl) ? Number(f.realized_pnl) * share : null;
    const who = !f.mine ? (AUTO.has(f.source) ? "Another user's bot" : "Another user")
      : f.source === "bot" ? `Bot · ${f.bot_name ?? "bot"}` : f.source === "agent" ? `Agent · ${f.agent_name ?? "agent"}` : SRC[f.source] ?? f.source;
    return { who, side: f.side, qty, price, usd: qty * price, fee: f.mine ? Number(f.fee_usd ?? 0) : null, paper: f.is_paper, pnl,
      pnlPct: pnl != null && qty * price - pnl > 0 ? (pnl / (qty * price - pnl)) * 100 : null, note: f.mine && f.status_reason ? String(f.status_reason).slice(0, 160) : null };
  };
  // Your manual/prompt/shortcut trades; your automated trades (bots, auto trading, Modo, copy/mimic); other users (anonymous).
  // Short labels so markers don't cover the candles: B/S plus who (full details are in the hover summary).
  const short = (s: string) => (s.length > 9 ? `${s.slice(0, 8)}…` : s);
  const autoLabel = (f: any) => `${f.side === "buy" ? "B" : "S"} ${f.source === "bot" ? short(f.bot_name ?? "Bot") : f.source === "agent" ? short(f.agent_name ?? "Agent") : f.source === "copy" ? "Mimic" : "Auto"}`;
  const mine = fills.filter((f) => f.mine && !AUTO.has(f.source)).map((f) => ({ time: Number(f.t), side: f.side, kind: "mine", label: `You ${f.side === "buy" ? "B" : "S"}`, info: info(f) }));
  const bots = fills.filter((f) => f.mine && AUTO.has(f.source)).map((f) => ({ time: Number(f.t), side: f.side, kind: "bot", label: autoLabel(f), info: info(f) }));
  const others = fills.filter((f) => !f.mine).slice(0, 150).map((f) => ({ time: Number(f.t), side: f.side, kind: "others", label: undefined, info: info(f) }));

  // Ghost replay. Defaults are tuned to this asset's own volatility; callers can override.
  const rets = bars.slice(1).map((b, i) => Math.abs((b.c - bars[i].c) / bars[i].c) * 100);
  const vol = rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : 1;
  const dip = Number(sp.get("dip")) > 0 ? Number(sp.get("dip")) : Math.round(Math.min(Math.max(vol * 3, 1), 12) * 10) / 10;
  const tp = Number(sp.get("tp")) > 0 ? Number(sp.get("tp")) : Math.round(Math.min(Math.max(dip * 1.6, 1.5), 20) * 10) / 10;
  const strat = getStrategy(strategy)!;
  const p = strategy === "dip_rebound_loop" ? { amount_usd: 1000, dip_pct: dip, take_profit_pct: tp, stop_loss_pct: null, repeat: true } : { fast: 9, slow: 21, amount_usd: 1000 };
  const ghost: any[] = [];
  let st: any = {}, qty = 0, entry = 0, cash = 1000, wins = 0, losses = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const { decision, state } = strat.decide({ price: b.c, ts: b.t * 1000, positionQty: qty, avgCost: qty ? entry : undefined, source: "ghost",
      bars: strategy === "technical_indicator" ? bars.slice(Math.max(0, i - 60), i + 1).map((x) => ({ close: x.c, ts: x.t * 1000 })) : undefined }, st, p);
    st = state;
    if (decision.action === "buy" && !qty) {
      qty = cash / b.c; entry = b.c; cash = 0;
      ghost.push({ time: b.t, side: "buy", kind: "ghost", label: "Ghost buy", info: { who: "Ghost strategy (hypothetical)", side: "buy", qty, price: b.c, usd: qty * b.c, paper: true, pnl: null, pnlPct: null, note: "Not a real order: what the strategy would have done on this candle." } });
      if (strategy === "dip_rebound_loop") st = { ...st, phase: "holding", entry: b.c, qty };
    } else if (decision.action === "sell" && qty) {
      const pnl = (b.c - entry) / entry * 100;
      pnl >= 0 ? wins++ : losses++;
      cash = qty * b.c; qty = 0;
      ghost.push({ time: b.t, side: "sell", kind: "ghost", label: `Ghost ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`, info: { who: "Ghost strategy (hypothetical)", side: "sell", qty: cash / b.c, price: b.c, usd: cash, paper: true, pnl: cash - (cash / b.c) * entry, pnlPct: pnl, note: "Not a real order: no fees or slippage." } });
      if (strategy === "dip_rebound_loop") st = { phase: "waiting_dip", ref: b.c, cycles: (st.cycles ?? 0) + 1 };
    }
  }
  const endValue = cash + qty * (bars.at(-1)?.c ?? 0);
  return ok({
    mine, bots, others, ghost,
    ghostParams: { strategy, ...(strategy === "dip_rebound_loop" ? { dip, tp } : { fast: 9, slow: 21 }) },
    ghostStats: { trades: ghost.length, wins, losses, returnPct: bars.length ? (endValue / 1000 - 1) * 100 : 0, openPosition: qty > 0 },
    note: "Ghost trades are hypothetical replays on historical bars (no fees, no slippage). They are not real orders and don't predict future results.",
  });
});
