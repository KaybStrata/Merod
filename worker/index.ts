/**
 * Merod persistent worker (deploy on Railway as its own service).
 * Runs independently of any browser: price feeds, paper order matching, bots, live order
 * reconciliation, alerts, portfolio snapshots, provider health and the realtime WebSocket gateway.
 * Safe to run multiple replicas: bots use Postgres leases and orders use idempotency keys.
 */
import { createServer } from "node:http";
import { hostname } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { Redis } from "ioredis";
import { Queue, Worker } from "bullmq";
import { pool, q, one } from "@/server/db";
import { tickSimulated, refreshLivePrices, discoverLaunches, syncBrokerCatalog } from "@/server/market/prices";
import { runAutoTrading, runModoAutopilot } from "@/server/auto/engine";
import { autoEnableSweep } from "@/server/providers/integrations";
import { runScheduledTasks } from "@/server/auto/workspace";
import { masterKeyInfo } from "@/server/crypto";
import { ensureRealData, backfillRealHistory, simulationOn, prune1mBars } from "@/server/market/real-data";
import { processPaperTriggers, reconcileLiveOrders, notify } from "@/server/engine/engine";
import { tickDueBots, backtest } from "@/server/bots/runner";
import { testIntegration } from "@/server/providers/integrations";
import { verifyRealtimeToken } from "@/server/realtime-token";
import { systemEvent } from "@/server/audit";
import { runTraining } from "@/server/training/trainer";
import { runLearning } from "@/server/learning/engine";
import { getFlags } from "@/server/flags";
import { startWorldStream, stopWorldStream, stockStreamStatus } from "@/server/market/world-stream";
import { processQueuedMaterials } from "@/server/learning/materials";
import { processCopyTrading } from "@/server/copy/service";
import { learn as modoLearn } from "@/server/modo/engine";
import { runAgents, snapshotAgents } from "@/server/agents/runner";

const WORKER_ID = `${hostname()}-${process.pid}`;
const PORT = Number(process.env.PORT ?? process.env.REALTIME_PORT ?? 4001);
const REDIS_URL = process.env.REDIS_URL;
let stopping = false;
const lastRun: Record<string, { at: number; ok: boolean; error?: string }> = {};

function every(name: string, ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const run = async () => {
    if (running || stopping) return;
    running = true;
    try { await fn(); lastRun[name] = { at: Date.now(), ok: true }; }
    catch (e: any) { lastRun[name] = { at: Date.now(), ok: false, error: e?.message }; console.error(`[${name}]`, String(e?.message ?? e).split("\n")[0].slice(0, 300)); }
    finally { running = false; }
  };
  setTimeout(run, 500 + Math.random() * 1000);
  return setInterval(run, ms);
}

async function checkAlerts() {
  const hits = await q<any>(
    `UPDATE price_alerts pa SET triggered_at=now() FROM assets a
      WHERE pa.asset_id=a.id AND pa.triggered_at IS NULL AND a.last_price IS NOT NULL
        AND ((pa.direction='above' AND a.last_price >= pa.price) OR (pa.direction='below' AND a.last_price <= pa.price))
      RETURNING pa.user_id, pa.direction, pa.price, a.symbol, a.id AS asset_id, a.last_price, a.price_source`);
  for (const h of hits) await notify(h.user_id, "alert", `${h.symbol} is ${h.direction} ${h.price}`, `Now ${Number(h.last_price).toPrecision(6)}${h.price_source === "simulated" ? " (simulated price)" : ""}`, `/terminal/${h.asset_id}`);
}

