# Merod Auto Trading — specification checklist

Maps every section of *Merod Auto Trading — Master developer specification (v1.0, 25 Nov 2026)* to the code.
Status: **Done** · **Partial** (works, spec asks for more) · **Missing** · **Gated** (built but off until approvals).

Build policy (spec §01/§17): paper-first. Real-money execution stays off at platform level
(`MEROD_ALLOW_LIVE_FLAGS` server lock + Admin real-money switches + 2FA) and account level.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| P1 Foundation | **Done** | auth/2FA, encrypted keys, paper adapter, strict compiler + versions, reservation ledger, order lifecycle + idempotency, prompt entry, shortcuts, cloud worker, hash-chained audit |
| P2 Automation | **Partial** | multi-session dashboard ✔, scheduling ✔, backtest/paper ✔, activity streaming ✔, pause/emergency ✔; visual rule editor, team builder, full analytics pending |
| P3 Discovery | **Partial** | news ingestion ✔, public Solana wallet copy ✔, Birdeye whales ✔; Radar saved monitors, Mirror shadow runs pending |
| P4 Intelligence | **Partial** | Modo/auto-trading weighted signals + learning ✔; Swarm quorum/vetoes, DNA, time machine, tournaments pending |
| P5 Economy & live | **Gated** | marketplace/subscriptions not built (needs legal review); live pilot gated |

## Section by section

