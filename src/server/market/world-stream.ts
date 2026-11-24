import "@/lib/server-only-shim";
import { WebSocket } from "ws";
import { publish } from "../realtime";
import { contextFor, providerUsable } from "../providers/integrations";

/**
 * World Trades — live US stock trade prints, relayed to browsers on the public "world" channel.
 *
 * Source: Alpaca market-data stream (documented: wss://stream.data.alpaca.markets/v2/{iex|sip}),
 * subscribed to every symbol ("*"). Only runs when an admin has connected Alpaca in Integrations;
 * the API key never leaves the worker. Stock prints carry no buy/sell flag, so side is ESTIMATED
 * with the tick rule (uptick = buy, downtick = sell) and labeled as such in the UI.
 *
 * Crypto trades are not relayed here: browsers read public exchange feeds (Coinbase, Kraken,
 * Binance) directly, which need no credentials.
 */

export interface WorldTrade { sym: string; px: number; sz: number; usd: number; side: "buy" | "sell"; est: true; venue: string; t: number }
export interface StockStreamStatus { state: "off" | "connecting" | "live" | "error"; provider: string | null; feed: string | null; message?: string; tradesPerMin: number; at: number }

const status: StockStreamStatus = { state: "off", provider: null, feed: null, tradesPerMin: 0, at: Date.now() };
export const stockStreamStatus = () => ({ ...status });

let sock: WebSocket | null = null;
let buffer: WorldTrade[] = [];
const last = new Map<string, { px: number; side: "buy" | "sell" }>();
let counted = 0;
let started = false;

/** Highest-notional prints first, capped, so browsers get a readable firehose. */
function flush() {
  if (!buffer.length) return;
  const batch = buffer.sort((a, b) => b.usd - a.usd).slice(0, 80).sort((a, b) => a.t - b.t);
  buffer = [];
  void publish("world", "stock_trades", batch);
}

async function pickProvider() {
  for (const pid of ["alpaca_trading", "alpaca_broker"] as const) {
    for (const env of ["production", "sandbox"] as const) {
      if (await providerUsable(pid, env).catch(() => false)) return { pid, env };
    }
  }
  return null;
}

async function connect() {
  const p = await pickProvider();
  if (!p) { Object.assign(status, { state: "off", provider: null, feed: null, message: "Connect Alpaca in Admin → Integrations to stream US stock trades." }); return; }
  const ctx = contextFor(p.pid, p.env);
  const key = p.pid === "alpaca_trading" ? await ctx.cred("ALPACA_API_KEY") : await ctx.cred("ALPACA_BROKER_API_KEY");
  const secret = p.pid === "alpaca_trading" ? await ctx.cred("ALPACA_API_SECRET") : await ctx.cred("ALPACA_BROKER_API_SECRET");
  if (!key || !secret) { Object.assign(status, { state: "error", message: "Alpaca keys missing" }); return; }
  const feed = ((await ctx.setting("data_feed")) ?? "iex") === "sip" ? "sip" : "iex";
  const host = p.pid === "alpaca_broker" && p.env === "sandbox" ? "stream.data.sandbox.alpaca.markets" : "stream.data.alpaca.markets";
  Object.assign(status, { state: "connecting", provider: p.pid, feed, message: undefined });

  const ws = new WebSocket(`wss://${host}/v2/${feed}`);
  sock = ws;
  ws.on("message", (raw) => {
    let msgs: any[]; try { msgs = JSON.parse(String(raw)); } catch { return; }
    if (!Array.isArray(msgs)) return;
    for (const m of msgs) {
      if (m.T === "success" && m.msg === "connected") ws.send(JSON.stringify({ action: "auth", key, secret }));
      else if (m.T === "success" && m.msg === "authenticated") ws.send(JSON.stringify({ action: "subscribe", trades: ["*"] }));
      else if (m.T === "subscription") Object.assign(status, { state: "live", message: undefined });
      else if (m.T === "error") Object.assign(status, { state: "error", message: `Alpaca: ${String(m.msg ?? m.code).slice(0, 120)}` });
      else if (m.T === "t" && typeof m.p === "number" && typeof m.s === "number") {
        const prev = last.get(m.S);
        const side: "buy" | "sell" = !prev ? "buy" : m.p > prev.px ? "buy" : m.p < prev.px ? "sell" : prev.side;
        last.set(m.S, { px: m.p, side });
        counted++;
        buffer.push({ sym: String(m.S).slice(0, 12), px: m.p, sz: m.s, usd: m.p * m.s, side, est: true, venue: `${feed.toUpperCase()}${m.x ? `·${m.x}` : ""}`, t: Date.parse(m.t) || Date.now() });
        if (buffer.length > 5000) buffer = buffer.slice(-2000);
      }
    }
  });
  ws.on("error", (e) => Object.assign(status, { state: "error", message: e.message.slice(0, 120) }));
  ws.on("close", () => { if (sock === ws) sock = null; if (status.state !== "error") status.state = "off"; });
}

/** Start the relay loop (idempotent). Reconnects with a fixed back-off and re-checks the provider. */
export function startWorldStream(isStopping: () => boolean) {
  if (started) return;
  started = true;
  setInterval(flush, 700);
  setInterval(() => {
    status.tradesPerMin = counted * 6; counted = 0; status.at = Date.now();
    void publish("world", "stock_status", stockStreamStatus());
  }, 10_000);
  const loop = async () => {
    if (isStopping()) return;
    if (!sock) await connect().catch((e) => Object.assign(status, { state: "error", message: String(e?.message ?? e).slice(0, 120) }));
    setTimeout(loop, 30_000);
  };
  void loop();
}

export function stopWorldStream() { try { sock?.close(); } catch {} sock = null; }
