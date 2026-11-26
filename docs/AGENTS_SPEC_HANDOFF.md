# Merod Agents: Prompted Multi-Agent Trading System (handoff)

Implements *Merod Prompted Multi-Agent Trading System, Nov 2026* in the existing Merod app. Paper-first:
agents never run live. Live execution stays locked by `MEROD_ALLOW_LIVE_FLAGS` + the Admin real-money switches + 2FA,
and the agent policy layer refuses `mode: "live"` anywhere (create, edit, prompt).

## Repository assessment (what the build reused)
Next.js 16 App Router + React 19 + Tailwind 4, Postgres (raw SQL migrations), durable Railway worker (`worker/index.ts`),
Universal Trading Engine (`src/server/engine/engine.ts`: preview → risk → reservation → idempotent route → reconcile),
cash reservation ledger (migration 028), Modo assistant, bots, shortcuts, copy/mimic services, news feeds, Birdeye/Helius.

## Spec section → code
| § | Requirement | Where |
|---|---|---|
| 01 | Independent / parallel / collaborative / competition / supervisor / sequential modes | `agent_fleets.operation_mode`; `runner.ts` (room chain for collaborative/sequential/supervisor) |
| 02 | 25 agent types | `src/server/agents/catalog.ts` (`ROLES`), handlers in `runner.ts` |
| 03 | Parallel workspace: grid/list, cards, scoped prompts, lifecycle, activity, saved layouts, server continuity | `/agents/workspace`, `/agents`, `agent_layouts`, worker loop `agents` (10s, leased, SKIP LOCKED) |
| 04 | Master prompt → fleet (parse, draft, capital review, approve, start, monitor) | `fleets.ts` `planFleet` / `createFleet` / `fleetAction`, `FleetReview` UI |
| 05 | Prompt-to-agent/fleet, live editing (versioned), fork, merge, spawn proposals, handoff, scheduling, memory, shared knowledge, conditional activation, multi-asset, templates, versions, model selection + routing, budgeting, prompt scheduling, replay | `service.ts`, `runner.ts` (`deliverScheduledPrompts`, `conditionMet`, `replayEvent`), `/agents/[id]` |
| 06 | Rooms, structured messages, untrusted inputs, storm limits | `agent_messages`, `postMessage` (depth ≤ 4, 60/min/room), `/agents/rooms` |
| 07 | Arena: normalised paper competitions, benchmark, risk-adjusted score | `agent_competitions`, `extras.ts`, `/agents/arena` |
| 08 | Capital: sub-ledgers, atomic allocation (advisory lock), reserve, conflict handling | `assertCapital`, `capitalSummary`, `conflict()` in runner, engine reservations, `/agents/capital` |
| 09 | Autonomy levels 1–6, research roles capped, no self-escalation, state machine, emergency stops with explicit semantics | `normalise()`, `agentAction` (ALLOWED transitions), `fleetAction` (`emergency_stop` = pause + cancel, positions kept) |
| 10 | Auto-training: capture → evaluate → propose → in/out-of-sample validate → approve → deploy + rollback | `proposeImprovement`, `decideCandidate`, `/agents/training` |
| 11 | Example prompts | `EXAMPLES` in `FleetReview.tsx`, Marketplace fleet templates |
| 12 | Marketplace (payments disabled pending compliance) | `agent_listings`, `extras.ts`, `/agents/marketplace` |
| 13 | Innovation catalogue (DNA/versions, debate=counterargument, shadow=fork, black box, watchdog, time machine/replay, genealogy, rooms, follow, autopilot, conflict detection, collections) | across `service.ts`, `runner.ts`, `fleets.ts` |
| 14 | Orchestrator → isolated workers → central risk → UTE → event store | worker loop → `tickAgent` → policy checks → `engine.place` (source `agent`) → `agent_events` + realtime |
| 16 | Ten screens | `/agents/workspace`, `/agents/new`, `/agents/[id]`, `/agents/fleets(/[id])`, `/agents/rooms`, `/agents/arena`, `/agents/training`, `/agents/capital`, `/agents/marketplace`, `/analytics` |
| 17 | Naming | Merod Fleet / Arena / Forge / Sentinel / Vault / Exchange / Nexus used as eyebrows; nav stays Agents |
| 18 | Data/API contracts | migrations `031_agents.sql`, `032_builder_strategies.sql`; routes under `/api/agents/*`, `/api/builder`, `/api/research/[id]`, `/api/traders` |
| 19 | Order intent safety (reserve before submit, idempotency, unknown → reconcile, fail closed on stale data) | engine + runner stale-price checks + per-bucket idempotency keys |
| 20 | Acceptance tests | `tests/agents.test.ts` (9 tests) |

Also added: Home, Research, Strategy Builder (real-history backtests, stress scenarios, versions, deploy-to-agent),
Library, champagne-gold theme with slow pulsing glow, and the Trader Directory (public wallets, Merod traders, stock
traders, with per-row Mimic and Mimic all) in Mimic trading and World activity.

## Migrations and rollback
`031_agents.sql` (agents, versions, fleets, events, messages, knowledge, snapshots, competitions, training, listings, layouts;
adds `agent` to `orders.source`), `032_builder_strategies.sql`. Rollback: pause the worker's `agents` loop (stop the worker)
then `DROP TABLE` the new tables. Restore the old `orders_source_check` only after deleting or re-labelling `source='agent'` orders.

## Environment variables (names only)
No new variables. Existing: `DATABASE_URL`, `REDIS_URL`, `MEROD_MASTER_KEY`, `REALTIME_SECRET`, `APP_URL`, `MEROD_ALLOW_LIVE_FLAGS` (keep unset).

## Known limitations / unsupported
- Fundamentals (P/E, EPS, revenue), analyst ratings and options sentiment: no provider connected. Shown as n/a.
- Social sentiment uses Merod Social only. Other networks aren't connected.
- Off-Merod private brokerage / centralized-exchange trades can't be listed or mimicked (not public).
- Top public wallets need Birdeye; mimicking wallet swaps needs Helius.
- Model selection is recorded and routed; agent decisions are deterministic rules (no AI call decides an order).
- Marketplace purchases, rentals, subscriptions and payouts are disabled pending legal/compliance review.
- Live agent execution is intentionally unavailable.
