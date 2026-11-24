# Merod — Integration Readiness Report

_Generated from `src/server/providers/catalog.ts` by `npx tsx scripts/readiness-report.ts`._

**Current state:** no provider credentials are configured. Merod runs fully in **paper-trading mode** on a clearly labeled
simulated price feed. Every provider below has a working adapter and a real connection probe. Its status stays
`not_configured` → `credentials_configured` until an admin clicks **Test connection** and the provider answers correctly.

**How to connect any provider:** `/admin/integrations` → paste keys (encrypted at rest) → *Test connection* → *Enable*.
For production use of execution and wallet providers: record the compliance approval → enable the matching feature flag
(requires 2FA + an approval reference, and `MEROD_ALLOW_LIVE_FLAGS=true` on the server — deliberately unset today).
Alternatively, set the listed environment variables on **both** Vercel and Railway.

| Status | Meaning |
|---|---|
| Not configured | Required credentials missing |
| Credentials configured | Keys saved, not yet tested |
| Testing | Probe running |
| Sandbox connected | Probe passed against the sandbox environment |
| Awaiting approval | Production probe passed; compliance approval not recorded |
| Production connected | Probe passed + approval recorded (data/AI providers need no approval) |
| Restricted | Approval denied |
| Connection error | Probe failed (message shown on the card) |
| Disabled | Turned off by an admin |


## Phase 2 — Market data, blockchain infra & wallets

### Helius

Solana RPC, real-time blockchain activity, token launch & wallet monitoring, webhooks.

- **Docs:** https://www.helius.dev/docs
- **Register:** https://dashboard.helius.dev/
- **Environment variables:** `HELIUS_API_KEY`
- **Settings (non-secret):** Webhook receiver URL
- **SDK:** none required (REST)
- **Environments:** sandbox, production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, solana · **Capabilities:** rpc, events, launches, wallet_monitoring
- **Production requirements:** Self-serve plan sufficient for development; choose a plan sized for production RPC/webhook volume.
- **Connection test:** real API probe implemented in the catalog.

### DEX Screener

Trending meme coins, new pairs, liquidity, volume and price changes across DEXs. Public API.

- **Docs:** https://docs.dexscreener.com/api/reference
- **Register:** https://docs.dexscreener.com/
- **Environment variables:** none — public API
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** none · **Users can paste their own keys:** no (platform-level)
- **Coverage:** crypto, solana, ethereum, base, bsc, arbitrum, polygon, avalanche, sui · **Capabilities:** discovery, market_data, trending, liquidity
- **Production requirements:** Public endpoints are rate-limited (documented per-endpoint limits). Review DEX Screener API terms before redistributing data commercially.
- **Connection test:** real API probe implemented in the catalog.

### Birdeye

Token prices, analytics, trading activity, OHLCV history and on-chain discovery.

- **Docs:** https://docs.birdeye.so/
- **Register:** https://bds.birdeye.so/
- **Environment variables:** `BIRDEYE_API_KEY`
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, solana, ethereum, base, bsc, arbitrum, polygon, avalanche, sui · **Capabilities:** market_data, ohlcv, discovery, trending
- **Production requirements:** Paid tier required for production volume and some endpoints; check redistribution terms.
- **Connection test:** real API probe implemented in the catalog.

### Alchemy

Multichain RPC, wallet activity, transaction monitoring and token prices for EVM chains.

- **Docs:** https://www.alchemy.com/docs
- **Register:** https://dashboard.alchemy.com/
- **Environment variables:** `ALCHEMY_API_KEY`
- **SDK:** none required (REST)
- **Environments:** sandbox, production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, ethereum, base, polygon, arbitrum, optimism, avalanche, bsc, solana · **Capabilities:** rpc, events, wallet_monitoring
- **Production requirements:** Self-serve; size compute units for production.
- **Connection test:** real API probe implemented in the catalog.

### CoinGecko

Crypto market data, market cap, token metadata and historical prices.

- **Docs:** https://docs.coingecko.com/
- **Register:** https://www.coingecko.com/en/api
- **Environment variables:** `COINGECKO_API_KEY` (optional)
- **Settings (non-secret):** Plan (demo | pro) — default production: `demo`
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, * · **Capabilities:** market_data, history, metadata
- **Production requirements:** Demo plan is non-commercial; a paid plan is required for commercial display/redistribution.
- **Connection test:** real API probe implemented in the catalog.

