# Merod

Unified trading platform: stocks, crypto and meme coins traded **manually**, by **natural-language prompts**, with **custom shortcut buttons**, or by **automated agents/bots**. Every path runs through one **Universal Trading Engine** with risk checks, idempotency and a hash-chained audit log.

> **Status:** paper trading is enabled, with $100k virtual funds per user. **Real-money trading is disabled** until provider approvals, licenses and legal review are in place. Prices come from a clearly labeled **simulated** feed until market-data providers are connected.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL · Redis + BullMQ · WebSockets (`ws`) · TradingView Lightweight Charts · Anthropic Claude + OpenAI (structured outputs) · deploys to **Vercel** (web) + **Railway** (worker, Postgres, Redis).

```
src/app/(auth)        sign up / sign in / 2FA
src/app/(app)         dashboard, discover, terminal, AI trade, shortcuts, bots, social, portfolio, wallet, alerts, settings, admin
src/app/api           REST API (route handlers)
src/server/engine     Universal Trading Engine (preview → checks → approval → route → reconcile)
src/server/providers  provider catalog, encrypted credential vault, execution adapters, custom APIs
src/server/market     asset catalog, simulated feed, live market-data sync, launch discovery
src/server/ai         prompt → structured instruction (Claude/OpenAI or rule parser) → plans
src/server/bots       strategies (pure, backtestable) + persistent runner
worker/index.ts       always-on worker: feeds, bots, reconciliation, alerts, WebSocket gateway
migrations/*.sql      schema (applied by scripts/migrate.ts)
```

## Local development

Requires Node 22+, PostgreSQL 14+ and Redis 6+.

```bash
cp .env.example .env.local
```
```bash
npm ci
```
```bash
npm run db:setup
```
```bash
npm run dev
```
```bash
npm run dev:worker
```

Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env.local` before `db:setup` to create an admin. Open http://localhost:3000.

For local scripts outside Next.js, export the variables in your shell: Next.js loads `.env.local` automatically, but `tsx` scripts don't.

## Verify

```bash
npm run verify
```
This runs the typecheck, the tests (against `TEST_DATABASE_URL`, default `postgres://merod:merod@localhost:5432/merod_test`, migrated and seeded first), the security check and the production build.

## Deploy

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for exact Vercel and Railway settings and environment variables. See **[docs/INTEGRATION_READINESS.md](./docs/INTEGRATION_READINESS.md)** for every provider's keys, links, SDKs and approval requirements.

## Safety model (summary)

- One order goes to exactly one provider. Ambiguous submissions become `unknown` and are reconciled, never re-sent elsewhere.
- Per-user idempotency keys. Bots use deterministic keys, so restarts can't double-buy.
- Risk limits: max order, daily spend, daily loss, slippage, liquidity, token risk flags, stale-price rejection, emergency stop, global halt.
- AI only produces a schema-validated instruction. It has no access to credentials, keys or permissions. Untrusted market text is never treated as instructions.
- Provider keys and users' own keys are AES-256-GCM encrypted (`MEROD_MASTER_KEY`) and never sent to the browser. A provider is "connected" only after a real probe passes.
- Real-money flags can't be enabled without `MEROD_ALLOW_LIVE_FLAGS=true`, 2FA and an approval reference. The seed forces them off on every deploy.

Not financial advice. Profitability is never guaranteed.
