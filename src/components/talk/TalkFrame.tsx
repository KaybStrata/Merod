"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, CandlestickChart, PieChart, Bot, Settings, Sparkles, Pause, Menu, X, ArrowUpRight, SlidersHorizontal, Map as MapIcon, PiggyBank, Cpu } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { Logo } from "@/components/shell/Logo";
import { ModeSwitch } from "./ModeSwitch";
import { TalkActivity } from "./TalkActivity";
import { MapLink } from "@/components/shell/MapLink";
import { AdvisorPanel } from "@/components/shell/AdvisorPanel";
import { FloatingPages, openFloat } from "./FloatingPages";
import { TalkTabs } from "./TalkTabs";
import { api, useApi } from "@/lib/api";
import { Button, Modal, cx, useToast } from "@/components/ui";

type Conv = { id: string; title: string | null; created_at: string; last_at: string | null };
const GROUPS = ["Today", "Yesterday", "This week", "Earlier"] as const;
function groupOf(t: string) {
  const d = new Date(t), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "This week" : "Earlier";
}

/** Talk mode frame: conversation rail + slim top bar. The page (thread + composer) renders inside. */
export function TalkFrame({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  useEffect(() => setDrawer(false), [pathname]);
  return (
    <div className="app-glow flex h-[100dvh] overflow-hidden">
      <FloatingPages />
      <aside className="hidden w-[272px] shrink-0 border-r border-line bg-bg-2 lg:block"><Suspense fallback={null}><Rail /></Suspense></aside>
      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setDrawer(false)}>
          <aside className="h-full w-[280px] border-r border-line bg-bg-2" onClick={(e) => e.stopPropagation()}><Suspense fallback={null}><Rail onNavigate={() => setDrawer(false)} /></Suspense></aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TalkTopBar onMenu={() => setDrawer(true)} />
        {!pathname.startsWith("/auton") && <Suspense fallback={null}><TalkTabs /></Suspense>}
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useShell();
  const router = useRouter();
  const sp = useSearchParams();
  const active = sp.get("c");
  const [q, setQ] = useState("");
  const { data, refresh } = useApi<{ conversations: Conv[] }>("/api/ai/conversations");
  const dash = useApi<any>("/api/dashboard", { refreshMs: 60_000 });
  useEffect(() => { const h = () => refresh(); window.addEventListener("merod-talk-refresh", h); return () => window.removeEventListener("merod-talk-refresh", h); }, [refresh]);
  const newConv = () => { router.push(`/talk?new=${Date.now()}`); onNavigate?.(); };
  // ⌘K / Ctrl+K: new conversation (Talk mode only).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newConv(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const list = (data?.conversations ?? []).filter((c) => !q || (c.title ?? "").toLowerCase().includes(q.toLowerCase()));
    const g: Record<string, Conv[]> = {};
    for (const c of list) (g[groupOf(c.last_at ?? c.created_at)] ??= []).push(c);
    return g;
  }, [data, q]);
  const total = Number(dash.data?.total ?? NaN);
  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <Link href="/talk" className="flex items-center"><Logo /></Link>
        <span className="flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.14em] text-accent-2"><Sparkles className="size-3" /> TALK</span>
      </div>
      <div className="px-3">
        <button onClick={newConv} className="flex h-10 w-full items-center justify-between rounded-xl border border-accent/40 bg-accent-soft/40 px-3 text-[13.5px] font-medium hover:border-accent/70">
          <span className="flex items-center gap-2"><Plus className="size-4" /> New conversation</span>
          <kbd className="rounded border border-line-2 px-1 text-[10px] text-faint">⌘K</kbd>
        </button>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" className="h-8 w-full rounded-lg bg-transparent pl-8 pr-2 text-[13px] outline-none placeholder:text-faint" />
        </div>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!data && <p className="px-2 py-4 text-[12px] text-faint">Loading…</p>}
        {data && !data.conversations.length && <p className="px-2 py-4 text-[12px] text-faint">No conversations yet. Just start talking.</p>}
        {GROUPS.filter((g) => groups[g]?.length).map((g) => (
          <div key={g} className="mb-3">
            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">{g}</div>
            {groups[g].map((c) => (
              <Link key={c.id} href={`/talk?c=${c.id}`} onClick={onNavigate}
                className={cx("block truncate rounded-lg px-2 py-1.5 text-[13.5px]", active === c.id ? "border border-accent/40 bg-accent-soft/50 text-text" : "text-muted hover:bg-panel-2 hover:text-text")}>
                {c.title || "Untitled"}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-line px-3 pb-3 pt-2.5">
        <AdvisorPanel className="mb-2.5" onOpenAll={() => openFloat("advisor")} />
        <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">Open in a floating window <ArrowUpRight className="size-3" /></div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {([["map", "Map", MapIcon], ["trade", "Trade", CandlestickChart], ["portfolio", "Portfolio", PieChart], ["bots", "Bots & agents", Bot], ["auton", "Auton", Cpu], ["edit", "Edit all", SlidersHorizontal], ["ewallets", "E-wallets", PiggyBank], ["settings", "Settings", Settings]] as const).map(([tab, label, I]) => (
            <button key={tab} onClick={() => openFloat(tab)} title={tab === "map" ? "Map: organize, connect and run bots, agents, prompts, skills and points (type map changes in its prompt bar)" : tab === "edit" ? "Change $ per trade, stop-loss, take-profit, capital or on/off for many bots and agents at once" : tab === "auton" ? "Auton: turn it on/off, set its budget, speed, $ per trade and goals, and edit or delete every bot and agent it made" : `${label} in a floating window over Talk`}
              className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-panel-2 hover:text-text", tab === "edit" || tab === "map" || tab === "auton" ? "text-accent-2" : "text-muted")}><I className="size-3.5" />{label}</button>
          ))}
        </div>
        <Link href="/settings?tab=interface" className="mt-2 flex items-center gap-2.5 rounded-xl border border-line bg-panel/60 p-2 hover:border-line-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-grad text-[12px] font-semibold text-bg">{user.displayName.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold">{user.displayName}</span>
            <span className="block truncate text-[11px] text-muted">{user.tradingMode === "live" ? "Live" : "Paper"}{Number.isFinite(total) ? ` · $${total >= 1000 ? `${(total / 1000).toFixed(total >= 100_000 ? 0 : 1)}k` : total.toFixed(0)} virtual` : ""}</span>
          </span>
        </Link>
      </div>
    </nav>
  );
}

function TalkTopBar({ onMenu }: { onMenu: () => void }) {
  const { user, title } = useShell();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = user.role === "super_admin";
  // Real-money state is shown here, never toggleable from Talk mode.
  const rm = useApi<any>(owner ? "/api/admin/real-money" : null, { refreshMs: 60_000 });
  const live = (rm.data?.flags ?? []).some((f: any) => (f.key === "live_crypto_trading" || f.key === "live_brokerage_trading") && f.enabled);
  async function pauseEverything() {
    setBusy(true);
    try {
      const r: any = await api("/api/bots/emergency", { method: "POST", json: { action: "stop" } });
      toast(`Everything paused${r?.cancelled != null ? ` · ${r.cancelled} open orders cancelled` : ""}. Resume from Settings › Security.`, "up");
      setConfirm(false);
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
      <button onClick={onMenu} className="rounded-lg p-1.5 text-muted hover:text-text lg:hidden" aria-label="Conversations"><Menu className="size-5" /></button>
      <div className="min-w-0 flex-1 truncate text-[15px]">
        <span className="font-medium">{title?.title ?? "New conversation"}</span>
        {title?.section && <span className="text-faint"> · {title.section}</span>}
      </div>
      <TalkActivity />
      <MapLink onOpen={() => openFloat("map")} />
      <ModeSwitch force />
      <span className={cx("rounded-md border px-2 py-1 text-[10px] font-bold tracking-wider", live || user.tradingMode === "live" ? "border-down/40 bg-down-soft text-down" : "border-warn/40 bg-warn-soft text-warn")}
        title="Shown only. Change real-money trading in Classic mode.">{live ? "REAL MONEY ON" : user.tradingMode === "live" ? "LIVE" : "PAPER"}</span>
      <button onClick={() => setConfirm(true)} className="flex h-8 items-center gap-1.5 rounded-lg border border-down/40 bg-down-soft px-3 text-[12.5px] font-semibold text-down hover:border-down/70">
        <Pause className="size-3.5" /><span className="hidden sm:inline">Pause everything</span>
      </button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Pause everything?">
        <div className="space-y-3 text-sm">
          <p className="text-muted">This halts all your bots, cancels open orders and engages your trading halt, the same emergency stop as Classic mode. You can resume from Settings › Security.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}><X className="size-4" /> Cancel</Button>
            <Button variant="danger" loading={busy} onClick={pauseEverything}><Pause className="size-4" /> Pause everything</Button>
          </div>
        </div>
      </Modal>
    </header>
  );
}
