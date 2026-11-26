"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";

export interface ShellUser { id: string; handle: string; displayName: string; role: string; tradingMode: "paper" | "live"; totpEnabled: boolean }
export interface ScreenAsset { id: string; symbol: string; name?: string }
/** Top-bar title: small section crumb, title, and the word drawn in gold serif italic (must appear in the title). */
export type UiMode = "classic" | "talk";
export interface TalkState { enabled: boolean; uiModeDefault: "classic" | "talk" | "last"; uiLastMode: UiMode; talkPrefs: { showSwitch: boolean; digest: boolean; voice: boolean; widgets: string[] } }
export const TALK_FLAG = process.env.NEXT_PUBLIC_MEROD_TALK_MODE === "1";
/** The mode Merod should open in, from Settings › Interface (stored in localStorage["merod-mode"] for the no-flash script). */
export const startupMode = (t: TalkState | null): UiMode => (t && t.enabled && (t.uiModeDefault === "talk" || (t.uiModeDefault === "last" && t.uiLastMode === "talk")) ? "talk" : "classic");
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
  /** Classic | Talk (Talk = the /talk route; only when NEXT_PUBLIC_MEROD_TALK_MODE=1). */
  mode: UiMode;
  setMode: (m: UiMode) => void;
  talk: TalkState | null;
  refreshTalk: () => void;
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
  // Talk mode (secondary, flag-gated). The mode is derived from the route: /talk = Talk, everything else = Classic.
  const pathname = usePathname();
  const router = useRouter();
  const mode: UiMode = TALK_FLAG && pathname.startsWith("/talk") ? "talk" : "classic";
  const [talk, setTalk] = useState<TalkState | null>(null);
  const refreshTalk = useCallback(() => {
    if (!TALK_FLAG) return;
    api<TalkState>("/api/talk/mode").then((t) => { setTalk(t); try { localStorage.setItem("merod-mode", startupMode(t)); } catch {} }).catch(() => {});
  }, []);
  useEffect(() => { refreshTalk(); }, [refreshTalk]);
  const setMode = useCallback((m: UiMode) => {
    if (!TALK_FLAG || m === mode) return;
    try {
      if (m === "talk") localStorage.setItem("merod-last-classic", `${window.location.pathname}${window.location.search}`);
      if (talk?.uiModeDefault === "last") localStorage.setItem("merod-mode", m);
    } catch {}
    api("/api/talk/mode", { method: "POST", json: { mode: m } }).catch(() => {});
    setTalk((t) => (t ? { ...t, uiLastMode: m } : t));
    let back = "/";
    try { back = localStorage.getItem("merod-last-classic") || "/"; } catch {}
    router.push(m === "talk" ? "/talk" : back.startsWith("/talk") ? "/" : back);
  }, [mode, router, talk?.uiModeDefault]);
  // ⌘. / Ctrl+. toggles Classic ⇄ Talk (ignored while typing). Works even when the switch is hidden.
  useEffect(() => {
    if (!TALK_FLAG) return;
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== ".") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      setMode(mode === "talk" ? "classic" : "talk");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mode, setMode]);

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
    <ShellCtx.Provider value={{ user, screenAsset, setScreenAsset, subscribe, wsSubscribe, connected, openPrompt, promptRequest, title, setTitle, mode, setMode, talk, refreshTalk }}>
      {children}
    </ShellCtx.Provider>
  );
}

/** Pages call this to set the top-bar title, e.g. usePageTitle({ section: "Automate · Mimic", title: "Copy the best traders", accent: "best" }). */
export function usePageTitle(t: PageTitle | null, deps: unknown[] = []) {
  const { setTitle } = useShell();
  useEffect(() => { setTitle(t); return () => setTitle(null); }, [t?.title, t?.section, t?.accent, ...deps]); // eslint-disable-line
}