### Massive (formerly Polygon.io) _(optional)_

Licensed US stock, options and indices market data (REST + WebSocket).

- **Docs:** https://massive.com/docs
- **Register:** https://massive.com/
- **Environment variables:** `MASSIVE_API_KEY`
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** stock, etf, option, XNYS, XNAS, ARCX · **Capabilities:** market_data, history, streaming
- **Production requirements:** Displaying real-time exchange data to end users requires the appropriate business plan and exchange agreements.
- **Connection test:** real API probe implemented in the catalog.

### Twelve Data _(optional)_

Global stocks, ETFs, forex and crypto time series.

- **Docs:** https://twelvedata.com/docs
- **Register:** https://twelvedata.com/pricing
- **Environment variables:** `TWELVEDATA_API_KEY`
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** stock, etf, crypto, * · **Capabilities:** market_data, history
- **Production requirements:** Commercial redistribution requires an enterprise/display license.
- **Connection test:** real API probe implemented in the catalog.

### Privy

Embedded wallets, external wallet connections, authentication and policy-controlled delegated signing.

- **Docs:** https://docs.privy.io/
- **Register:** https://dashboard.privy.io/
- **Environment variables:** `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY` (optional)
- **Settings (non-secret):** Webhook URL
- **SDK:** `npm i @privy-io/react-auth @privy-io/node` — React SDK provides login + embedded wallet UI; Node SDK for server wallet operations.
- **Environments:** sandbox, production · **Auth:** basic · **Users can paste their own keys:** no (platform-level)
- **Coverage:** crypto, ethereum, base, polygon, arbitrum, solana, bitcoin · **Capabilities:** embedded_wallets, signing, auth
- **Production requirements:** Security review of signing policies, spending limits and key quorum before enabling delegated real-money signing. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

## Phase 3 — Crypto execution

### Jupiter

Solana swap aggregator: quotes, liquidity routing and transaction building for SPL tokens and established meme coins.

- **Docs:** https://developers.jup.ag/docs
- **Register:** https://developers.jup.ag/portal
- **Environment variables:** `JUPITER_API_KEY` (optional)
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, solana · **Capabilities:** quote, execute, discovery, routing
- **Production requirements:** Wallet signing security review + live_crypto_trading feature flag. Jupiter has no testnet; sandbox testing uses quotes only. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### Pump.fun + PumpSwap

Direct bonding-curve trading for newly launched tokens and PumpSwap AMM trading after graduation, with automatic lifecycle detection.

- **Docs:** https://github.com/pump-fun/pump-public-docs
- **Register:** https://github.com/pump-fun/pump-public-docs
- **Environment variables:** `SOLANA_RPC_URL` (optional)
- **Settings (non-secret):** Public Solana RPC URL (non-secret, optional)
- **SDK:** `npm i @pump-fun/pump-sdk @pump-fun/pump-swap-sdk @solana/web3.js @coral-xyz/anchor` — Lifecycle detection and bonding-curve quotes work via raw RPC reads; building signed buy/sell instructions requires the SDKs.
- **Environments:** production · **Auth:** none · **Users can paste their own keys:** yes
- **Coverage:** crypto, solana · **Capabilities:** quote, execute, lifecycle_detection, launches
- **Production requirements:** High-risk asset class: token screening, liquidity minimums and explicit risk acknowledgement required before live trading. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### 0x Swap API

EVM DEX aggregation (Ethereum, Base, BNB Chain, Polygon, Arbitrum, Avalanche and more).

- **Docs:** https://docs.0x.org/
- **Register:** https://dashboard.0x.org/
- **Environment variables:** `ZEROX_API_KEY`
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, ethereum, base, bsc, polygon, arbitrum, avalanche, optimism · **Capabilities:** quote, execute, routing
- **Production requirements:** Production rate limits and any integrator-fee setup are configured in the 0x dashboard. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### SwapKit

Native cross-chain swaps (BTC, DOGE, LTC, XRP and more) with cross-chain transaction tracking.

- **Docs:** https://docs.swapkit.dev/
- **Register:** https://www.swapkit.dev/
- **Environment variables:** `SWAPKIT_API_KEY`
- **SDK:** none required (REST)
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, bitcoin, dogecoin, litecoin, xrp, ethereum, cosmos, thorchain, maya · **Capabilities:** quote, execute, cross_chain, tracking
- **Production requirements:** Cross-chain swaps involve native deposits; requires wallet support per chain and compliance review. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### Cetus Aggregator