async function snapshotPortfolios() {
  await q(`WITH cash AS (
             SELECT user_id, (kind='paper') AS is_paper, SUM(cash_balance) AS cash FROM trading_accounts GROUP BY user_id, (kind='paper')
           ), holdings AS (
             SELECT p.user_id, (t.kind='paper') AS is_paper, SUM(p.quantity * COALESCE(a.last_price,0)) AS value
               FROM positions p JOIN assets a ON a.id=p.asset_id JOIN trading_accounts t ON t.id=p.account_id
              GROUP BY p.user_id, (t.kind='paper')
           )
           INSERT INTO portfolio_snapshots (user_id, is_paper, ts, total_value, cash, breakdown)
           SELECT c.user_id, c.is_paper, date_trunc('minute', now()), c.cash + COALESCE(h.value,0), c.cash, jsonb_build_object('holdings', COALESCE(h.value,0))
             FROM cash c LEFT JOIN holdings h ON h.user_id=c.user_id AND h.is_paper=c.is_paper
           ON CONFLICT DO NOTHING`);
}

async function healthChecks() {
  const rows = await q<any>("SELECT provider_id, environment FROM provider_configs WHERE enabled AND last_success_at IS NOT NULL");
  for (const r of rows) {
    const res = await testIntegration(null, r.provider_id, r.environment);
    if (!res.ok) await systemEvent("provider", "warn", `${r.provider_id} (${r.environment}) health check failed`, { message: res.message });
  }
}

