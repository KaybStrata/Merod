/**
 * Bootstrap asset catalog. These are REAL instruments with their real identifiers
 * (exchange tickers, ERC-20 contract addresses, SPL mint addresses, Move coin types).
 * Prices for these are fetched from connected market-data providers; until a provider is
 * connected the simulated feed is used and every price is labeled "Simulated".
 * Additional assets are synchronised automatically from broker catalogs and DEX discovery.
 */
export interface SeedAsset {
  asset_class: "stock" | "etf" | "crypto";
  symbol: string; name: string; venue: string; identifier: string; decimals?: number;
  coingecko_id?: string; categories?: string[]; base: number; tradability?: string; providers: string[];
  market_cap?: number;
}

export const SEED_ASSETS: SeedAsset[] = [
  // US equities & ETFs (identifier = ticker; venue = primary listing MIC)
  { asset_class: "stock", symbol: "AAPL", name: "Apple Inc.", venue: "XNAS", identifier: "AAPL", base: 228, categories: ["tech", "mega-cap"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 3.4e12 },
  { asset_class: "stock", symbol: "NVDA", name: "NVIDIA Corp.", venue: "XNAS", identifier: "NVDA", base: 182, categories: ["tech", "ai", "semiconductors"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 4.4e12 },
  { asset_class: "stock", symbol: "MSFT", name: "Microsoft Corp.", venue: "XNAS", identifier: "MSFT", base: 505, categories: ["tech", "ai", "mega-cap"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 3.7e12 },
  { asset_class: "stock", symbol: "TSLA", name: "Tesla Inc.", venue: "XNAS", identifier: "TSLA", base: 410, categories: ["auto", "ev"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 1.3e12 },
  { asset_class: "stock", symbol: "AMZN", name: "Amazon.com Inc.", venue: "XNAS", identifier: "AMZN", base: 225, categories: ["tech", "retail"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 2.4e12 },
  { asset_class: "stock", symbol: "META", name: "Meta Platforms Inc.", venue: "XNAS", identifier: "META", base: 720, categories: ["tech", "ai"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 1.8e12 },
  { asset_class: "stock", symbol: "GOOGL", name: "Alphabet Inc. Class A", venue: "XNAS", identifier: "GOOGL", base: 245, categories: ["tech", "ai"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 3.0e12 },
  { asset_class: "stock", symbol: "AMD", name: "Advanced Micro Devices", venue: "XNAS", identifier: "AMD", base: 165, categories: ["tech", "semiconductors"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 2.7e11 },
  { asset_class: "stock", symbol: "AVGO", name: "Broadcom Inc.", venue: "XNAS", identifier: "AVGO", base: 340, categories: ["tech", "semiconductors"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 1.6e12 },
  { asset_class: "stock", symbol: "PLTR", name: "Palantir Technologies", venue: "XNAS", identifier: "PLTR", base: 175, categories: ["tech", "ai"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 4.1e11 },
  { asset_class: "stock", symbol: "NFLX", name: "Netflix Inc.", venue: "XNAS", identifier: "NFLX", base: 1180, categories: ["media"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 5.0e11 },
  { asset_class: "stock", symbol: "COIN", name: "Coinbase Global", venue: "XNAS", identifier: "COIN", base: 320, categories: ["fintech", "crypto-equity"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 8.0e10 },
  { asset_class: "stock", symbol: "JPM", name: "JPMorgan Chase & Co.", venue: "XNYS", identifier: "JPM", base: 300, categories: ["financials"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 8.3e11 },
  { asset_class: "stock", symbol: "SOFI", name: "SoFi Technologies", venue: "XNAS", identifier: "SOFI", base: 26, categories: ["fintech"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"], market_cap: 2.9e10 },
  { asset_class: "stock", symbol: "SHOP", name: "Shopify Inc.", venue: "XNAS", identifier: "SHOP", base: 150, categories: ["tech"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"] },
  { asset_class: "stock", symbol: "7203", name: "Toyota Motor Corp.", venue: "XTKS", identifier: "7203", base: 18.5, categories: ["auto", "international"], providers: ["ibkr"], tradability: "view_only" },
  { asset_class: "etf", symbol: "SPY", name: "SPDR S&P 500 ETF", venue: "ARCX", identifier: "SPY", base: 665, categories: ["index"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"] },
  { asset_class: "etf", symbol: "QQQ", name: "Invesco QQQ Trust", venue: "XNAS", identifier: "QQQ", base: 600, categories: ["index", "tech"], providers: ["alpaca_trading", "alpaca_broker", "snaptrade", "ibkr", "tradier"] },

  // Crypto — identified by network + contract/mint, never by ticker alone
  { asset_class: "crypto", symbol: "BTC", name: "Bitcoin", venue: "bitcoin", identifier: "native", decimals: 8, coingecko_id: "bitcoin", base: 98000, categories: ["layer-1"], providers: ["swapkit"], market_cap: 1.95e12 },
  { asset_class: "crypto", symbol: "ETH", name: "Ethereum", venue: "ethereum", identifier: "native", decimals: 18, coingecko_id: "ethereum", base: 3400, categories: ["layer-1", "smart-contracts"], providers: ["zerox", "swapkit"], market_cap: 4.1e11 },
  { asset_class: "crypto", symbol: "SOL", name: "Solana", venue: "solana", identifier: "So11111111111111111111111111111111111111112", decimals: 9, coingecko_id: "solana", base: 180, categories: ["layer-1"], providers: ["jupiter"], market_cap: 9.6e10 },
  { asset_class: "crypto", symbol: "BNB", name: "BNB", venue: "bsc", identifier: "native", decimals: 18, coingecko_id: "binancecoin", base: 900, categories: ["layer-1", "exchange"], providers: ["zerox", "swapkit"], market_cap: 1.3e11 },
  { asset_class: "crypto", symbol: "XRP", name: "XRP", venue: "xrp", identifier: "native", decimals: 6, coingecko_id: "ripple", base: 2.4, categories: ["payments"], providers: ["swapkit"], market_cap: 1.4e11 },
  { asset_class: "crypto", symbol: "DOGE", name: "Dogecoin", venue: "dogecoin", identifier: "native", decimals: 8, coingecko_id: "dogecoin", base: 0.22, categories: ["meme"], providers: ["swapkit"], market_cap: 3.3e10 },
  { asset_class: "crypto", symbol: "LTC", name: "Litecoin", venue: "litecoin", identifier: "native", decimals: 8, coingecko_id: "litecoin", base: 105, categories: ["payments"], providers: ["swapkit"] },
  { asset_class: "crypto", symbol: "ADA", name: "Cardano", venue: "cardano", identifier: "native", decimals: 6, coingecko_id: "cardano", base: 0.75, categories: ["layer-1"], providers: [], tradability: "view_only" },
  { asset_class: "crypto", symbol: "AVAX", name: "Avalanche", venue: "avalanche", identifier: "native", decimals: 18, coingecko_id: "avalanche-2", base: 26, categories: ["layer-1"], providers: ["zerox"] },
  { asset_class: "crypto", symbol: "LINK", name: "Chainlink", venue: "ethereum", identifier: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, coingecko_id: "chainlink", base: 20, categories: ["oracle", "defi"], providers: ["zerox"] },
  { asset_class: "crypto", symbol: "PEPE", name: "Pepe", venue: "ethereum", identifier: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18, coingecko_id: "pepe", base: 0.0000105, categories: ["meme"], providers: ["zerox"] },
  { asset_class: "crypto", symbol: "USDC", name: "USD Coin", venue: "solana", identifier: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, coingecko_id: "usd-coin", base: 1, categories: ["stablecoin"], providers: ["jupiter"] },
  { asset_class: "crypto", symbol: "JUP", name: "Jupiter", venue: "solana", identifier: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6, coingecko_id: "jupiter-exchange-solana", base: 0.55, categories: ["defi"], providers: ["jupiter"] },
  { asset_class: "crypto", symbol: "BONK", name: "Bonk", venue: "solana", identifier: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5, coingecko_id: "bonk", base: 0.000022, categories: ["meme"], providers: ["jupiter"] },
  { asset_class: "crypto", symbol: "WIF", name: "dogwifhat", venue: "solana", identifier: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6, coingecko_id: "dogwifcoin", base: 0.85, categories: ["meme"], providers: ["jupiter"] },
  { asset_class: "crypto", symbol: "SUI", name: "Sui", venue: "sui", identifier: "0x2::sui::SUI", decimals: 9, coingecko_id: "sui", base: 3.4, categories: ["layer-1"], providers: ["cetus"] },
  { asset_class: "crypto", symbol: "APT", name: "Aptos", venue: "aptos", identifier: "0x1::aptos_coin::AptosCoin", decimals: 8, coingecko_id: "aptos", base: 4.6, categories: ["layer-1"], providers: ["panora"] },
];

/**
 * DEMO-ONLY launch tokens so the meme-coin discovery UI can be exercised without Helius/DEX Screener.
 * They live on the fictional venue "solana-demo", carry the risk flag "demo_data", are paper-only,
 * and are never created when MEROD_DEMO_DATA=false (always false in production).
 */
export const DEMO_LAUNCHES = [
  { symbol: "DEMOCAT", name: "Demo Cat (DEMO DATA)", base: 0.00042, liq: 85_000, lifecycle: "bonding_curve", minsAgo: 12 },
  { symbol: "DEMOFROG", name: "Demo Frog (DEMO DATA)", base: 0.0031, liq: 410_000, lifecycle: "graduated", minsAgo: 95 },
  { symbol: "DEMOMOON", name: "Demo Moon (DEMO DATA)", base: 0.000087, liq: 22_000, lifecycle: "bonding_curve", minsAgo: 4 },
  { symbol: "DEMOAPE", name: "Demo Ape (DEMO DATA)", base: 0.012, liq: 1_250_000, lifecycle: "graduated", minsAgo: 1440 },
];
