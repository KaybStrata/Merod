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

/* ───────────── Forgiving language layer: case-insensitive, typo-tolerant, synonym-aware ───────────── */

/** Command words the grammar below understands. Misspellings are snapped to these. */
const VOCAB = [
  "buy", "sell", "purchase", "cancel", "orders", "order", "pause", "resume", "restart", "notify", "alert", "every", "daily", "weekly", "monthly", "hourly",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "dip", "drop", "decline", "pullback", "increase", "profit", "gain", "rise",
  "repeat", "rinse", "loop", "again", "bot", "bots", "agent", "monitor", "watch", "watchlist", "rebalance", "portfolio", "holdings", "performance",
  "position", "shares", "share", "dollars", "worth", "half", "when", "once", "reaches", "reach", "hits", "above", "below", "under", "over", "limit", "stop",
  "loss", "take", "launch", "launched", "tokens", "coins", "analyze", "research", "explain", "outlook", "news", "everything", "entire", "whole", "close",
  "trim", "liquidity", "target", "price", "percent", "falls", "drops", "rises", "continuous", "forever", "cycles", "times", "remind",
];
const VOCAB_SET = new Set(VOCAB);
/** Short words are too risky to auto-correct by distance, so only these well-known slips are fixed. */
const SHORT_FIXES: Record<string, string> = { sel: "sell", sll: "sell", seel: "sell", byu: "buy", bui: "buy", buu: "buy", bye: "buy", cancle: "cancel", alret: "alert", notfiy: "notify" };
/** Everyday phrasings mapped onto the grammar's words (applied after typo correction). */
const PHRASES: [RegExp, string][] = [
  [/\b(get me|grab|pick up|scoop up|snag|acquire|load up on|go long on|go long|invest in|invest|put (?=\$?\d))\b/g, "buy "],
  [/\b(unload|offload|liquidate|dump|cash out of|cash out|get rid of|get out of|exit)\b/g, "sell "],
  [/\b(per ?cent|pct|percentage)\b/g, "%"],
  [/\b(stoploss|stop loss|stop-loss|sl)\b/g, "stop-loss"],
  [/\b(takeprofit|take profit|take-profit|tp)\b/g, "take-profit"],
  [/\b(bucks|usd)\b/g, "dollars"],
  [/\bonce it\b/g, "when it"],
];
/** Common English words that also happen to be tickers. Never read these as assets unless written $LIKE or in caps. */
const ENGLISH = new Set(["ema", "sma", "rsi", "macd", "vwap", "atr", "ath", "atl", "ipo", "ceo", "eps", "etf", "otc", "dca", "fomo", "hodl", "a", "i", "all", "am", "an", "are", "at", "be", "by", "can", "do", "for", "go", "has", "have", "he", "hi", "how", "if", "in", "is", "it", "low", "me", "my", "new", "no", "now", "of", "on", "one", "or", "out", "see", "so", "the", "to", "two", "up", "us", "we", "well", "you", "big", "cat", "key", "real", "open", "true", "fast", "love", "life", "run", "play", "very", "good", "get", "coin", "and", "then", "when", "some", "any", "more", "less", "next", "best", "sure", "fun", "car", "hot", "own", "nice", "safe", "grow", "pump", "moon", "dip", "buy", "sell", "loop", "stop", "half", "max", "min", "am", "pm", "day", "week", "net", "fee", "tax", "cash", "gold", "bond", "rent", "it's", "lets", "let", "want", "need", "like", "just", "please", "much", "many", "ok", "okay"]);

let CATALOG: { symbols: Set<string>; names: Map<string, string> } = { symbols: new Set(), names: new Map() };
/** Feed the live asset catalog (symbols + company/coin names) to the parser. Called by the server before parsing. */
export function setCatalog(symbols: Iterable<string>, names: Iterable<[string, string]>) {
  const n = new Map<string, string>();
  for (const [name, sym] of names) {
    const clean = name.toLowerCase().replace(/[.,]/g, "").replace(/\b(inc|corp|corporation|co|company|ltd|plc|holdings|group|class [a-c]|trust|etf|sa|nv|ag)\b/g, "").replace(/\s+/g, " ").trim();
    if (clean.length >= 3) n.set(clean, sym);
    const first = clean.split(" ")[0];
    if (first.length >= 4 && !n.has(first) && !VOCAB_SET.has(first) && !ENGLISH.has(first)) n.set(first, sym);
  }
  CATALOG = { symbols: new Set([...symbols].map((x) => x.toUpperCase())), names: n };
}