Sui blockchain swap aggregation for Sui ecosystem tokens.

- **Docs:** https://cetus-1.gitbook.io/cetus-developer-docs/
- **Register:** https://cetus-1.gitbook.io/cetus-developer-docs/
- **Environment variables:** `CETUS_API_KEY` (optional)
- **Settings (non-secret):** Router API URL — default production: `https://api-sui.cetus.zone/router_v3/find_routes`
- **SDK:** `npm i @cetusprotocol/aggregator-sdk @mysten/sui` — SDK builds the Sui transaction block from a route.
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, sui · **Capabilities:** quote, execute, routing
- **Production requirements:** Sui wallet support (Privy does not cover all Sui flows — use a Sui wallet adapter). _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### Panora

Aptos DEX aggregator for Aptos ecosystem tokens.

- **Docs:** https://docs.panora.exchange/
- **Register:** https://docs.panora.exchange/
- **Environment variables:** `PANORA_API_KEY`
- **SDK:** `npm i @aptos-labs/ts-sdk` — Used to sign/submit the transaction payload Panora returns.
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** crypto, aptos · **Capabilities:** quote, execute, routing
- **Production requirements:** Aptos wallet support (Petra / Aptos wallet adapter) required for signing. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

## Phase 4 — AI

### Anthropic Claude

Claude models for prompt interpretation, research, strategy and bot configuration (structured outputs).

- **Docs:** https://platform.claude.com/docs
- **Register:** https://platform.claude.com/
- **Environment variables:** `ANTHROPIC_API_KEY`
- **SDK:** `npm i @anthropic-ai/sdk (installed)`
- **Environments:** production · **Auth:** api_key · **Users can paste their own keys:** yes
- **Coverage:** n/a · **Capabilities:** llm, structured_output
- **Production requirements:** Standard API terms; AI never receives credentials or signing material.
- **Connection test:** real API probe implemented in the catalog.

### OpenAI

OpenAI models for prompt interpretation, research and strategy creation (structured outputs).

- **Docs:** https://platform.openai.com/docs
- **Register:** https://platform.openai.com/
- **Environment variables:** `OPENAI_API_KEY`
- **SDK:** `npm i openai (installed)`
- **Environments:** production · **Auth:** bearer · **Users can paste their own keys:** yes
- **Coverage:** n/a · **Capabilities:** llm, structured_output
- **Production requirements:** Standard API terms; AI never receives credentials or signing material.
- **Connection test:** real API probe implemented in the catalog.

## Phase 5 — Stock brokerage

### Alpaca Trading API

US stocks & ETFs, fractional shares and paper trading for an individual Alpaca account.

- **Docs:** https://docs.alpaca.markets/
- **Register:** https://app.alpaca.markets/signup
- **Environment variables:** `ALPACA_API_KEY`, `ALPACA_API_SECRET`
- **Settings (non-secret):** Base URL (ALPACA_BASE_URL) — default sandbox: `https://paper-api.alpaca.markets`, production: `https://api.alpaca.markets`
- **SDK:** none required (REST)
- **Environments:** sandbox, production · **Auth:** api_key · **Users can paste their own keys:** yes (own account only)
- **Coverage:** stock, etf, XNYS, XNAS, ARCX, BATS · **Capabilities:** quote, execute, positions, asset_catalog, paper
- **Production requirements:** The Trading API trades ONE Alpaca account. It must never execute other customers' orders. Customer trading requires the Broker API + Alpaca commercial agreement (or Alpaca OAuth Connect for users' own accounts). _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### Alpaca Broker API

Embedded brokerage: customer account opening (KYC), funding, and order execution for Merod customers.

- **Docs:** https://docs.alpaca.markets/docs/about-broker-api
- **Register:** https://broker-app.alpaca.markets/
- **Environment variables:** `ALPACA_BROKER_API_KEY`, `ALPACA_BROKER_API_SECRET`
- **Settings (non-secret):** Base URL — default sandbox: `https://broker-api.sandbox.alpaca.markets`, production: `https://broker-api.alpaca.markets`
- **SDK:** none required (REST)
- **Environments:** sandbox, production · **Auth:** basic · **Users can paste their own keys:** no (platform-level)
- **Coverage:** stock, etf, XNYS, XNAS, ARCX · **Capabilities:** accounts, kyc, funding, execute, asset_catalog
- **Production requirements:** Signed Alpaca Broker agreement, KYC/AML program, disclosures and Alpaca go-live approval. Live customer stock trading stays disabled until then. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### SnapTrade

