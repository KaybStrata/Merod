# Deploying Merod

Merod is **one repository with two runtime processes** that share one Postgres database and one Redis:

| Process | What it does | Command | Where |
|---|---|---|---|
| **Web** (Next.js 16) | Website, auth, REST API, Trading Engine for user requests | `npm run build` → `npm run start` | **Vercel** (recommended) or Railway |
| **Worker** (Node 22) | Price feed, paper order matching, **trading bots**, **auto-training**, live-order reconciliation, alerts, portfolio snapshots, provider health checks, BullMQ jobs, **WebSocket gateway** (live activity, ghost trades, suggestions refresh) | `npm run worker` | **Railway** (must be always-on) |
| Postgres 16 | All data; provider secrets encrypted with `MEROD_MASTER_KEY` | – | Railway Postgres (or Supabase/Neon) |
| Redis 7 | Realtime pub/sub + BullMQ queue | – | Railway Redis |

> The worker is required. Without it, bots don't run, prices go stale after 60 s, and the engine rejects orders with "Stale price". This is deliberate: it protects against trading on stale data.

## Recommended topology

```
                ┌──────────── Vercel ────────────┐
 browser ──────▶│ Next.js web + /api routes       │──┐   (public Postgres URL, TLS)
    │           └─────────────────────────────────┘  │
    │ wss://…/ws                                       ▼
    │           ┌──────────── Railway project ─────────────────────┐
    └──────────▶│ worker  ──(private network)──▶ Postgres   Redis  │
                │   ▲ runs migrations + seed before each deploy     │
                └──────────────────────────────────────────────────┘
```

**Alternative: Railway only.** The app isn't one combined server; it's a Next.js app plus a separate worker. You can still run both on Railway as two services from the same repo (`web` + `worker`). This is simpler, because everything is on Railway's private network with no public database URL and no serverless connection limits. Use it if you don't need Vercel's edge/CDN features. Both options are configured below.

---

## 0. One-time: generate secrets

Run these locally and save the output in a password manager. Never commit it.

```bash
openssl rand -base64 32
```
Use the output as `MEROD_MASTER_KEY`. It encrypts provider keys, users' API keys and 2FA seeds. **It must be identical on every service, and losing it makes stored keys unreadable.**

```bash
openssl rand -base64 32
```
Use the output as `REALTIME_SECRET`. It signs WebSocket tokens and must also be identical on web and worker.

```bash
openssl rand -base64 18
```
Use the output as `SUPER_ADMIN_SETUP_CODE`. It's the one-time code that lets the owner email claim the **super admin** role at sign-up. Set it on Vercel (or the Railway web service), where sign-up runs. You can delete it after you've signed up.

### Super admin (platform owner)

Set `SUPER_ADMIN_EMAILS` to your owner email and `SUPER_ADMIN_SETUP_CODE` to the code above, on the service that serves the website. Then open **/signup** with that email and choose your password (at least 12 characters). The page asks for the setup code, and you're taken straight to 2FA setup. **Enable 2FA**: changing fees requires a 2FA code.

The super admin can do everything an admin can, plus set the **platform fee** at `/admin/fees`. The default is **7% performance fee** (7% of realized profit on closing trades, nothing on losses); a commission-per-trade mode is also available. The role can't be granted, removed or suspended from the admin panel. Because email ownership isn't verified at sign-up, the setup code is what protects the reserved email.

## 1. Push to GitHub

```bash
git remote add origin git@github.com:<you>/merod.git
```
```bash
git push -u origin main
```
CI (`.github/workflows/ci.yml`) then runs typecheck, migrations, tests, the security check and a production build against Postgres and Redis.

## 2. Railway: database, Redis, worker

1. Create a Railway project, choose **Deploy from GitHub repo**, and select the repo. This first service becomes the worker; rename it `worker`.
2. **Add → Database → PostgreSQL** and **Add → Database → Redis**.
3. Worker service → **Settings**:
   - **Config file path:** `railway/worker.railway.json`. Or set the following manually:
   - **Build command:** `npm ci`
   - **Pre-deploy command:** `npm run release` (runs migrations, then the idempotent seed)
   - **Start command:** `npm run worker`
   - **Healthcheck path:** `/healthz`
   - **Restart policy:** Always
   - **Networking → Generate domain** (this is the public WebSocket endpoint).
4. Worker → **Variables:**

| Variable | Value |
|---|---|
| `MEROD_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (private network) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `MEROD_MASTER_KEY` | from step 0 |
| `REALTIME_SECRET` | from step 0 |
| `PG_POOL_MAX` | `10` |
| `MEROD_DEMO_DATA` | `false` (or `true` if you want labeled demo launch tokens in a staging environment) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your first admin account (password ≥ 12 chars). Remove after first deploy if you like. |
| `NIXPACKS_NODE_VERSION` / `NODE_VERSION` | `22` (only if the builder picks an older Node; `package.json` declares `engines.node >= 22`) |
| *(optional)* provider keys | any of the keys in `.env.example`, or paste them later in `/admin/integrations` |

5. Deploy. The worker's `/healthz` should return `{"ok":true,…}` and the logs should show `worker … up`.
6. Note the worker's public domain, e.g. `merod-worker-production.up.railway.app`. The WebSocket URL is `wss://<that-domain>/ws`.
7. Postgres service → **Variables** tab: copy **`DATABASE_PUBLIC_URL`**. Vercel needs it (`…proxy.rlwy.net:PORT/railway`).

