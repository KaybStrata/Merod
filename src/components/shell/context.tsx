"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

export interface ShellUser { id: string; handle: string; displayName: string; role: string; tradingMode: "paper" | "live"; totpEnabled: boolean }
export interface ScreenAsset { id: string; symbol: string; name?: string }
/** Top-bar title: small section crumb, title, and the word drawn in gold serif italic (must appear in the title). */
export interface PageTitle { section?: string; title: string; accent?: string; extra?: ReactNode }

type Listener = (evt: { channel: string; type: string; payload: any }) => void;
interface Ctx {
  user: ShellUser;
  screenAsset: ScreenAsset | null;
  setScreenAsset: (a: ScreenAsset | null) => void;
  subscribe: (fn: Listener) => () => void;
  wsSubscribe: (channel: string) => void;
  connected: boolean;
  openPrompt: (text?: string) => void;
  promptRequest: { text: string; n: number } | null;
  title: PageTitle | null;
  setTitle: (t: PageTitle | null) => void;
}
const ShellCtx = createContext<Ctx | null>(null);
export const useShell = () => {
  const c = useContext(ShellCtx);
  if (!c) throw new Error("useShell outside Shell");
  return c;
};

/** Subscribe to realtime events; handler re-bound each render safely. */
export function useRealtime(handler: Listener, channel?: string) {
  const { subscribe, wsSubscribe } = useShell();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => { if (channel) wsSubscribe(channel); return subscribe((e) => ref.current(e)); }, [subscribe, wsSubscribe, channel]);
}

/** Pages call this to tell the prompt bar which asset is on screen. */
export function useScreenAssetSetter(a: ScreenAsset | null) {
  const { setScreenAsset } = useShell();
  useEffect(() => { setScreenAsset(a); return () => setScreenAsset(null); }, [a?.id]); // eslint-disable-line
}

export function ShellProvider({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [screenAsset, setScreenAsset] = useState<ScreenAsset | null>(null);
  const [connected, setConnected] = useState(false);
  const [promptRequest, setPromptRequest] = useState<{ text: string; n: number } | null>(null);
  const [title, setTitle] = useState<PageTitle | null>(null);
  const listeners = useRef(new Set<Listener>());
  const ws = useRef<WebSocket | null>(null);
  const pending = useRef(new Set<string>());

  const subscribe = useCallback((fn: Listener) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; }, []);
  const wsSubscribe = useCallback((channel: string) => {
    pending.current.add(channel);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "subscribe", channel }));
  }, []);
  const openPrompt = useCallback((text = "") => setPromptRequest({ text, n: Date.now() }), []);

  useEffect(() => {
    let stop = false, retry = 1000, timer: any;
    async function connect() {
      try {
        const { token, url } = await api<{ token: string; url: string | null }>("/api/realtime/token");
        if (!url || stop) return; // realtime not configured → pages poll
        const sock = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
        ws.current = sock;
        sock.onopen = () => { setConnected(true); retry = 1000; for (const c of pending.current) sock.send(JSON.stringify({ type: "subscribe", channel: c })); };
        sock.onmessage = (m) => { try { const e = JSON.parse(m.data); if (e.channel) for (const l of listeners.current) l(e); } catch {} };
        sock.onclose = () => { setConnected(false); if (!stop) { timer = setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); } };
      } catch { if (!stop) timer = setTimeout(connect, retry *= 2); }
    }
    connect();
    return () => { stop = true; clearTimeout(timer); ws.current?.close(); };
  }, []);

  return (
    <ShellCtx.Provider value={{ user, screenAsset, setScreenAsset, subscribe, wsSubscribe, connected, openPrompt, promptRequest, title, setTitle }}>
      {children}
    </ShellCtx.Provider>
  );
}

/** Pages call this to set the top-bar title, e.g. usePageTitle({ section: "Automate · Mimic", title: "Copy the best traders", accent: "best" }). */
export function usePageTitle(t: PageTitle | null, deps: unknown[] = []) {
  const { setTitle } = useShell();
  useEffect(() => { setTitle(t); return () => setTitle(null); }, [t?.title, t?.section, t?.accent, ...deps]); // eslint-disable-line
}