| § | Requirement | Status | Where |
|---|---|---|---|
| 01 | Paper-first, live off by default, extend existing app | Done | `src/server/flags.ts`, `scripts/seed.ts`, Admin real-money panel |
| 02 | Auto Trading first-class nav; Sessions, Lab, Mirror, Radar, Marketplace, Settings pages | Partial | `/auto`, `/sessions`, `/mimic`, `/copy`, `/world`; Radar/Marketplace pages missing |
| 02 | Primary actions: prompt composer, mode badge, pause controls, confirm high-impact | Done | Shell prompt box, PAPER/LIVE switch, emergency stop, confirmations |
| 03 | Sessions: owner, title, env, account, universe, allocation, version, mode, state, P&L, activity | Done | `src/server/lab/sessions.ts`, migration 030 |
| 03 | Lifecycle DRAFT→…→ARCHIVED, server commands with expected revision, who/what/why | Done | `act()` + `session_events` |
| 03 | Start all / pause all; archive only after open orders resolved; runs with browser closed | Done | `actAll()`, archive guard, worker |
| 03 | Account-level atomic reservation ledger; reject over-allocation | Done | `reserveFor()`/`reservedCash()` in `engine.ts`, migration 028, session capacity check |
| 03 | Tiled/pinned/saved layouts | Partial | Auto workspace tiles; saved layouts pending |
| 03 | Leases/heartbeat/watchdog, never replay a submitted order | Partial | worker heartbeat + UNKNOWN reconciliation; session DEGRADED watchdog pending |
| 04 | Modes: manual/approval/semi/auto/observation/mirror; mode ≠ environment | Partial | session `mode`; bots approvalRequired; approval expiry pending |
| 04 | Authoring workflow: prompt → typed versioned rules → validate → backtest → activate | Partial | compile/version/validate ✔; backtest-from-version + consent record pending |
| 04 | Templates: momentum, swing, DCA, triggers, rebalance, discovery, mirroring | Partial | dip loop, SMA, DCA, price trigger, scanner, rebalance bot, mimic/copy |
| 05 | Canonical strict contract, reject code/unknown fields, never order from compile | Done | `src/server/lab/strategies.ts` (`StrategyRules`, `compile`) |
| 05 | Pipeline prompt→validation→preview→version→evaluation→risk→reservation→adapter→audit | Done | compile → sessions → bot runner → `engine.place` (risk, reservation) → audit |
| 06 | Capital/risk/entry-exit/schedule/data controls | Partial | bot limits, daily spend/loss, slippage, stale-price rejection; correlation/sector caps pending |
| 06 | Independent risk engine, machine-readable reason codes | Partial | `preview()` checks; INSUFFICIENT_BUYING_POWER code; codes for all checks pending |
| 06 | Kill switch blocks risk-increasing orders, persists through restart | Done | `global_trading_halt` flag, emergency stop |
| 07 | Specialised agents with structured signals | Partial | Modo + 5 auto-trading data points; separate agent catalog pending |
| 07 | Swarm graph: consensus, quorum, vetoes, max signal age | Missing | P4 |
| 07 | Agent builder/permissions | Missing | P4 |
| 08 | Mirror: opt-in traders + public wallets, consent, shadow, caps, stop-copy | Partial | `src/server/copy/*`; shadow runs/divergence report pending |
| 09 | Radar: screeners, new listings, whale events, news/social, cross-market | Partial | discover, launch discovery, Birdeye, news; saved monitors pending |
| 09 | Token protections (mint/freeze, liquidity, concentration) | Partial | risk flags + liquidity checks; mint/freeze checks pending |
| 10 | Lab: paper/shadow/historical simulation, time machine, tournaments, evolution, DNA | Partial | backtester, ghost trades, theoretical trades; rest P4 |
| 11 | Profit distribution, reallocation, protective/sleep modes, memory, teams | Partial | risk dial, scheduled tasks; rest P4 |
| 11 | Shortcuts (start/pause all, cancel, emergency stop, custom) | Done | shortcuts + sessions start/pause all |
| 11 | Notifications with severity | Partial | in-app notifications; push/email pending |
| 12 | Live activity feed with filters | Done | `/activity`, right bar, auto activity, session activity |
| 12 | Explain every trade | Done | auto trading before/during/after, order checks |
| 12 | Metrics: win rate, profit factor, drawdown, Sharpe, never mix paper/live | Partial | P&L/win rate/drawdown/VaR, paper/live switch; profit factor/Sharpe/export pending |
| 13 | Typed broker/data adapters with capabilities | Done | `src/server/providers/*` |
| 13 | Alpaca first, IBKR later, crypto venues individually | Partial | Alpaca + 7 CEX adapters; IBKR client ID only |
| 14 | Persistent workers, no trading loops in browser | Done | Railway worker |
| 15 | Domain tables + constraints, immutable versions, decimal money | Partial | key tables done; some float columns pre-date spec |
| 16 | API routes | Partial | `/api/strategies*`, `/api/sessions*`, `/api/orders*`, `/api/auto*`; `/api/radar`, `/api/mirror/shadow-runs`, `/api/analytics` pending |
| 16 | Order state machine, idempotency, UNKNOWN reconciliation | Done | `engine.ts` (idempotency key, `unknown`, `reconcileLiveOrders`) |
| 17 | 2FA/step-up, encrypted creds, tenant isolation, prompt-injection defence | Done | `auth.ts`, `crypto.ts`, ownership checks, untrusted-data prompts |
| 17 | Regulatory gates before commercial live release | Gated | needs legal/provider approval (not code) |
| 18 | Marketplace, subscriptions, revenue | Missing / Gated | P5, behind legal review |
| 19 | Acceptance tests | Partial | 74 automated tests incl. compiler, authorisation, capital, idempotency, sessions |

## Environment variables (names only)
`DATABASE_URL`, `REDIS_URL`, `MEROD_MASTER_KEY`, `REALTIME_SECRET`, `APP_URL`, `MEROD_ALLOW_LIVE_FLAGS` (keep unset = live locked),
`SUPER_ADMIN_EMAILS`, `OWNER_EMAIL`. Provider keys are saved encrypted in the app (Admin → Integrations, Broker & AI Keys), never in env or code.

## Compliance blockers (not code)
Broker-dealer / investment-adviser review, copy-trading and marketplace legal review, provider commercial terms,
data redistribution licences. Live pilot needs all of these plus explicit per-account consent.
