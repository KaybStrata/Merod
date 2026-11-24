import type { Instruction, TradeLeg } from "./schema";

/**
 * Deterministic natural-language parser. Used when no AI provider is connected, when the
 * provider fails, and as a cross-check. It recognises the core Merod command grammar.
 * Anything it cannot parse confidently becomes a clarification — it never guesses.
 */

const NAME_ALIASES: Record<string, string> = {
  bitcoin: "BTC", btc: "BTC", ethereum: "ETH", ether: "ETH", eth: "ETH", solana: "SOL", sol: "SOL", dogecoin: "DOGE", doge: "DOGE",
  nvidia: "NVDA", tesla: "TSLA", apple: "AAPL", microsoft: "MSFT", amazon: "AMZN", meta: "META", facebook: "META", google: "GOOGL",
  alphabet: "GOOGL", netflix: "NFLX", palantir: "PLTR", amd: "AMD", coinbase: "COIN", ripple: "XRP", xrp: "XRP", cardano: "ADA",
  avalanche: "AVAX", chainlink: "LINK", pepe: "PEPE", bonk: "BONK", dogwifhat: "WIF", wif: "WIF", jupiter: "JUP", sui: "SUI",
  aptos: "APT", litecoin: "LTC", bnb: "BNB", broadcom: "AVGO", "s&p": "SPY", spy: "SPY", qqq: "QQQ", nasdaq: "QQQ", shopify: "SHOP",
};
const STOP_WORDS = new Set(["my", "the", "a", "an", "of", "worth", "position", "shares", "share", "all", "it", "this", "that", "at", "and", "then", "when", "if", "every", "dip", "increase", "gain", "drop", "rinse", "repeat", "sell", "buy", "half", "price", "target", "usd", "dollars", "coins", "coin", "tokens"]);

const num = (s: string) => Number(s.replace(/[,$]/g, ""));
const leg = (p: Partial<TradeLeg> & Pick<TradeLeg, "side">): TradeLeg => ({
  symbol: null, network: null, contract_address: null, amount_type: null, amount: null, order_type: "market",
  limit_price: null, stop_price: null, take_profit_pct: null, stop_loss_pct: null, ...p,
});
const base = (kind: Instruction["kind"], summary: string, extra: Partial<Instruction> = {}): Instruction => ({
  kind, summary, clarification_question: null, trades: [], condition: null, schedule: null, swing: null, bot: null, research_query: null, ...extra,
});

export function extractAsset(text: string): { symbol: string | null; contract: string | null; network: string | null } {
  const t = text.toLowerCase();
  const sol = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  const evm = text.match(/\b0x[a-fA-F0-9]{40}\b/);
  const network = /\bon (solana|ethereum|base|bsc|bnb chain|polygon|arbitrum|avalanche|sui|aptos)\b/.exec(t)?.[1]?.replace("bnb chain", "bsc") ?? null;
  if (evm) return { symbol: null, contract: evm[0], network };
  if (sol && !/^[A-Z]{2,6}$/.test(sol[0])) return { symbol: null, contract: sol[0], network: network ?? "solana" };
  const cashtag = text.match(/\$([A-Za-z]{2,10})\b/);
  if (cashtag) return { symbol: cashtag[1].toUpperCase(), contract: null, network };
  for (const [name, sym] of Object.entries(NAME_ALIASES)) if (new RegExp(`\\b${name.replace("&", "\\&")}\\b`).test(t)) return { symbol: sym, contract: null, network };
  const upper = text.match(/\b[A-Z]{2,6}\b/g)?.filter((w) => !["USD", "AND", "THE", "ETF", "TP", "SL"].includes(w));
  if (upper?.length) return { symbol: upper[0], contract: null, network };
  return { symbol: null, contract: null, network };
}

