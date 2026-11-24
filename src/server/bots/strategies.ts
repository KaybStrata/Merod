/**
 * Bot strategies are pure decision functions: (observation, state, params) → decision.
 * They never touch the database or providers; the runner turns decisions into engine intents.
 * This makes them deterministic, backtestable and safe to restart.
 */
export interface Observation { price: number; ts: number; avgCost?: number; positionQty: number; bars?: { close: number; ts: number }[]; source: string }
export type Decision =
  | { action: "none"; note?: string }
  | { action: "buy"; notionalUsd?: number; quantity?: number; reason: string; tag: string }
  | { action: "sell"; quantity?: number; percent?: number; reason: string; tag: string }
  | { action: "alert"; message: string; tag: string }
  | { action: "complete"; reason: string };

export interface StrategyDef {
  id: string; name: string; category: string; description: string;
  params: { key: string; label: string; type: "number" | "text" | "select" | "boolean"; default?: unknown; options?: string[] }[];
  decide(o: Observation, state: any, p: any): { decision: Decision; state: any };
}

const pct = (a: number, b: number) => ((a - b) / b) * 100;

export const STRATEGIES: StrategyDef[] = [
  {
    id: "dip_rebound_loop", name: "Dip-buy / take-profit loop", category: "swing",
    description: "Buy after the price drops X% from its recent high, sell when it rises Y% above the entry, then repeat.",
    params: [
      { key: "amount_usd", label: "Amount per cycle (USD)", type: "number", default: 100 },
      { key: "dip_pct", label: "Buy on dip (%)", type: "number", default: 3 },
      { key: "take_profit_pct", label: "Sell at gain (%)", type: "number", default: 5 },
      { key: "stop_loss_pct", label: "Stop-loss (%) — optional", type: "number" },
      { key: "repeat", label: "Rinse and repeat", type: "boolean", default: true },
      { key: "max_cycles", label: "Max cycles (blank = unlimited)", type: "number" },
    ],
    decide(o, s, p) {
      const st = { phase: "waiting_dip", ref: o.price, cycles: 0, ...s };
      if (st.phase === "waiting_dip") {
        st.ref = Math.max(st.ref ?? o.price, o.price); // track the high since start / last exit
        const drop = -pct(o.price, st.ref);
        if (drop >= p.dip_pct) {
          return { decision: { action: "buy", notionalUsd: p.amount_usd, quantity: p.quantity, reason: `Price ${o.price.toPrecision(6)} is ${drop.toFixed(2)}% below recent high ${st.ref.toPrecision(6)} (≥ ${p.dip_pct}%)`, tag: `c${st.cycles}:buy` }, state: { ...st, phase: "buy_pending" } };
        }
        return { decision: { action: "none", note: `Waiting for ${p.dip_pct}% dip (now ${drop.toFixed(2)}% below high ${st.ref.toPrecision(6)})` }, state: st };
      }
      if (st.phase === "holding") {
        const entry = st.entry ?? o.avgCost ?? o.price;
        const g = pct(o.price, entry);
        if (g >= p.take_profit_pct) return { decision: { action: "sell", quantity: st.qty, reason: `+${g.toFixed(2)}% from entry ${entry.toPrecision(6)} (target ${p.take_profit_pct}%)`, tag: `c${st.cycles}:tp` }, state: { ...st, phase: "sell_pending" } };
        if (p.stop_loss_pct && g <= -p.stop_loss_pct) return { decision: { action: "sell", quantity: st.qty, reason: `Stop-loss: ${g.toFixed(2)}% from entry`, tag: `c${st.cycles}:sl` }, state: { ...st, phase: "sell_pending" } };
        return { decision: { action: "none", note: `Holding: ${g >= 0 ? "+" : ""}${g.toFixed(2)}% vs +${p.take_profit_pct}% target` }, state: st };
      }
      return { decision: { action: "none", note: `Waiting for order (${st.phase})` }, state: st };
    },
  },
  {
    id: "recurring_buy", name: "Recurring purchase (DCA)", category: "recurring",
    description: "Buy a fixed dollar amount on a schedule.",
    params: [
      { key: "amount_usd", label: "Amount (USD)", type: "number", default: 50 },
      { key: "frequency", label: "Frequency", type: "select", options: ["hourly", "daily", "weekly", "monthly"], default: "weekly" },
      { key: "weekday", label: "Weekday (weekly)", type: "select", options: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"], default: "monday" },
    ],
    decide(o, s, p) {
      const last = s.lastBuyTs ?? 0;
      const d = new Date(o.ts);
      const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const gap = { hourly: 3600e3, daily: 86400e3 * 0.95, weekly: 86400e3 * 6.5, monthly: 86400e3 * 27 }[p.frequency as string] ?? 86400e3;
      const dayOk = p.frequency !== "weekly" || dayNames[d.getUTCDay()] === p.weekday;
      if (o.ts - last >= gap && dayOk) return { decision: { action: "buy", notionalUsd: p.amount_usd, reason: `Scheduled ${p.frequency} purchase`, tag: `dca:${d.toISOString().slice(0, p.frequency === "hourly" ? 13 : 10)}` }, state: { ...s, lastBuyTs: o.ts } };
      return { decision: { action: "none", note: `Next ${p.frequency} purchase pending` }, state: s };
    },
  },
  {
    id: "price_trigger", name: "Price-triggered order", category: "conditional",
    description: "Place an order once when a price or gain condition is met.",
    params: [
      { key: "condition", label: "Condition", type: "select", options: ["price_above", "price_below", "gain_pct_from_entry", "drop_pct_from_reference"], default: "price_below" },
      { key: "value", label: "Value", type: "number" },
      { key: "side", label: "Side", type: "select", options: ["buy", "sell"], default: "buy" },
      { key: "amount_usd", label: "Amount (USD, buys)", type: "number" },
      { key: "percent", label: "Percent of position (sells)", type: "number" },
    ],
    decide(o, s, p) {
      if (s.done) return { decision: { action: "complete", reason: "Condition already executed" }, state: s };
      const ref = s.ref ?? o.price;
      const hit = p.condition === "price_above" ? o.price >= p.value : p.condition === "price_below" ? o.price <= p.value
        : p.condition === "gain_pct_from_entry" ? !!o.avgCost && pct(o.price, o.avgCost) >= p.value : -pct(o.price, ref) >= p.value;
      if (!hit) return { decision: { action: "none", note: `Condition ${p.condition} ${p.value} not met (price ${o.price.toPrecision(6)})` }, state: { ...s, ref } };
      const d: Decision = p.side === "buy" ? { action: "buy", notionalUsd: p.amount_usd, reason: `Condition met: ${p.condition} ${p.value}`, tag: "trigger" }
        : { action: "sell", percent: p.percent ?? 100, reason: `Condition met: ${p.condition} ${p.value}`, tag: "trigger" };
      return { decision: d, state: { ...s, done: true } };
    },
  },
  {
    id: "stop_loss_take_profit", name: "Stop-loss / take-profit guard", category: "protection",
    description: "Protect an existing position: sell when it falls X% or rises Y% from average cost.",
    params: [{ key: "stop_loss_pct", label: "Stop-loss (%)", type: "number", default: 8 }, { key: "take_profit_pct", label: "Take-profit (%)", type: "number", default: 20 }, { key: "sell_percent", label: "Sell % of position", type: "number", default: 100 }],
    decide(o, s, p) {
      if (!o.positionQty || !o.avgCost) return { decision: { action: "none", note: "No position to protect" }, state: s };
      const g = pct(o.price, o.avgCost);
      if (g <= -p.stop_loss_pct) return { decision: { action: "sell", percent: p.sell_percent, reason: `Stop-loss hit (${g.toFixed(2)}%)`, tag: `sl:${Math.floor(o.ts / 864e5)}` }, state: s };
      if (p.take_profit_pct && g >= p.take_profit_pct) return { decision: { action: "sell", percent: p.sell_percent, reason: `Take-profit hit (+${g.toFixed(2)}%)`, tag: `tp:${Math.floor(o.ts / 864e5)}` }, state: s };
      return { decision: { action: "none", note: `P&L ${g.toFixed(2)}% within guard band` }, state: s };
    },
  },
  {
    id: "technical_indicator", name: "SMA crossover", category: "technical",
    description: "Buy when the fast moving average crosses above the slow one; sell on the reverse cross.",
    params: [{ key: "fast", label: "Fast SMA (bars)", type: "number", default: 9 }, { key: "slow", label: "Slow SMA (bars)", type: "number", default: 21 }, { key: "amount_usd", label: "Amount (USD)", type: "number", default: 100 }],
    decide(o, s, p) {
      const closes = (o.bars ?? []).map((b) => b.close);
      if (closes.length < p.slow + 1) return { decision: { action: "none", note: "Not enough history" }, state: s };
      const sma = (n: number, off = 0) => closes.slice(closes.length - n - off, closes.length - off).reduce((a, b) => a + b, 0) / n;
      const f0 = sma(p.fast), s0 = sma(p.slow), f1 = sma(p.fast, 1), s1 = sma(p.slow, 1);
      const barTag = String(o.bars!.at(-1)!.ts);
      if (f1 <= s1 && f0 > s0 && !o.positionQty) return { decision: { action: "buy", notionalUsd: p.amount_usd, reason: `Golden cross: SMA${p.fast} ${f0.toPrecision(6)} > SMA${p.slow} ${s0.toPrecision(6)}`, tag: `x:${barTag}` }, state: s };
      if (f1 >= s1 && f0 < s0 && o.positionQty) return { decision: { action: "sell", percent: 100, reason: `Death cross: SMA${p.fast} < SMA${p.slow}`, tag: `x:${barTag}` }, state: s };
      return { decision: { action: "none", note: `SMA${p.fast} ${f0.toPrecision(6)} / SMA${p.slow} ${s0.toPrecision(6)}` }, state: s };
    },
  },
  {
    id: "watchlist_monitor", name: "Watchlist monitor", category: "monitoring",
    description: "Alert on large moves and target-price crossings across your watchlist. Does not trade.",
    params: [{ key: "move_pct", label: "Alert on 24h move (%)", type: "number", default: 5 }],
    decide(o, s) { return { decision: { action: "none", note: `Observed ${o.price}` }, state: s }; },
  },
  {
    id: "meme_discovery", name: "Meme-coin discovery", category: "discovery",
    description: "Scan newly launched tokens that meet liquidity rules; log candidates and optionally buy small (approval recommended).",
    params: [{ key: "min_liquidity_usd", label: "Min liquidity (USD)", type: "number", default: 50000 }, { key: "max_age_minutes", label: "Max token age (min)", type: "number", default: 120 }, { key: "auto_buy_usd", label: "Auto-buy per token (USD, 0 = alert only)", type: "number", default: 0 }],
    decide(o, s) { return { decision: { action: "none", note: `Observed ${o.price}` }, state: s }; },
  },
  {
    id: "rebalance", name: "Portfolio rebalancer", category: "portfolio",
    description: "Keep selected assets at equal target weights; rebalance when drift exceeds a threshold.",
    params: [{ key: "drift_pct", label: "Rebalance when drift exceeds (%)", type: "number", default: 5 }],
    decide(o, s) { return { decision: { action: "none", note: `Observed ${o.price}` }, state: s }; },
  },
  {
    id: "volume_liquidity_monitor", name: "Volume & liquidity monitor", category: "monitoring",
    description: "Alert when 24h volume or liquidity changes sharply.",
    params: [{ key: "change_pct", label: "Alert on change (%)", type: "number", default: 50 }],
    decide(o, s) { return { decision: { action: "none", note: `Observed ${o.price}` }, state: s }; },
  },
  {
    id: "news_monitor", name: "News monitor", category: "monitoring",
    description: "Monitors news for selected assets. Requires a licensed news data provider (not yet connected).",
    params: [{ key: "keywords", label: "Keywords", type: "text" }],
    decide(_o, s) { return { decision: { action: "none", note: "News provider not connected — no data" }, state: s }; },
  },
];
export const getStrategy = (id: string) => STRATEGIES.find((s) => s.id === id);
