"use client";
import { RealMoneySwitch } from "./RealMoneySwitch";
import { AutoEnableSwitch, AutoTradingSwitch, AutoActivityFeed } from "./SidebarControls";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import {
  Home, BarChart3, ArrowLeftRight, Zap, Layers, Search, Bot, Sparkles, Library, LineChart, Settings, Shield, Bell, Menu, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen, Plug,
  Radio, Percent, KeyRound, PieChart, Users, Brain, Copy, Repeat, Cpu, Bitcoin, Newspaper, Crown, ChevronDown, ArrowUpRight, Compass, GitBranch, MessagesSquare, Swords, TrendingUp, Radar,
} from "lucide-react";
import { ShellProvider, useRealtime, useShell, type ShellUser } from "./context";
import { RightRail } from "./RightRail";
import { PromptBar } from "./PromptBar";
import { Logo } from "./Logo";
import { ToastProvider, useToast, cx, Modal, Button } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type NavItem = { href: string; label: string; icon: any; also?: string[] };
/** Primary navigation (Merod workspace concept). Each destination appears once. */
const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Markets", icon: BarChart3 },
  { href: "/trade", label: "Trade", icon: ArrowLeftRight, also: ["/terminal"] },
  { href: "/automations", label: "Automations", icon: Zap, also: ["/mimic", "/copy", "/auto", "/sessions"] },
  { href: "/strategies", label: "Strategies", icon: Layers },
  { href: "/research", label: "Research", icon: Search, also: ["/news"] },
  { href: "/bots", label: "Bots", icon: Bot, also: ["/shortcuts"] },
  { href: "/agents", label: "Agents", icon: Sparkles },
  { href: "/library", label: "Library", icon: Library },
  { href: "/analytics", label: "Analytics", icon: LineChart },
];
/** Secondary destinations, kept reachable in a compact group. */
const MORE: NavItem[] = [
  { href: "/activity", label: "Live & World Activity", icon: Radio, also: ["/world"] },
  { href: "/learning", label: "AI Learning", icon: Brain, also: ["/training"] },
  { href: "/social", label: "Social", icon: Users, also: ["/chat"] },
  { href: "/portfolio", label: "Portfolio & Wallet", icon: PieChart, also: ["/wallet"] },
  { href: "/broker-keys", label: "Broker & AI Keys", icon: KeyRound, also: ["/ai-keys"] },
  { href: "/alerts", label: "Alerts", icon: Bell },
];

export function Shell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellProvider user={user}>
        <Frame>{children}</Frame>
      </ShellProvider>
    </ToastProvider>
  );
}

const isActive = (pathname: string, n: NavItem) =>
  n.href === "/" ? pathname === "/" : pathname === n.href || (pathname.startsWith(n.href + "/") && !(n.href === "/admin" && (pathname.startsWith("/admin/integrations") || pathname.startsWith("/admin/fees"))))
    || !!n.also?.some((x) => pathname === x || pathname.startsWith(x + "/"));