Connect users' existing brokerage accounts; sync balances/holdings and trade where the brokerage supports it.

- **Docs:** https://docs.snaptrade.com/
- **Register:** https://dashboard.snaptrade.com/
- **Environment variables:** `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`
- **Settings (non-secret):** Webhook URL
- **SDK:** `npm i snaptrade-typescript-sdk (installed)` — Requests are HMAC-signed by the SDK.
- **Environments:** sandbox, production · **Auth:** hmac_sdk · **Users can paste their own keys:** no (platform-level)
- **Coverage:** stock, etf, crypto, * · **Capabilities:** connect, holdings, execute
- **Production requirements:** Production keys and trading permissions require SnapTrade approval; per-brokerage trade support varies. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### Interactive Brokers

International markets and global securities via the IBKR Web API (Client Portal Gateway for development; OAuth for approved third parties).

- **Docs:** https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
- **Register:** https://www.interactivebrokers.com/en/trading/ib-api.php
- **Environment variables:** `IBKR_OAUTH_CONSUMER_KEY` (optional)
- **Settings (non-secret):** Client Portal Gateway URL (IBKR_GATEWAY_URL) — default sandbox: `https://localhost:5000`
- **SDK:** none required (REST)
- **Environments:** sandbox, production · **Auth:** session_gateway · **Users can paste their own keys:** yes (own account only)
- **Coverage:** stock, etf, option, future, forex, global · **Capabilities:** quote, execute, positions
- **Production requirements:** Serving Merod customers requires IBKR third-party/introducing-broker approval and OAuth onboarding. The gateway approach is limited to a single logged-in account. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

### Tradier _(optional)_

US stocks and options trading; sandbox for development.

- **Docs:** https://docs.tradier.com/
- **Register:** https://developer.tradier.com/
- **Environment variables:** `TRADIER_ACCESS_TOKEN`
- **Settings (non-secret):** Base URL — default sandbox: `https://sandbox.tradier.com`, production: `https://api.tradier.com`
- **SDK:** none required (REST)
- **Environments:** sandbox, production · **Auth:** bearer · **Users can paste their own keys:** yes (own account only)
- **Coverage:** stock, etf, option, XNYS, XNAS · **Capabilities:** quote, execute, positions
- **Production requirements:** Commercial (multi-user) integrations require Tradier partner approval. _(approval-gated in Merod)_
- **Connection test:** real API probe implemented in the catalog.

## Custom APIs
Any other REST provider can be added without a code change: `/admin/integrations` → **Add custom API** (base URL, auth style, header/param name,
test path). Custom providers support credential storage, connection tests and usage monitoring. Execution through a custom provider needs a reviewed adapter.

## Required commercial approvals before real money
1. **Alpaca Broker API** agreement + KYC/AML program + go-live approval (embedded customer brokerage). The Trading API keys must never execute other customers' orders.
2. **SnapTrade** production keys with trading permissions.
3. **Interactive Brokers** third-party / introducing-broker approval and OAuth onboarding.
4. **Tradier** partner approval for multi-user use (optional).
5. **Market data redistribution licenses** for real-time equities display (Massive/Alpaca SIP/exchange agreements) and paid crypto data plans for commercial use (CoinGecko, Birdeye).
6. **Wallet security review** of Privy signing policies, spending limits and key quorum before delegated signing.
7. **Legal review** per jurisdiction for brokerage, crypto, copy trading, funding and withdrawals (feature flags + `jurisdiction_rules`).

## Remaining development before production activation
- Client-side wallet signing UI (Solana / EVM wallet adapters) to sign the unsigned transactions Jupiter and 0x adapters already return (`POST /api/orders/:id { action: "signed" }` is implemented).
- Pump.fun bonding-curve instruction building (install `@pump-fun/pump-sdk`; lifecycle detection and quotes are implemented).
- SwapKit cross-chain deposit flow, Cetus/Panora transaction signing (quotes implemented).
- IBKR OAuth (third-party) session management; Client Portal Gateway probe is implemented for development.
- Licensed news data provider for the news-monitor bot.
- Penetration test and third-party security review.
