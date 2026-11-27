import "@/lib/server-only-shim";
import { pool } from "../db";
import type { ProviderEnv } from "./types";

export class ProviderError extends Error {
  constructor(public providerId: string, public status: number, message: string) { super(`${providerId}: ${message}`); }
}

/** Instrumented fetch: timeout, latency + status recorded to provider_events (URL query stripped so keys never log). */
export async function providerFetch(providerId: string, env: ProviderEnv, url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 10_000);
  const safeUrl = url.split("?")[0].replace(/\/v2\/[A-Za-z0-9_-]{20,}/, "/v2/[key]").replace(/\/prices\/v1\/[A-Za-z0-9_-]{20,}/, "/prices/v1/[key]");
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    const latency = Date.now() - started;
    const kind = res.status === 429 ? "rate_limit" : res.ok ? "request" : "error";
    // Every error is logged; successful requests are sampled (1 in 20) — logging each one filled the database disk.
    if (kind === "request" && Math.random() > 0.05) return res;
    pool.query("INSERT INTO provider_events (provider_id, environment, kind, status_code, latency_ms, message) VALUES ($1,$2,$3,$4,$5,$6)",
      [providerId, env, kind, res.status, latency, `${init.method ?? "GET"} ${safeUrl}`]).catch(() => {});
    return res;
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "timeout" : (e?.cause?.code ?? e?.message ?? "network error");
    pool.query("INSERT INTO provider_events (provider_id, environment, kind, status_code, latency_ms, message) VALUES ($1,$2,'error',NULL,$3,$4)",
      [providerId, env, Date.now() - started, `${init.method ?? "GET"} ${safeUrl} — ${msg}`]).catch(() => {});
    throw new ProviderError(providerId, 0, `Network error reaching provider (${msg})`);
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(res: Response, providerId: string): Promise<any> {
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = typeof body === "object" && body ? (body.message ?? body.error ?? body.msg ?? JSON.stringify(body).slice(0, 200)) : String(body).slice(0, 200);
    throw new ProviderError(providerId, res.status, `HTTP ${res.status}: ${msg}`);
  }
  return body;
}
