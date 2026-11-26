/**
 * Agent catalogue (spec §02A/§02B): 25 role templates with editable instructions, tool permissions and safe defaults.
 * A template describes capabilities; it does not imply that a data source or broker exists. `trades` marks roles
 * that may ever hold capital and submit orders (still subject to autonomy level, policy engine and order engine).
 */
export type RoleGroup = "market" | "operations";
export type StrategyKind = "momentum" | "mean_reversion" | "breakout" | "dip" | "dca" | "news" | "mimic" | "none";
export interface RoleDef {
  id: string; name: string; group: RoleGroup; description: string; trades: boolean;
  defaultAutonomy: number; strategy: StrategyKind; tools: string[]; defaultInstructions: string;
}

const R = (id: string, name: string, group: RoleGroup, description: string, trades: boolean, strategy: StrategyKind, tools: string[], defaultInstructions: string, defaultAutonomy = trades ? 5 : 1): RoleDef =>
  ({ id, name, group, description, trades, strategy, tools, defaultInstructions, defaultAutonomy });

export const ROLES: RoleDef[] = [
  // ── Market and strategy specialists
  R("stock_trading", "Stock Trading", "market", "Monitors and trades supported equities.", true, "momentum", ["market_data", "orders"], "Trade the assigned stocks on momentum with tight risk control."),
  R("crypto_trading", "Crypto Trading", "market", "Trades supported cryptocurrencies across connected exchanges.", true, "momentum", ["market_data", "orders"], "Trade the assigned coins on momentum and volume."),
  R("memecoin", "Memecoin", "market", "Discovers tokens; evaluates liquidity, momentum and contract risks.", true, "breakout", ["market_data", "token_screening", "orders"], "Find liquid meme coins with momentum; skip anything with risk flags."),
  R("sniping", "Sniping", "market", "Monitors newly listed assets and permitted entry conditions.", true, "breakout", ["launches", "token_screening", "orders"], "Watch new listings and enter only when liquidity and screening checks pass."),
  R("mimic", "Mimic", "market", "Replicates eligible trader or public wallet trades within limits.", true, "mimic", ["public_wallets", "orders"], "Mirror the followed wallets' trades within my limits."),
  R("copy_trading", "Copy Trading", "market", "Follows selected traders or approved strategies.", true, "mimic", ["leaders", "orders"], "Copy the selected traders with a fixed amount per trade."),
  R("news", "News", "market", "Monitors financial articles, announcements and breaking news.", false, "news", ["news"], "Track news for my assets and flag material catalysts with sources."),
  R("social_sentiment", "Social Sentiment", "market", "Analyzes public discussions across supported social sources.", false, "none", ["social"], "Summarise public sentiment on my assets from Merod's social feed."),
  R("wallet_tracking", "Wallet Tracking", "market", "Tracks public blockchain wallet transactions and patterns.", false, "none", ["public_wallets"], "Track profitable public Solana wallets and flag mimic candidates for review."),
  R("technical_analysis", "Technical Analysis", "market", "Analyzes indicators, volume, trends and chart patterns.", false, "momentum", ["market_data", "indicators"], "Report RSI, MACD, moving averages and volume for my assets."),
  R("fundamental_analysis", "Fundamental Analysis", "market", "Studies earnings, financial statements and valuations.", false, "none", ["market_data", "fundamentals"], "Summarise valuation and size for my stocks from available data."),
  R("arbitrage", "Arbitrage", "market", "Identifies price differences after fees and execution constraints.", false, "none", ["market_data"], "Compare prices of the same asset across venues after fees. Report only; never trade."),
  R("market_scanner", "Market Scanner", "market", "Continuously searches for user-defined market conditions.", false, "none", ["market_data", "screener"], "Scan for assets up more than 5% with rising volume."),
  // ── Operations and oversight
  R("risk_management", "Risk Management", "operations", "Monitors exposure, drawdown, concentration and trading limits.", false, "none", ["portfolio", "risk"], "Watch exposure, drawdown and concentration; block new risk when limits are hit."),
  R("portfolio", "Portfolio", "operations", "Tracks holdings, diversification and rebalancing opportunities.", false, "none", ["portfolio"], "Track my holdings and suggest rebalancing when weights drift."),
  R("strategy_builder", "Strategy Builder", "operations", "Converts natural-language instructions into structured trading rules.", false, "none", ["strategy_compiler"], "Turn my ideas into validated, versioned strategy rules."),
  R("backtesting", "Backtesting", "operations", "Tests strategies against historical market data.", false, "none", ["backtester"], "Backtest my agents' strategies on real history and report results."),
  R("auto_training", "Auto-Training", "operations", "Evaluates previous decisions and proposes improvements.", false, "none", ["evaluations"], "Review my agents' past trades and propose versioned improvements."),
  R("execution", "Execution", "operations", "Routes validated orders through supported brokers and exchanges.", true, "none", ["orders"], "Submit only orders approved by the risk service."),
  R("supervisor", "Supervisor", "operations", "Coordinates multiple agents and enforces assigned permissions through the policy engine.", false, "none", ["fleet", "risk"], "Coordinate the fleet, review decisions and pause agents when risk limits are breached."),
  R("counterargument", "Counterargument", "operations", "Challenges assumptions and identifies overlooked risks.", false, "none", ["market_data", "news"], "Challenge every proposal with the strongest bear case."),
  R("exit", "Exit", "operations", "Manages approved exits, stops and profit-taking conditions.", true, "none", ["orders"], "Manage take-profit and stop-loss exits for open agent positions."),
  R("earnings", "Earnings", "operations", "Monitors corporate earnings and related market reactions.", false, "news", ["news", "market_data"], "Watch earnings news for my stocks and the price reaction."),
  R("macro", "Macro", "operations", "Tracks rates, inflation and economic developments.", false, "news", ["news"], "Track rates, inflation and macro headlines."),
  R("agent_builder", "Agent Builder", "operations", "Creates specialized agents from user prompts, subject to review and authorization.", false, "none", ["agent_factory"], "Propose new specialist agents for my review."),
];
export const roleById = (id: string) => ROLES.find((r) => r.id === id);
export const ROLE_IDS = ROLES.map((r) => r.id) as [string, ...string[]];