/* ───────── Realtime WebSocket gateway ───────── */
const server = createServer(async (req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    let db = false;
    try { await pool.query("SELECT 1"); db = true; } catch {}
    const body = { ok: db, worker: WORKER_ID, db, redis: redisSub?.status ?? "disabled", loops: lastRun, worldStream: stockStreamStatus(), uptimeSec: Math.round(process.uptime()) };
    res.writeHead(db ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
const subs = new Map<WebSocket, { userId: string; role: string; channels: Set<string> }>();

wss.on("connection", (ws, req) => {
  const token = new URL(req.url ?? "", "http://x").searchParams.get("token") ?? "";
  // Never let a bad token (or missing REALTIME_SECRET) crash the worker — just refuse the socket.
  let claims: { u: string; r: string } | null = null;
  try { claims = verifyRealtimeToken(token); }
  catch (e: any) { console.error("[realtime] token check failed:", e?.message); ws.close(1011, "realtime not configured"); return; }
  if (!claims) { ws.close(4401, "unauthorized"); return; }
  const s = { userId: claims.u, role: claims.r, channels: new Set(["market", "launches", "social", "activity", "world", "chat", `user:${claims.u}`]) };
  if (claims.r === "admin") s.channels.add("admin");
  subs.set(ws, s);
  ws.on("message", async (raw) => {
    try {
      const m = JSON.parse(String(raw));
      if (m.type === "subscribe" && typeof m.channel === "string") {
        if (m.channel.startsWith("bot:")) {
          const own = await one("SELECT 1 FROM trading_bots WHERE id=$1 AND user_id=$2", [m.channel.slice(4), s.userId]).catch(() => null);
          if (own) s.channels.add(m.channel);
        }
      }
      if (m.type === "unsubscribe" && typeof m.channel === "string" && m.channel.startsWith("bot:")) s.channels.delete(m.channel);
    } catch { /* ignore malformed */ }
  });
  ws.on("close", () => subs.delete(ws));
  ws.send(JSON.stringify({ type: "hello", channels: [...s.channels] }));
});

let redisSub: Redis | null = null;
if (REDIS_URL) {
  redisSub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  redisSub.on("error", (e) => console.error("[redis]", e.message));
  redisSub.psubscribe("merod:*");
  redisSub.on("pmessage", (_p, _ch, msg) => {
    let parsed: any; try { parsed = JSON.parse(msg); } catch { return; }
    for (const [ws, s] of subs) if (s.channels.has(parsed.channel) && ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
} else console.warn("[worker] REDIS_URL not set — realtime fan-out disabled (UI falls back to polling)");

/* ───────── BullMQ: backtest jobs ───────── */
let bt: Worker | null = null;
if (REDIS_URL) {
  const connection = { url: REDIS_URL } as any;
  new Queue("backtests", { connection });
  bt = new Worker("backtests", async (job) => backtest(job.data.strategyId, job.data.assetId, job.data.params, job.data.opts), { connection, concurrency: 2 });
  bt.on("failed", (job, err) => console.error("[backtest] failed", job?.id, err.message));
}

/* ───────── Encryption key check (logs a fingerprint to compare with the web service) ───────── */
try { masterKeyInfo(); } catch (e: any) { console.error("[merod] encryption key:", e.message); }

/* ───────── Real market data only (unless simulated prices are explicitly turned on for testing) ───────── */
ensureRealData().then((r) => r && console.log(`✔ real data only: removed ${r.barsDeleted} simulated candles, cleared ${r.pricesCleared} simulated prices`))
  .catch((e) => console.error("[real-data]", e.message));

/* ───────── Loops ───────── */
const timers = [
  every("teach_merod", 8000, () => processQueuedMaterials(3)),
  every("copy_trading", 5000, () => processCopyTrading()),
  every("auto_trading", 20_000, () => runAutoTrading()),
  every("modo_autopilot", 30_000, () => runModoAutopilot()),
  every("auto_enable_integrations", 300_000, async () => { if ((await getFlags()).auto_enable_integrations) await autoEnableSweep(null); }),
  every("auto_tasks", 30_000, () => runScheduledTasks()),
  every("agents", 10_000, () => runAgents(WORKER_ID)),
  every("agent_snapshots", 300_000, () => snapshotAgents()),
  every("modo_learning", 600_000, () => modoLearn()),
  every("simulated_feed", 3000, async () => { const f = await getFlags(); if (f.paper_trading && f.simulated_prices) await tickSimulated(); }),
  every("prune_1m_bars", 3_600_000, () => prune1mBars()),
  every("retention", 900_000, async () => (await import("@/server/retention")).pruneOldData()),
  every("real_history", 90_000, async () => { if (!(await simulationOn())) await backfillRealHistory(3); }),
  every("paper_triggers", 3000, processPaperTriggers),
  every("bots", 5000, () => tickDueBots(WORKER_ID)),
  every("live_reconcile", 15000, reconcileLiveOrders),
  every("alerts", 5000, checkAlerts),
  every("live_prices", 30000, refreshLivePrices),
  every("launch_discovery", 60000, discoverLaunches),
  every("broker_catalog", 6 * 3600_000, syncBrokerCatalog),
  every("snapshots", 300000, snapshotPortfolios),
  every("auto_training", 60000, runTraining),
  every("ai_learning", 120000, runLearning),
  every("prompt_schedules", 30_000, async () => (await import("@/server/schedules")).runDueSchedules()),
  every("advisor", 30_000, async () => (await import("@/server/advisor")).runDueAdvisors()),
  every("trade_recording", 60_000, async () => (await import("@/server/trade-updates")).runDueRecordings()),
  every("scheduled_reviews", 60_000, async () => (await import("@/server/review/build")).runScheduledReviews()),
  every("provider_health", 600000, healthChecks),
  every("heartbeat", 15000, () => q(`INSERT INTO worker_heartbeats (worker_id, kind, last_seen_at, info) VALUES ($1,'worker',now(),$2)
                                     ON CONFLICT (worker_id) DO UPDATE SET last_seen_at=now(), info=$2`, [WORKER_ID, JSON.stringify({ loops: lastRun, ws: subs.size })])),
];

startWorldStream(() => stopping);
server.listen(PORT, () => console.log(`[worker] ${WORKER_ID} up — health http://0.0.0.0:${PORT}/healthz, websocket /ws`));
await systemEvent("worker", "info", `Worker ${WORKER_ID} started`).catch(() => {});

async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${sig} — draining`);
  timers.forEach(clearInterval);
  // release bot leases so another replica picks them up immediately
  await q("UPDATE trading_bots SET lease_owner=NULL, lease_expires_at=NULL WHERE lease_owner=$1", [WORKER_ID]).catch(() => {});
  await bt?.close().catch(() => {});
  stopWorldStream(); wss.close(); server.close();
  await redisSub?.quit().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