function Frame({ children }: { children: React.ReactNode }) {
  const { user, connected } = useShell();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const toast = useToast();
  const me = useApi<any>("/api/auth/me", { refreshMs: 30000 });
  const [railOpen, setRailOpen] = useState(true);
  useEffect(() => { try { setCollapsed(localStorage.getItem("merod-nav") === "1"); setRailOpen(localStorage.getItem("merod-rail") !== "0"); setMoreOpen(localStorage.getItem("merod-more") === "1"); } catch {} }, []);
  const toggleRail = () => setRailOpen((o) => { try { localStorage.setItem("merod-rail", o ? "0" : "1"); } catch {} return !o; });
  useEffect(() => setMobileOpen(false), [pathname]);
  useRealtime((e) => {
    if (e.type === "fill") toast(`${e.payload.paper ? "[Paper] " : ""}${e.payload.side === "buy" ? "Bought" : "Sold"} ${Number(e.payload.quantity).toPrecision(4)} ${e.payload.symbol}`, e.payload.side === "buy" ? "up" : "neutral");
    if (e.type === "notification") me.refresh();
  });
  const toggle = () => { setCollapsed((c) => { try { localStorage.setItem("merod-nav", c ? "0" : "1"); } catch {} return !c; }); };
  // Keyboard: "[" hides/shows the left menu, "]" the right panel (ignored while typing).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))) return;
      if (e.key === "[") toggle();
      if (e.key === "]") toggleRail();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const owner = user.role === "super_admin";
  const more = [...MORE, ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Shield }] : [])];
  const moreActive = more.some((n) => isActive(pathname, n));
  const [pro, setPro] = useState(false);

  const link = (n: NavItem) => {
    const active = isActive(pathname, n);
    return (
      <Fragment key={n.href}>
        <Link href={n.href} className={cx("flex shrink-0 items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[15px] font-medium transition-colors", active ? "nav-active" : "text-muted hover:bg-panel-2 hover:text-text")}>
          <n.icon className={cx("size-[19px] shrink-0", active ? "text-text" : "")} strokeWidth={1.6} />
          <span className="leading-tight">{n.label}</span>
        </Link>
        {n.href === "/discover" && pathname.startsWith("/discover") && <Suspense fallback={null}><DiscoverSubLinks /></Suspense>}
        {n.href === "/automations" && isActive(pathname, n) && <SubLinks pathname={pathname} items={owner
          ? [{ href: "/mimic", label: "Mimic trading", icon: Repeat }, { href: "/copy", label: "Copy trading", icon: Copy }, { href: "/auto", label: "Auto trading", icon: Cpu, extra: <AutoTradingSwitch />, below: <AutoActivityFeed /> }, { href: "/sessions", label: "Sessions", icon: Layers }]
          : [{ href: "/sessions", label: "Sessions", icon: Layers }]} />}
        {n.href === "/agents" && isActive(pathname, n) && <SubLinks pathname={pathname} exact items={[
          { href: "/agents", label: "Command Center", icon: Radar }, { href: "/agents/workspace", label: "Workspace", icon: Compass }, { href: "/agents/fleets", label: "Fleet Builder", icon: GitBranch },
          { href: "/agents/rooms", label: "Rooms", icon: MessagesSquare }, { href: "/agents/arena", label: "Arena", icon: Swords }, { href: "/agents/training", label: "Auto-Training", icon: Brain },
          { href: "/agents/capital", label: "Capital & Risk", icon: Shield }, { href: "/agents/marketplace", label: "Marketplace", icon: TrendingUp }]} />}
        {n.href === "/admin" && <AdminSubLinks pathname={pathname} superAdmin={owner} />}
      </Fragment>
    );
  };

  const sidebar = (
    <nav className="relative flex h-full flex-col">
      <div className="relative z-10 flex shrink-0 items-center justify-between px-5 pb-4 pt-5">
        <Link href="/" aria-label="Merod home"><Logo /></Link>
        <button onClick={toggle} className="hidden rounded-lg p-1.5 text-faint hover:bg-panel-2 hover:text-text lg:block" title="Hide menu  ( [ )" aria-label="Hide menu"><PanelLeftClose className="size-4" /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
        {NAV.map(link)}
        <button onClick={() => setMoreOpen((o) => { try { localStorage.setItem("merod-more", o ? "0" : "1"); } catch {} return !o; })}
          className={cx("mt-1 flex items-center justify-between rounded-xl px-3.5 py-2 text-[13px] font-medium", moreActive ? "text-text" : "text-faint hover:text-text")}>
          <span>More</span><ChevronDown className={cx("size-4 transition-transform", (moreOpen || moreActive) && "rotate-180")} />
        </button>
        {(moreOpen || moreActive) && more.map(link)}
        {link({ href: "/settings", label: "Settings", icon: Settings })}
        <div className="mt-auto pt-4">
          <div className="relative overflow-hidden rounded-2xl border border-line bg-panel p-4">
            <svg aria-hidden viewBox="0 0 200 60" className="pointer-events-none absolute -right-6 -top-2 h-16 w-56 opacity-70" fill="none">
              {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M0 ${50 - i * 3} C 60 ${10 + i * 4}, 120 ${60 - i * 2}, 200 ${12 + i * 3}`} stroke="#d6b37a" strokeOpacity={0.18 + i * 0.07} strokeWidth={i === 3 ? 1.2 : 0.6} />)}
            </svg>
            <Crown className="relative size-5 text-accent-2" />
            <div className="relative mt-2 text-[1.2rem] font-semibold">Merod Pro</div>
            <p className="relative mt-1 text-xs leading-relaxed text-muted">Unlock advanced agents, higher capital limits, and institutional-grade tools.</p>
            <button onClick={() => setPro(true)} className="relative mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-grad text-sm font-semibold">Upgrade <ArrowUpRight className="size-4" /></button>
          </div>
          <div className="mt-2 rounded-xl border border-warn/20 bg-warn-soft px-3 py-2 text-[11px] text-warn">Paper trading mode · virtual funds</div>
        </div>
      </div>
      <Modal open={pro} onClose={() => setPro(false)} title="Merod Pro">
        <div className="space-y-3 text-sm">
          <p className="text-muted">Paid plans aren&apos;t available yet: pricing, parallel-execution tiers, AI credits and premium data are still being finalised and need compliance review before launch.</p>
          <p className="text-muted">Every agent feature is open to you now in paper mode, within the standard quotas (50 active agents).</p>
          <div className="flex justify-end"><Button variant="primary" onClick={() => setPro(false)}>Got it</Button></div>
        </div>
      </Modal>
    </nav>
  );

  return (
    <div className="app-glow min-h-screen">
      <aside aria-hidden={collapsed} className={cx("fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-bg-2 transition-transform duration-300 lg:block", collapsed && "-translate-x-full")}>
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-72 border-r border-line bg-bg-2" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      {collapsed && (
        <button onClick={toggle} title="Show menu  ( [ )" aria-label="Show menu"
          className="fade-up fixed left-0 top-1/2 z-30 hidden -translate-y-1/2 rounded-r-xl border border-l-0 border-line bg-bg-2 px-1 py-4 text-muted shadow-lg hover:text-accent-2 lg:block">
          <PanelLeftOpen className="size-4" />
        </button>
      )}
      <RightRail open={railOpen} onToggle={toggleRail} />
      <div className={cx("transition-[padding]", collapsed ? "lg:pl-0" : "lg:pl-64", railOpen ? "xl:pr-80" : "xl:pr-0")}>
        <TopBar onMenu={() => setMobileOpen(true)} unread={me.data?.unread ?? 0} connected={connected} onModo={() => { try { localStorage.setItem("merod-rail-tab", "modo"); } catch {} if (!railOpen) toggleRail(); window.dispatchEvent(new Event("merod-rail-tab")); }} />
        <main className="mx-auto max-w-[1600px] px-4 pb-32 pt-5 sm:px-7">{children}</main>
      </div>
      <PromptBar leftCollapsed={collapsed} railOpen={railOpen} />
    </div>
  );
}

function TopBar({ onMenu, unread, connected, onModo }: { onMenu: () => void; unread: number; connected: boolean; onModo: () => void }) {
  const { user } = useShell();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [agentHits, setAgentHits] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setTheme((document.documentElement.dataset.theme as any) === "light" ? "light" : "dark"); }, []);
  // ⌘K / Ctrl+K focuses search
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); setOpen(true); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); setAgentHits([]); return; }
    const t = setTimeout(() => {
      api(`/api/assets?q=${encodeURIComponent(q)}&limit=6`).then((r: any) => setResults(r.assets)).catch(() => {});
      api("/api/agents").then((r: any) => setAgentHits((r.agents ?? []).filter((a: any) => `${a.name} ${a.roleName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 4))).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [q]);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t; setTheme(t);
    try { localStorage.setItem("merod-theme", t); } catch {}
  };
  const ask = () => { if (!q.trim()) return; window.dispatchEvent(new CustomEvent("merod-prompt", { detail: q })); setQ(""); setOpen(false); };
  return (
    <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 bg-bg/80 px-4 backdrop-blur sm:px-7">
      <button onClick={onMenu} className="rounded-lg p-2 text-muted hover:text-text lg:hidden" aria-label="Menu"><Menu className="size-5" /></button>
      <div className="relative w-full max-w-4xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === "Enter" && !results.length && !agentHits.length) ask(); }}
          placeholder="Search markets, agents, strategies, or ask Merod…" className="h-12 w-full rounded-2xl border border-line-2 bg-panel/70 pl-11 pr-16 text-[14px] outline-none placeholder:text-muted focus:border-accent/60" />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line-2 px-1.5 py-0.5 text-[11px] text-muted sm:block">⌘ K</kbd>
        {open && (results.length > 0 || agentHits.length > 0 || q.trim()) && (
          <div className="absolute left-0 right-0 top-14 z-30 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
            {agentHits.map((a) => (
              <button key={a.id} onMouseDown={() => { router.push(`/agents/${a.id}`); setQ(""); }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-panel-2">
                <span className="min-w-0"><Sparkles className="mr-1.5 inline size-3.5 text-accent-2" /><span className="font-semibold">{a.name}</span> <span className="text-sm text-muted">{a.roleName}</span></span>
                <span className="shrink-0 text-xs text-faint">Agent</span>
              </button>
            ))}
            {results.map((a) => (
              <button key={a.id} onMouseDown={() => { router.push(`/research/${a.id}`); setQ(""); }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-panel-2">
                <span className="min-w-0"><span className="font-semibold">{a.symbol}</span> <span className="truncate text-sm text-muted">{a.name}</span></span>
                <span className="shrink-0 text-xs text-faint">{a.venue}{a.risk_flags?.includes("demo_data") ? " · DEMO" : ""}</span>
              </button>
            ))}
            {q.trim() && <button onMouseDown={ask} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm text-muted hover:bg-panel-2 hover:text-text"><Sparkles className="size-4 text-accent-2" /> Ask Merod: “{q.slice(0, 60)}”</button>}
          </div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="hidden items-center gap-2 md:flex"><RealMoneySwitch owner={user.role === "super_admin"} /></div>
        <span title={connected ? "Realtime connected" : "Realtime offline — polling"} className={cx("hidden size-2 rounded-full sm:block", connected ? "bg-up pulse-dot" : "bg-faint")} />
        <Link href="/alerts" className="relative rounded-xl p-2.5 text-muted hover:text-text" aria-label="Notifications">
          <Bell className="size-5" strokeWidth={1.6} />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <button onClick={onModo} className="rounded-xl p-2.5 text-muted hover:text-text" aria-label="Open Modo" title="Modo"><Sparkles className="size-5" strokeWidth={1.6} /></button>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} className="flex items-center gap-1.5 rounded-full p-0.5 pr-1 text-muted hover:text-text">
            <span className="flex size-10 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-[15px] font-semibold text-text">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <ChevronDown className="size-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-12 z-30 w-52 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onMouseLeave={() => setMenu(false)}>
              <div className="border-b border-line px-4 py-2.5 text-xs text-muted">Signed in as <span className="font-semibold text-text">@{user.handle}</span></div>
              <Link href={`/social/${user.handle}`} className="block px-4 py-2.5 text-sm hover:bg-panel-2">My profile</Link>
              <Link href="/settings" className="block px-4 py-2.5 text-sm hover:bg-panel-2">Settings</Link>
              <button onClick={flip} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-panel-2">{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}{theme === "dark" ? "Light theme" : "Dark theme"}</button>
              {!user.totpEnabled && <Link href="/settings?tab=security" className="block px-4 py-2.5 text-sm text-warn hover:bg-panel-2">Enable 2FA</Link>}
              <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}
                className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-down hover:bg-panel-2"><LogOut className="size-4" /> Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


/** Stocks / Crypto shortcuts under Discover in the menu (open Discover pre-filtered). */
function DiscoverSubLinks() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const cls = pathname === "/discover" ? (sp.get("tab") === "articles" ? "articles" : sp.get("class")) : null;
  const items = [
    { cls: "stocks", label: "Stocks", icon: LineChart },
    { cls: "crypto", label: "Crypto", icon: Bitcoin },
    { cls: "articles", label: "Articles", icon: Newspaper },
  ];
  return (
    <div className="mb-1 ml-6 flex flex-col gap-0.5 border-l border-line pl-2">
      {items.map((i) => (
        <Link key={i.cls} href={i.cls === "articles" ? "/discover?tab=articles" : `/discover?class=${i.cls}`}
          className={cx("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
            cls === i.cls ? "bg-accent-soft text-text" : "text-muted hover:bg-panel-2 hover:text-text")}>
          <i.icon className={cx("size-3.5", cls === i.cls && "text-accent-2")} />{i.label}
        </Link>
      ))}
    </div>
  );
}


/** Integrations and Fees under Admin in the menu. */
function AdminSubLinks({ pathname, superAdmin }: { pathname: string; superAdmin: boolean }) {
  return <SubLinks pathname={pathname} items={[
    { href: "/admin/integrations", label: "Integrations", icon: Plug, extra: <AutoEnableSwitch /> },
    ...(superAdmin ? [{ href: "/admin/fees", label: "Fees", icon: Percent }] : []),
  ]} />;
}

/** Indented sub-links under a menu section. */
function SubLinks({ pathname, items, exact }: { pathname: string; exact?: boolean; items: { href: string; label: string; icon: any; extra?: React.ReactNode; below?: React.ReactNode }[] }) {
  const sub = items.slice(1).some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  return (
    <div className="mb-1 ml-7 flex flex-col gap-0.5 border-l border-line pl-2">
      {items.map((i, idx) => {
        const on = pathname === i.href || (pathname.startsWith(i.href + "/") && !(exact && idx === 0 && sub));
        return (
          <Fragment key={i.href}>
            <div className={cx("flex items-center rounded-lg transition-colors", on ? "bg-accent-soft text-text" : "text-muted hover:bg-panel-2 hover:text-text")}>
              <Link href={i.href} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-xs font-medium">
                <i.icon className={cx("size-3.5 shrink-0", on && "text-accent-2")} /><span className="truncate">{i.label}</span>
              </Link>
              {i.extra && <span className="pr-2">{i.extra}</span>}
            </div>
            {i.below}
          </Fragment>
        );
      })}
    </div>
  );
}
