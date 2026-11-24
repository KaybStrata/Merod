"use client";
import { useEffect, useRef, useState } from "react";

/** One executed trade anywhere in the world feed. `est` = side inferred (stocks), not reported by the venue. */
export interface WorldTrade { id: string; sym: string; cls: "crypto" | "stock"; venue: string; side: "buy" | "sell"; est?: boolean; px: number; sz: number; usd: number; t: number }
export type FeedState = "connecting" | "live" | "error" | "off";
export const CRYPTO_VENUES = ["Coinbase", "Kraken", "Binance"] as const;
type Venue = (typeof CRYPTO_VENUES)[number];

/**
 * Real, public crypto trade streams read directly in the browser (no keys, no Merod servers involved):
 *  - Coinbase Exchange  wss://ws-feed.exchange.coinbase.com   "matches" channel  (side = maker side → taker is opposite)
 *  - Kraken (v2)        wss://ws.kraken.com/v2                "trade" channel    (side = taker side)
 *  - Binance market data wss://data-stream.binance.vision     <sym>usdt@trade    (m = buyer is maker → taker sold)
 * Symbols a venue doesn't list are simply ignored by that venue.
 */
export function useCryptoTape(symbols: string[], onTrades: (batch: WorldTrade[]) => void, enabled = true) {
  const [state, setState] = useState<Record<Venue, FeedState>>({ Coinbase: "off", Kraken: "off", Binance: "off" });
  const cb = useRef(onTrades);
  cb.current = onTrades;
  const key = symbols.map((s) => s.toUpperCase()).sort().join(",");

  useEffect(() => {
    const syms = key ? key.split(",") : [];
    if (!enabled || !syms.length) { setState({ Coinbase: "off", Kraken: "off", Binance: "off" }); return; }
    let alive = true;
    let seq = 0;
    let buf: WorldTrade[] = [];
    const sockets: WebSocket[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const mark = (v: Venue, s: FeedState) => alive && setState((p) => (p[v] === s ? p : { ...p, [v]: s }));
    const push = (venue: Venue, sym: string, side: "buy" | "sell", px: number, sz: number, t: number) => {
      if (!(px > 0) || !(sz > 0)) return;
      buf.push({ id: `${venue[0]}${++seq}`, sym, cls: "crypto", venue, side, px, sz, usd: px * sz, t: t || Date.now() });
      if (buf.length > 4000) buf = buf.slice(-2000);
    };

    function open(venue: Venue, url: string, onOpen: (ws: WebSocket) => void, onMsg: (m: any) => void) {
      if (!alive) return;
      mark(venue, "connecting");
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { mark(venue, "error"); return; }
      sockets.push(ws);
      ws.onopen = () => onOpen(ws);
      ws.onmessage = (ev) => { let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; } onMsg(m); };
      ws.onerror = () => mark(venue, "error");
      ws.onclose = () => { if (!alive) return; mark(venue, "error"); timers.push(setTimeout(() => open(venue, url, onOpen, onMsg), 4000)); };
    }

    open("Coinbase", "wss://ws-feed.exchange.coinbase.com",
      // one subscribe per product so an unlisted symbol can't reject the others
      (ws) => syms.forEach((s) => ws.send(JSON.stringify({ type: "subscribe", product_ids: [`${s}-USD`], channels: ["matches"] }))),
      (m) => {
        if (m.type === "subscriptions") mark("Coinbase", "live");
        if (m.type !== "match") return;
        push("Coinbase", String(m.product_id).split("-")[0], m.side === "buy" ? "sell" : "buy", +m.price, +m.size, Date.parse(m.time));
      });

    open("Kraken", "wss://ws.kraken.com/v2",
      (ws) => syms.forEach((s) => ws.send(JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: [`${s}/USD`], snapshot: false } }))),
      (m) => {
        if (m.method === "subscribe" && m.success) mark("Kraken", "live");
        if (m.channel !== "trade" || m.type !== "update" || !Array.isArray(m.data)) return;
        for (const d of m.data) push("Kraken", String(d.symbol).split("/")[0].replace(/^XBT$/, "BTC"), d.side === "sell" ? "sell" : "buy", +d.price, +d.qty, Date.parse(d.timestamp));
      });

    open("Binance", `wss://data-stream.binance.vision/stream?streams=${syms.map((s) => `${s.toLowerCase()}usdt@trade`).join("/")}`,
      () => mark("Binance", "live"),
      (m) => {
        const d = m.data;
        if (!d || d.e !== "trade") return;
        push("Binance", String(d.s).replace(/USDT$/, ""), d.m ? "sell" : "buy", +d.p, +d.q, d.T);
      });

    const flush = setInterval(() => { if (buf.length) { const b = buf; buf = []; cb.current(b); } }, 350);
    return () => {
      alive = false;
      clearInterval(flush);
      timers.forEach(clearTimeout);
      sockets.forEach((s) => { s.onclose = null; try { s.close(); } catch {} });
    };
  }, [key, enabled]);

  return state;
}