/** Autonomy levels (spec §09). */
export const AUTONOMY = [
  { level: 1, name: "Observe", text: "Monitor markets and record information; no order creation." },
  { level: 2, name: "Suggest", text: "Generate recommendations; no orders." },
  { level: 3, name: "Prepare", text: "Build strategies and prepare order previews; no submission." },
  { level: 4, name: "Supervised", text: "Execute after individual user approval." },
  { level: 5, name: "Conditional", text: "Automatically execute previously approved rules within fixed limits." },
  { level: 6, name: "Autonomous", text: "Independently operate within explicitly authorized capital and risk boundaries." },
] as const;

/** Models an agent can be assigned (spec §05 Model Selection). "rules" = deterministic only, no AI usage. */
export const MODELS = [
  { id: "auto", label: "Automatic routing" },
  { id: "rules", label: "Rules only (no AI)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fast)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (deep)" },
] as const;
/** Automatic model routing: pick an eligible model by task complexity (latency/cost aware). */
export function routeModel(role: string, model: string) {
  if (model !== "auto") return model;
  if (["supervisor", "counterargument", "fundamental_analysis", "macro", "agent_builder", "strategy_builder"].includes(role)) return "claude-sonnet-5-5";
  if (["news", "social_sentiment", "earnings", "auto_training"].includes(role)) return "claude-haiku-5-5";
  return "rules";
}

export const STRATEGY_LABEL: Record<StrategyKind, string> = {
  momentum: "Momentum", mean_reversion: "Mean reversion", breakout: "Breakout", dip: "Dip buying", dca: "DCA accumulation", news: "News reaction", mimic: "Wallet mimic", none: "Analysis only",
};

/** Default strategy parameters; every value is editable and versioned. */
export function defaultStrategy(kind: StrategyKind) {
  const base = { kind, tradeUsd: 100, takeProfitPct: 4, stopLossPct: 2, maxOpen: 3, timeframe: "1h" as const };
  if (kind === "momentum") return { ...base, minChangePct: 1.5, rsiMax: 75 };
  if (kind === "mean_reversion") return { ...base, rsiBuy: 30, rsiSell: 70 };
  if (kind === "breakout") return { ...base, lookback: 20, minVolumeRise: 1.3 };
  if (kind === "dip") return { ...base, dipPct: 3, takeProfitPct: 5 };
  if (kind === "dca") return { ...base, everyHours: 24, takeProfitPct: 0, stopLossPct: 0 };
  if (kind === "news") return { ...base, minChangePct: 1 };
  return base;
}