function amount(text: string): { type: TradeLeg["amount_type"]; value: number | null } {
  const t = text.toLowerCase();
  if (/\bhalf\b/.test(t)) return { type: "percent_position", value: 50 };
  if (/\b(everything|all of|entire|whole) (my )?(position|holding|it)\b|\bclose (my )?position\b|\bsell all\b/.test(t)) return { type: "percent_position", value: 100 };
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%\s*(of\s+)?(my\s+)?([a-z$]+\s+)?(position|holding|stake|bag)?/);
  const usd = t.match(/\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(usd|dollars|bucks)\b/);
  const qty = t.match(/\b(\d+(?:\.\d+)?)\s+(shares?|coins?|tokens?|units?|[a-z]{2,6})\b(?! ?%)/);
  if (usd) return { type: "usd", value: num(usd[1] ?? usd[2]) };
  if (pct && (pct[5] || /\bsell\b/.test(t)) && !/\b(dip|drop|gain|increase|reach|rise|up|down)\b/.test(t.slice(pct.index ?? 0, (pct.index ?? 0) + 30))) return { type: "percent_position", value: num(pct[1]) };
  if (qty && !/%/.test(qty[0])) return { type: "quantity", value: num(qty[1]) };
  return { type: null, value: null };
}

export function parsePrompt(raw: string): Instruction {
  const text = raw.trim();
  const t = text.toLowerCase();
  const asset = extractAsset(text);
  const amt = amount(text);

  // Control commands
  if (/\bcancel\b.*\b(all|every)\b.*\border/.test(t) || /\bcancel (my )?open orders\b/.test(t)) return base("cancel_all_orders", "Cancel all open orders");
  if (/\b(pause|stop|halt)\b.*\b(all|every)?\b.*\bbots?\b/.test(t)) return base("pause_all_bots", "Pause all active bots");
  if (/\b(resume|restart|unpause)\b.*\bbots?\b/.test(t)) return base("resume_all_bots", "Resume paused bots");

  // Swing loop: "buy at 3% dip and sell at 5% increase, rinse and repeat"
  const dip = t.match(/(\d+(?:\.\d+)?)\s*%\s*(dip|drop|decline|pullback|down)|(dip|drop|falls?|declines?|down)\s*(of|by)?\s*(\d+(?:\.\d+)?)\s*%/);
  const rise = t.match(/(\d+(?:\.\d+)?)\s*%\s*(increase|gain|rise|up|profit|pump)|(increase|gain|rise|rises|up|profit)\s*(of|by)?\s*(\d+(?:\.\d+)?)\s*%/);
  if (dip && rise && /\bbuy\b/.test(t) && /\bsell\b/.test(t)) {
    const dipPct = num(dip[1] ?? dip[5]), tpPct = num(rise[1] ?? rise[5]);
    const repeat = /\b(rinse|repeat|loop|again|keep (doing|going)|continuous|forever|cycle)\b/.test(t);
    const sl = t.match(/stop[- ]?loss (of |at )?(\d+(?:\.\d+)?)\s*%/);
    const cycles = t.match(/(\d+)\s*(times|cycles)/);
    return base("swing_loop", `Buy ${asset.symbol ?? "this asset"} after a ${dipPct}% dip, sell at +${tpPct}%${repeat ? ", and repeat" : ""}`, {
      trades: [leg({ side: "buy", symbol: asset.symbol, network: asset.network, contract_address: asset.contract, amount_type: amt.type === "usd" || amt.type === "quantity" ? amt.type : null, amount: amt.type === "usd" || amt.type === "quantity" ? amt.value : null })],
      swing: { dip_pct: dipPct, take_profit_pct: tpPct, stop_loss_pct: sl ? num(sl[2]) : null, repeat, max_cycles: cycles ? num(cycles[1]) : null },
    });
  }

  // Alerts
  if (/\b(notify|alert|tell|ping|let me know)\b/.test(t)) {
    const above = /\b(above|over|rises? (above|to)|hits?|reaches?)\b/.test(t) && !/\b(below|under|drops?|falls?)\b/.test(t);
    const price = t.match(/\$\s?(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*(?:\.\d+)?)\b(?!\s*%)/);
    const target = /\btarget\b/.test(t) ? null : price ? num(price[1] ?? price[2]) : undefined;
    if (target === undefined) return base("clarify", "Price alert", { clarification_question: "At what price should I alert you?" });
    return base("price_alert", `Alert when ${asset.symbol ?? "this asset"} goes ${above ? "above" : "below"} ${target ?? "your target price"}`, {
      trades: [leg({ side: "buy", symbol: asset.symbol, network: asset.network, contract_address: asset.contract })],
      condition: { type: above ? "price_above" : "price_below", value: target },
    });
  }

  // Bots
  if (/\b(bot|agent|monitor|watch|scan)\b/.test(t) && !/\b(buy|sell)\b.*\$/.test(t)) {
    if (/\b(new(ly)?|launch|launched|fresh)\b.*\b(coins?|tokens?|memes?)\b/.test(t)) {
      const liq = t.match(/\$\s?(\d[\d,]*)\s*(k)?\s*(liquidity)?/);
      return base("create_bot", "Create a meme-coin discovery bot for new Solana launches", {
        bot: { strategy: "meme_discovery", name: "New launch scanner", min_liquidity_usd: liq ? num(liq[1]) * (liq[2] ? 1000 : 1) : null },
      });
    }
    if (/\bwatchlist\b/.test(t)) return base("create_bot", "Create a bot that monitors your watchlist", { bot: { strategy: "watchlist_monitor", name: "Watchlist monitor", min_liquidity_usd: null } });
    if (/\brebalanc/.test(t)) return base("create_bot", "Create a portfolio rebalancing bot", { bot: { strategy: "rebalance", name: "Rebalancer", min_liquidity_usd: null } });
  }

  // Recurring: "buy $50 of ETH every Monday"
  const every = t.match(/\bevery\s+(day|week|month|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(daily|weekly|monthly|hourly)\b/);
  if (every && /\bbuy\b/.test(t)) {
    const w = every[1] ?? every[2];
    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const frequency = weekdays.includes(w) || w === "week" || w === "weekly" ? "weekly" : w === "month" || w === "monthly" ? "monthly" : w === "hour" || w === "hourly" ? "hourly" : "daily";
    if (!amt.value || !asset.symbol && !asset.contract) return base("clarify", "Recurring buy", { clarification_question: !amt.value ? "How much should each recurring purchase be?" : "Which asset should I buy?" });
    return base("recurring_buy", `Buy $${amt.value} of ${asset.symbol} ${frequency}${weekdays.includes(w) ? ` on ${w}` : ""}`, {
      trades: [leg({ side: "buy", symbol: asset.symbol, network: asset.network, contract_address: asset.contract, amount_type: amt.type, amount: amt.value })],
      schedule: { frequency, weekday: weekdays.includes(w) ? (w as any) : frequency === "weekly" ? "monday" : null },
    });
  }

  // Conditional: "sell half of my position when it reaches a 20% gain"
  const gain = t.match(/(\d+(?:\.\d+)?)\s*%\s*(gain|profit|up|increase)/);
  const priceCond = t.match(/\b(when|if|once)\b.*\b(above|below|hits|reaches|drops? (below|to)|falls? (below|to)|rises? (above|to))\s*\$?\s?(\d[\d,]*(?:\.\d+)?)(?!\s*%)/);
  if (/\b(when|if|once)\b/.test(t) && (gain || priceCond) && /\b(buy|sell)\b/.test(t)) {
    const side = /\bsell\b/.test(t) ? "sell" : "buy";
    const cond: Instruction["condition"] = gain ? { type: "gain_pct_from_entry", value: num(gain[1]) }
      : { type: /below|drops?|falls?/.test(priceCond![2]) ? "price_below" : "price_above", value: num(priceCond![6]) };
    if (!amt.value) return base("clarify", "Conditional order", { clarification_question: `How much should I ${side}?` });
    return base("conditional_trade", `${side === "sell" ? "Sell" : "Buy"} ${amt.type === "percent_position" ? `${amt.value}% of` : amt.type === "usd" ? `$${amt.value} of` : amt.value} ${asset.symbol ?? "this position"} when ${cond.type.replace(/_/g, " ")} ${cond.value}`, {
      trades: [leg({ side, symbol: asset.symbol, network: asset.network, contract_address: asset.contract, amount_type: amt.type, amount: amt.value })],
      condition: cond,
    });
  }

  // Plain trades: "buy $100 worth of Solana", "sell 25% of my NVIDIA position"
  const sideMatch = t.match(/\b(buy|purchase|long|ape|sell|dump|exit|close|trim)\b/);
  if (sideMatch) {
    const side: "buy" | "sell" = ["buy", "purchase", "long", "ape"].includes(sideMatch[1]) ? "buy" : "sell";
    const lim = t.match(/\b(limit|at)\s*\$?\s?(\d[\d,]*(?:\.\d+)?)(?!\s*%)/);
    const tp = t.match(/take[- ]?profit (of |at )?(\d+(?:\.\d+)?)\s*%/), sl = t.match(/stop[- ]?loss (of |at )?(\d+(?:\.\d+)?)\s*%/);
    let a = amt;
    if (side === "sell" && /\bclose\b/.test(t)) a = { type: "percent_position", value: 100 };
    if (!a.value) return base("clarify", `${side} ${asset.symbol ?? ""}`.trim(), { clarification_question: side === "buy" ? `How much${asset.symbol ? ` ${asset.symbol}` : ""} should I buy? (e.g. $100 or 2 shares)` : "How much should I sell? (e.g. 25% or 10 shares)",
      trades: [leg({ side, symbol: asset.symbol, network: asset.network, contract_address: asset.contract })] });
    return base("trade", `${side === "buy" ? "Buy" : "Sell"} ${a.type === "usd" ? `$${a.value} of` : a.type === "percent_position" ? `${a.value}% of` : a.value} ${asset.symbol ?? asset.contract ?? "this asset"}`, {
      trades: [leg({ side, symbol: asset.symbol, network: asset.network, contract_address: asset.contract, amount_type: a.type, amount: a.value,
        order_type: lim && /limit/.test(lim[1]) ? "limit" : "market", limit_price: lim && /limit/.test(lim[1]) ? num(lim[2]) : null,
        take_profit_pct: tp ? num(tp[2]) : null, stop_loss_pct: sl ? num(sl[2]) : null })],
    });
  }

  if (/\b(portfolio|holdings|p&l|pnl|how am i doing|performance)\b/.test(t)) return base("portfolio_question", "Portfolio summary");
  if (/\?|\b(why|what|how|analy[sz]e|research|explain|outlook|news)\b/.test(t)) return base("research", "Market research", { research_query: text });
  return base("clarify", "Unclear request", { clarification_question: "I couldn't tell what you'd like to do. Try e.g. “Buy $100 of SOL”, “Sell 25% of NVDA”, or “Buy at a 3% dip and sell at +5%, repeat”." });
}

/** Merge a clarification answer (e.g. "$100" or "SOL") into the pending instruction. */
export function mergeClarification(pending: Instruction, answer: string): Instruction | null {
  const a = amount(answer.includes("$") || /\d/.test(answer) ? answer : "");
  const asset = extractAsset(answer);
  const next: Instruction = JSON.parse(JSON.stringify(pending));
  if (!next.trades.length) return null;
  const l = next.trades[0];
  let changed = false;
  if (!l.amount && a.value) {
    l.amount = a.value; changed = true;
    l.amount_type = a.type === "percent_position" && l.side === "buy" ? "usd" : (a.type ?? (/\$/.test(answer) ? "usd" : "quantity"));
  }
  if (!l.symbol && !l.contract_address && (asset.symbol || asset.contract) && !/^\$?\d/.test(answer.trim())) { l.symbol = asset.symbol; l.contract_address = asset.contract; l.network = asset.network; changed = true; }
  if (!changed) return null;
  if (next.kind === "clarify") next.kind = "trade";
  next.clarification_question = null;
  return next;
}

export const isAmbiguousStopWord = (w: string) => STOP_WORDS.has(w.toLowerCase());
