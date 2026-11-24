"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error { constructor(public status: number, message: string, public body?: any) { super(message); } }

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text.slice(0, 200) }; }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && body?.code !== "mfa_required" && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/signup")) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body);
  }
  return body as T;
}

/** Minimal data hook with refresh + optional polling (realtime events also trigger refresh). */
export function useApi<T = any>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;
  const load = useCallback(async () => {
    if (!pathRef.current) return;
    try { const d = await api<T>(pathRef.current); setData(d); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { setLoading(!!path); load(); }, [path, load]);
  useEffect(() => {
    if (!opts.refreshMs) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, load]);
  return { data, error, loading, refresh: load, setData };
}