/** Optimal-string-alignment edit distance (insert, delete, substitute, swap neighbours). */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
const allowedTypos = (len: number) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);
function closest(word: string, candidates: Iterable<string>): { word: string; dist: number } | null {
  const max = allowedTypos(word.length);
  if (!max) return null;
  let best: { word: string; dist: number } | null = null;
  for (const c of candidates) {
    if (Math.abs(c.length - word.length) > max || c[0] !== word[0] && c.length < 6) continue;
    const dist = editDistance(word, c, max);
    if (dist <= max && (!best || dist < best.dist)) best = { word: c, dist };
  }
  return best;
}
const assetNameKeys = () => [...Object.keys(NAME_ALIASES), ...CATALOG.names.keys()].filter((k) => !k.includes(" ") && k.length >= 4);

/** Lowercase, tidy punctuation, expand 1k → 1000, fix typos in command words and asset names, map synonyms. */
export function normalize(raw: string): string {
  let t = raw.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[*_~`]+/g, " ")
    .replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => String(Number(n) * 1000))
    .replace(/(\d+(?:\.\d+)?)\s*(m|mil|million)\b/g, (_, n) => String(Number(n) * 1_000_000))
    .replace(/([a-z])\1{2,}/g, "$1$1");
  const names = assetNameKeys();
  t = t.replace(/[a-z][a-z'-]*/g, (w) => {
    if (w in SHORT_FIXES) return SHORT_FIXES[w];
    if (VOCAB_SET.has(w) || ENGLISH.has(w) || w in NAME_ALIASES || CATALOG.names.has(w) || CATALOG.symbols.has(w.toUpperCase())) return w;
    const deduped = w.replace(/([a-z])\1+/g, "$1");
    if (VOCAB_SET.has(deduped) || deduped in NAME_ALIASES) return deduped;
    const v = closest(w, VOCAB), a = closest(w, names);
    if (v && (!a || v.dist <= a.dist)) return v.word;
    if (a) return a.word;
    return w;
  });
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}
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
  const cashtag = text.match(/\$([A-Za-z]{1,10})\b/);
  if (cashtag) return { symbol: cashtag[1].toUpperCase(), contract: null, network };
  const n = normalize(text);
  for (const [name, sym] of Object.entries(NAME_ALIASES)) if (new RegExp(`\\b${name.replace("&", "\\&")}\\b`).test(n)) return { symbol: sym, contract: null, network };
  // Multi-word company names first ("bank of america"), then single words / tickers in any letter case.
  for (const [name, sym] of CATALOG.names) if (name.includes(" ") && n.includes(name)) return { symbol: sym, contract: null, network };
  for (const w of n.match(/[a-z][a-z0-9.-]*/g) ?? []) {
    if (CATALOG.names.has(w)) return { symbol: CATALOG.names.get(w)!, contract: null, network };
    if (!ENGLISH.has(w) && !STOP_WORDS.has(w) && !VOCAB_SET.has(w) && CATALOG.symbols.has(w.toUpperCase())) return { symbol: w.toUpperCase(), contract: null, network };
  }
  const upper = text.match(/\b[A-Z]{2,6}\b/g)?.filter((w) => !["USD", "AND", "THE", "ETF", "TP", "SL", "OK", "AM", "PM"].includes(w) && !ENGLISH.has(w.toLowerCase()));
  if (upper?.length) return { symbol: upper[0], contract: null, network };
  return { symbol: null, contract: null, network };
}

/** Every asset named in a question ("compare BTC and ETH", "nvda vs amd"), in order, up to `max`. */
export function extractAssets(text: string, max = 3): { symbol: string | null; contract: string | null; network: string | null }[] {
  const out: { symbol: string | null; contract: string | null; network: string | null }[] = [];
  const seen = new Set<string>();
  const push = (a: { symbol: string | null; contract: string | null; network: string | null }) => {
    const k = (a.contract ?? a.symbol ?? "").toUpperCase();
    if (k && !seen.has(k) && out.length < max) { seen.add(k); out.push(a); }
  };
  const first = extractAsset(text);
  if (first.contract) push(first);
  for (const m of text.matchAll(/\$([A-Za-z]{1,10})\b/g)) push({ symbol: m[1].toUpperCase(), contract: null, network: first.network });
  const n = normalize(text);
  for (const [name, sym] of Object.entries(NAME_ALIASES)) if (new RegExp(`\\b${name.replace("&", "\\&")}\\b`).test(n)) push({ symbol: sym, contract: null, network: first.network });
  for (const [name, sym] of CATALOG.names) if (name.includes(" ") && n.includes(name)) push({ symbol: sym, contract: null, network: first.network });
  for (const w of n.match(/[a-z][a-z0-9.-]*/g) ?? []) {
    if (CATALOG.names.has(w)) push({ symbol: CATALOG.names.get(w)!, contract: null, network: first.network });
    else if (!ENGLISH.has(w) && !STOP_WORDS.has(w) && !VOCAB_SET.has(w) && CATALOG.symbols.has(w.toUpperCase())) push({ symbol: w.toUpperCase(), contract: null, network: first.network });
  }
  if (!out.length && first.symbol) push(first);
  return out;
}

function amount(text: string): { type: TradeLeg["amount_type"]; value: number | null } {
  const t = normalize(text);
  if (/\bhalf\b/.test(t)) return { type: "percent_position", value: 50 };
  if (/\b(everything|all of|entire|whole) (my )?(position|holding|it)\b|\bclose (my )?position\b|\bsell all\b/.test(t)) return { type: "percent_position", value: 100 };
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%\s*(of\s+)?(my\s+)?([a-z$]+\s+)?(position|holding|stake|bag)?/);
  const usd = t.match(/\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:usd|dollars|bucks)\b|(\d[\d,]*(?:\.\d+)?)\s?\$/);
  if (usd) return { type: "usd", value: num(usd[1] ?? usd[2] ?? usd[3]) };
  const qty = t.match(/\b(\d+(?:\.\d+)?)\s+(shares?|coins?|tokens?|units?|[a-z]{2,6})\b(?! ?%)/);
  if (pct && (pct[5] || /\bsell\b/.test(t)) && !/\b(dip|drop|gain|increase|reach|rise|up|down|profit|loss|higher|lower)\b|take-profit|stop-loss/.test(t.slice(Math.max(0, (pct.index ?? 0) - 14), (pct.index ?? 0) + 30))) return { type: "percent_position", value: num(pct[1]) };
  if (qty && !/%/.test(qty[0])) return { type: "quantity", value: num(qty[1]) };
  return { type: null, value: null };
}

export function parsePrompt(raw: string): Instruction {
  const text = raw.trim();
  const t = normalize(text);
  const asset = extractAsset(text);
  const amt = amount(text);

  // Control commands
  if (/\bcancel\b.*\b(all|every)\b.*\border/.test(t) || /\bcancel (my )?open orders\b/.test(t)) return base("cancel_all_orders", "Cancel all open orders");
  if (/\b(pause|stop|halt)\b.*\b(all|every)?\b.*\bbots?\b/.test(t)) return base("pause_all_bots", "Pause all active bots");
  if (/\b(resume|restart|unpause)\b.*\bbots?\b/.test(t)) return base("resume_all_bots", "Resume paused bots");

  // Swing loop: "buy at 3% dip and sell at 5% increase, rinse and repeat"
  const dip = t.match(/(\d+(?:\.\d+)?)\s*%\s*(dip|drop|decline|pullback|down)|(dip|drop|falls?|declines?|down)\s*(of|by)?\s*(\d+(?:\.\d+)?)\s*%/);
  const rise = t.match(/(\d+(?:\.\d+)?)\s*%\s*(increase|gain|rise|up|profit|pump)|(increase|gain|rise|rises|up|profit)\s*(of|by)?\s*(\d+(?:\.\d+)?)\s*%/);
  // "buys/buying", "sells/selling" count too; "make a bot … 6% dip … 3% profit" is a loop even without the word "sell".
  const isBot = /\b(bot|bots|agent|agents|strateg(y|ies))\b/.test(t);
  const repeatWords = /\b(rinse|repeat|loop|again|keep (doing|going)|continuous|forever|cycle)\b/.test(t);
  // "top 20 gainers / profitable / trending … coins": rank the coins instead of naming one.
  const topN = t.match(/\btop\s+(\d{1,4})\b/);
  const ranked = !!topN || /\b(top|biggest|best)\s+(gainers?|movers?|performers?)\b|\b(gainers|profitable|trending|pumping|hottest)\b/.test(t);
  const coinWords = /\b(meme|memes|memecoins?|coins?|tokens?|gainers?)\b/.test(t);
  // A buy-now loop needs no dip: "buy $10 each and sell at 2% profit, rinse and repeat".
  if ((dip || (ranked && coinWords) || repeatWords) && rise && /\bbuy(s|ing)?\b/.test(t) && (/\bsell(s|ing)?\b/.test(t) || (isBot && /\b(profit|gain|increase|up)\b/.test(t)))) {
    const dipPct = dip ? num(dip[1] ?? dip[5]) : 0, tpPct = num(rise[1] ?? rise[5]);
    const repeat = isBot || repeatWords;
    // Many coins at once: "every/all (Solana) meme coin(s)" or "the top 20 gainers".
    const many = (ranked && coinWords) || /\b(every|all|each|any)\b[^.]*\b(meme|memes|memecoins?|coins|tokens)\b/.test(t);
    const scope = many ? { meme: /\bmeme/.test(t), venue: /\bsol(ana|ona)?\b/.test(t) ? "solana" : /\b(eth|ethereum)\b/.test(t) ? "ethereum" : /\bbase\b/.test(t) ? "base" : null,
      rank: ranked ? ("gainers" as const) : null, top: ranked ? (topN ? Math.max(1, num(topN[1])) : 20) : null } : null;
    const sl = t.match(/stop[- ]?loss (of |at )?(\d+(?:\.\d+)?)\s*%/);
    const cycles = t.match(/(\d+)\s*(times|cycles)/);
    const top = scope?.top ?? null;
    const scopeLabel = scope ? `${top ? `top ${top} ` : ""}${scope.venue ? scope.venue[0].toUpperCase() + scope.venue.slice(1) + " " : ""}${scope.meme ? "meme coins" : "coins"}${top ? " (biggest gainers)" : ""}` : null;
    const each = scope && amt.type === "usd" ? ` $${amt.value} each,` : "";
    return base("swing_loop", `Buy ${scopeLabel ?? asset.symbol ?? "this asset"}${dipPct > 0 ? ` after a ${dipPct}% dip` : " now"},${each} sell at +${tpPct}%${repeat ? ", and repeat" : ""}`, {
      trades: [leg({ side: "buy", symbol: scope ? null : asset.symbol, network: scope?.venue ?? asset.network, contract_address: scope ? null : asset.contract, amount_type: amt.type === "usd" || amt.type === "quantity" ? amt.type : null, amount: amt.type === "usd" || amt.type === "quantity" ? amt.value : null })],
      swing: { dip_pct: dipPct, take_profit_pct: tpPct, stop_loss_pct: sl ? num(sl[2]) : null, repeat, max_cycles: cycles ? num(cycles[1]) : null, scope },
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
    const tpM = t.match(/take-profit (?:of |at )?\+?(\d+(?:\.\d+)?)\s*%/) ?? (side === "buy" ? t.match(/\b(?:sell|close)\b[^%]{0,25}?\+?(\d+(?:\.\d+)?)\s*%\s*(?:profit|gain|up|increase|higher|rise)/) ?? t.match(/\+?(\d+(?:\.\d+)?)\s*%\s*(?:profit|gain)\b/) : null);
    const slM = t.match(/stop-loss (?:of |at )?-?(\d+(?:\.\d+)?)\s*%/) ?? (side === "buy" ? t.match(/-?(\d+(?:\.\d+)?)\s*%\s*(?:loss|down|drop)\b/) : null);
    let tp: readonly [string, null, string] | null = tpM ? [tpM[0], null, tpM[1]] as const : null;
    const sl = slM ? [slM[0], null, slM[1]] as const : null;
    let a = amt;
    // "sell at 50 cents profit" / "sell at $5 profit": a dollar profit on a dollar-sized buy → take-profit %.
    if (!tp && side === "buy") {
      const cash = t.match(/\b(?:sell|close|take-profit)\b[^%]{0,30}?(?:\$\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(cents?|dollars?))\s*(?:of\s+)?(?:profit|gain|up|in profit)\b/);
      if (cash) {
        const dollars = cash[1] ? num(cash[1]) : cash[3]?.startsWith("cent") ? num(cash[2]) / 100 : num(cash[2]);
        const spend = amt.type === "usd" && amt.value ? amt.value : null;
        if (spend && dollars > 0) tp = [cash[0], null, String(+((dollars / spend) * 100).toFixed(2))] as const;
      }
    }
    if (side === "sell" && /\bclose\b/.test(t)) a = { type: "percent_position", value: 100 };
    if (!a.value) return base("clarify", `${side} ${asset.symbol ?? ""}`.trim(), { clarification_question: side === "buy" ? `How much${asset.symbol ? ` ${asset.symbol}` : ""} should I buy? (e.g. $100 or 2 shares)` : `How much${asset.symbol ? ` ${asset.symbol}` : ""} should I sell? (e.g. 25% or 10 shares)`,
      trades: [leg({ side, symbol: asset.symbol, network: asset.network, contract_address: asset.contract, take_profit_pct: tp ? num(tp[2]) : null, stop_loss_pct: sl ? num(sl[2]) : null })] });
    return base("trade", `${side === "buy" ? "Buy" : "Sell"} ${a.type === "usd" ? `$${a.value} of` : a.type === "percent_position" ? `${a.value}% of` : a.value} ${asset.symbol ?? asset.contract ?? "this asset"}`, {
      trades: [leg({ side, symbol: asset.symbol, network: asset.network, contract_address: asset.contract, amount_type: a.type, amount: a.value,
        order_type: lim && /limit/.test(lim[1]) ? "limit" : "market", limit_price: lim && /limit/.test(lim[1]) ? num(lim[2]) : null,
        take_profit_pct: tp ? num(tp[2]) : null, stop_loss_pct: sl ? num(sl[2]) : null })],
    });
  }

  if (/\b(portfolio|holdings|p&l|pnl|how am i doing|performance)\b/.test(t)) return base("portfolio_question", "Portfolio summary");
  if (/\?|\b(why|what|how|analy[sz]e|research|explain|outlook|news)\b/.test(t)) return base("research", "Market research", { research_query: text });
  if ((asset.symbol || asset.contract) && t.split(" ").length <= 4)
    return base("clarify", `What to do with ${asset.symbol ?? "this token"}`, { clarification_question: `What would you like to do with ${asset.symbol ?? "this token"}? Buy, sell, set an alert, or analyze it?`,
      trades: [leg({ side: "buy", symbol: asset.symbol, network: asset.network, contract_address: asset.contract })] });
  return base("clarify", "Unclear request", { clarification_question: "I couldn't tell what you'd like to do. Try e.g. “Buy $100 of SOL”, “Sell 25% of NVDA”, or “Buy at a 3% dip and sell at +5%, repeat”." });
}

/** Merge a clarification answer (e.g. "$100" or "SOL") into the pending instruction. */
export function mergeClarification(pending: Instruction, answer: string): Instruction | null {
  const a = amount(answer.includes("$") || /\d/.test(answer) ? answer : "");
  if (!a.value && /^\s*\d[\d,]*(\.\d+)?\s*$/.test(answer)) { a.value = num(answer); a.type = pending.trades[0]?.side === "buy" ? "usd" : "quantity"; }
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