> Real money stays off. The seed forces all real-money flags off on every deploy unless `MEROD_ALLOW_LIVE_FLAGS=true`. Don't set that.

## 3a. Vercel: website

1. **Add New → Project →** import the GitHub repo. Framework preset: **Next.js** (auto-detected; `vercel.json` pins the install and build commands).
2. Leave the root directory at `./`. Install command: `npm ci`. Build command: `npm run build`. Output: default.
3. **Environment variables** (Production, and Preview if you use it):

| Variable | Value |
|---|---|
| `MEROD_ENV` | `production` |
| `DATABASE_URL` | Railway Postgres **public** URL (`DATABASE_PUBLIC_URL`) |
| `DATABASE_SSL` | `true` |
| `PG_POOL_MAX` | `3` (serverless: keep connections low) |
| `REDIS_URL` | Railway Redis **public** URL (`REDIS_PUBLIC_URL`). Optional: without it the web app still works, and realtime events come from the worker. |
| `MEROD_MASTER_KEY` | same value as the worker |
| `REALTIME_SECRET` | same value as the worker |
| `APP_URL` | `https://<your-vercel-domain>` |
| `NEXT_PUBLIC_REALTIME_URL` | `wss://<worker-domain>/ws` |
| `SUPER_ADMIN_EMAILS` | your owner email (reserved for the super admin) |
| `SUPER_ADMIN_SETUP_CODE` | from step 0 (≥ 12 chars). Remove after you've signed up. |
| *(optional)* `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODELS` | or paste them in `/admin/integrations` |

4. Deploy. Open `https://<domain>/api/health`. You should see `db: true`, `migrations ≥ 8` and `workerHealthy: true`.
5. Sign in with `ADMIN_EMAIL`, **enable 2FA** (Settings → Security), then open **/admin/integrations**.

Database migrations run from the Railway worker's pre-deploy step, not from the Vercel build, so a Vercel build never needs database access. Deploy the worker first whenever a release adds a migration.

## 3b. Alternative: Railway-only web service

Add a second service from the same repo, named `web`:
- **Config file path:** `railway/web.railway.json`. Or set it manually: Build `npm ci && npm run build`, Pre-deploy `npm run db:migrate`, Start `npm run start`, Healthcheck `/api/health`.
- **Variables:** same as the Vercel table, except `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `REDIS_URL=${{Redis.REDIS_URL}}` (private), with `DATABASE_SSL` unset and `PG_POOL_MAX=10`.
- `npm run start` binds `$PORT`, which Railway sets. Generate a public domain and use it for `APP_URL`.

## 4. After deploying: verify

- `GET /api/health` → 200, `workerHealthy: true`
- Worker `GET /healthz` → 200, with every loop showing a recent `ok: true`
- Sign up a normal user. They get $100,000 paper cash and the **PAPER** badge.
- Type in the prompt bar: `Buy $100 of SOL` → the approval card shows engine checks → Approve → filled (labeled *Simulated*).
- Type: `buy at 3% dip and sell at 5% increase, rinse and repeat` → asks for the amount → `$100` → **Activate bot** → `/bots/<id>` shows live activity-log entries every ~15 s.
- `/admin` → Compliance & flags: every real-money flag is **off**, paper trading is **on**.

## 5. Connecting providers

All providers are managed at **/admin/integrations**. Paste keys into the secure fields; they're encrypted with AES-256-GCM in Postgres and never returned to the browser. Then click **Test connection**. A provider becomes *connected* **only** when that real probe passes. Production trading additionally needs compliance approval plus the relevant feature flag. Users can also paste their **own** keys under Settings → API keys; those are used only for their own requests.

Env vars work too (set them on **both** Vercel and Railway). The vault takes precedence over env vars. See `docs/INTEGRATION_READINESS.md` for each provider's variables, links and requirements.

## 6. Security checklist

- [ ] `MEROD_MASTER_KEY` and `REALTIME_SECRET` are set, identical on all services, and backed up
- [ ] `MEROD_ALLOW_LIVE_FLAGS` is **not** set
- [ ] `MEROD_DEMO_DATA=false` in production
- [ ] Admin has 2FA enabled
- [ ] `npm run security:check` passes (CI runs it)
- [ ] Railway Postgres backups enabled (Postgres service → Backups)
- [ ] No `.env*` files in git (`.gitignore` covers `.env*`, keys and wallet keypair files)

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Orders rejected "Stale price" | The worker isn't running, or it can't reach the DB. Check worker `/healthz`. |
| `/api/health` 503 in production | `MEROD_MASTER_KEY` or `REALTIME_SECRET` missing, or the DB is unreachable (Vercel: use the public URL with `DATABASE_SSL=true`). |
| Realtime dot stays grey | `NEXT_PUBLIC_REALTIME_URL` is wrong, or the worker has no public domain. Pages fall back to polling. Redeploy Vercel after changing `NEXT_PUBLIC_*` vars, since they're baked into the build. |
| "Too many connections" | Lower `PG_POOL_MAX` on Vercel to 1–3. |
| Stored keys suddenly "missing" | `MEROD_MASTER_KEY` changed. Restore the original value. |
