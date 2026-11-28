"use client";
import { RealMoneySwitch } from "./RealMoneySwitch";
import { AutoEnableSwitch, AutoTradingSwitch, AutoActivityFeed } from "./SidebarControls";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { ClipboardCheck,
  Home, Wallet, Activity, BarChart3, ArrowLeftRight, Zap, Layers, Search, Bot, Sparkles, Library, LineChart, Settings, Shield, Bell, Menu, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen, Plug,
  Radio, Percent, KeyRound, Plus, PieChart, Users, Brain, Copy, Repeat, Cpu, Bitcoin, Newspaper, Crown, ChevronDown, ArrowUpRight, Compass, GitBranch, MessagesSquare, Swords, TrendingUp, Radar,
  Webhook, Lightbulb, PiggyBank,
} from "lucide-react";
import { ShellProvider, useRealtime, useShell, type ShellUser } from "./context";
import { RightRail } from "./RightRail";
import { PromptBar } from "./PromptBar";
import { MobileNav } from "./MobileNav";
import { ModeSwitch } from "@/components/talk/ModeSwitch";
import { MapLink } from "./MapLink";
import { AdvisorPanel } from "./AdvisorPanel";
import { TalkFrame } from "@/components/talk/TalkFrame";
import { Logo } from "./Logo";
import { ToastProvider, useToast, cx, Modal, Button } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type NavItem = { href: string; label: string; icon: any; also?: string[] };
/** Navigation, grouped exactly like the Merod design: Trade · Automate · Insight · Account. Each destination appears once. */
const GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: "Trade", items: [
    { href: "/", label: "Home", icon: Home },
    { href: "/ai", label: "Ask Merod", icon: MessagesSquare },
    { href: "/discover", label: "Markets", icon: BarChart3 },
    { href: "/trade", label: "Trade", icon: ArrowLeftRight, also: ["/terminal"] },
    { href: "/wallet", label: "Wallet & Funds", icon: Wallet },
    { href: "/e-wallets", label: "E-wallets", icon: PiggyBank },
    { href: "/radar", label: "Meme Radar", icon: Radar },
  ] },
  { label: "Automate", items: [
    { href: "/bots", label: "Bots & Agents", icon: Bot, also: ["/agents"] },
    { href: "/strategies", label: "Strategies", icon: Layers, also: ["/library"] },
    { href: "/auto", label: "Auto trading", icon: Cpu, also: ["/automations", "/sessions", "/modo"] },
    { href: "/mimic", label: "Mimic", icon: Repeat, also: ["/copy", "/signals"] },
    { href: "/shortcuts", label: "Shortcuts", icon: Zap },
  ] },
  { label: "Insight", items: [
    { href: "/live", label: "Activity", icon: Activity, also: ["/activity", "/world"] },
    { href: "/review", label: "Review", icon: ClipboardCheck },
    { href: "/advisor", label: "Advisor", icon: Lightbulb },
    { href: "/analytics", label: "Analytics", icon: LineChart, also: ["/portfolio", "/progress"] },
    { href: "/research", label: "Research", icon: Search, also: ["/news"] },
    { href: "/learning", label: "AI Learning", icon: Brain, also: ["/training"] },
    { href: "/social", label: "Social", icon: Users, also: ["/chat"] },
  ] },
  { label: "Account", items: [
    { href: "/alerts", label: "Alerts", icon: Bell },
    { href: "/broker-keys", label: "Broker & AI keys", icon: KeyRound, also: ["/ai-keys"] },
    { href: "/settings", label: "Settings", icon: Settings },
  ] },
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
  const { user, connected, mode } = useShell();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toast = useToast();
  const me = useApi<any>("/api/auth/me", { refreshMs: 30000 });
  const [railOpen, setRailOpen] = useState(false);
  // Embedded (shown inside another Merod window): ?embed=1 on first load, or any page opened inside the frame afterwards.
  const embedParam = useSearchParams()?.get("embed") === "1";
  const [framed, setFramed] = useState(false);
  useEffect(() => { try { setFramed(window.self !== window.top); } catch { setFramed(true); } }, []);
  const embedded = embedParam || framed;
  useEffect(() => { try { setCollapsed(localStorage.getItem("merod-nav") === "1"); setRailOpen(localStorage.getItem("merod-rail2") === "1"); } catch {} }, []);
  const toggleRail = () => setRailOpen((o) => { try { localStorage.setItem("merod-rail2", o ? "0" : "1"); } catch {} return !o; });
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
  const groups = isAdmin ? GROUPS.map((g) => g.label === "Account" ? { ...g, items: [...g.items, { href: "/admin", label: "Admin", icon: Shield }] } : g) : GROUPS;
  const portfolio = useApi<any>("/api/portfolio", { refreshMs: 60_000 });
  const sum = portfolio.data?.[user.tradingMode === "live" ? "live" : "paper"];
  const equity = Number(sum?.total ?? sum?.equity ?? sum?.totalValue ?? NaN);

  const link = (n: NavItem) => {
    const active = isActive(pathname, n);
    return (
      <Fragment key={n.href}>
        <Link href={n.href} className={cx("group flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors", active ? "nav-active" : "text-muted hover:bg-panel-2 hover:text-text")}>
          <n.icon className={cx("size-[15px] shrink-0", active ? "text-accent-2" : "text-faint group-hover:text-muted")} strokeWidth={1.7} />
          <span className="leading-tight">{n.label}</span>
          {active && <span className="ml-auto size-1.5 rounded-full bg-accent-2" />}
        </Link>
        {n.href === "/discover" && pathname.startsWith("/discover") && <Suspense fallback={null}><DiscoverSubLinks /></Suspense>}
        {n.href === "/auto" && owner && isActive(pathname, n) && <SubLinks pathname={pathname} exact items={[{ href: "/auto", label: "Auto trading", icon: Cpu, extra: <AutoTradingSwitch />, below: <AutoActivityFeed /> }, { href: "/auto/activity", label: "Auto trade activity", icon: Activity }, { href: "/modo/activity", label: "Modo activity", icon: Sparkles }, { href: "/sessions", label: "Sessions", icon: Layers }]} />}
        {n.href === "/mimic" && owner && isActive(pathname, n) && <SubLinks pathname={pathname} items={[{ href: "/mimic", label: "Mimic trading", icon: Repeat }, { href: "/copy", label: "Copy trading", icon: Copy }, { href: "/signals", label: "Signal bots", icon: Webhook }]} />}
        {n.href === "/live" && isActive(pathname, n) && <SubLinks pathname={pathname} items={[{ href: "/live", label: "Live stream", icon: Activity }, { href: "/activity", label: "World activity", icon: Radio }]} />}
        {n.href === "/bots" && isActive(pathname, n) && <SubLinks pathname={pathname} exact items={[
          { href: "/bots", label: "All bots & agents", icon: Bot }, { href: "/agents", label: "Command Center", icon: Radar }, { href: "/agents/workspace", label: "Workspace", icon: Compass }, { href: "/agents/fleets", label: "Fleet Builder", icon: GitBranch },
          { href: "/agents/rooms", label: "Rooms", icon: MessagesSquare }, { href: "/agents/arena", label: "Arena", icon: Swords }, { href: "/agents/training", label: "Auto-Training", icon: Brain },
          { href: "/agents/capital", label: "Capital & Risk", icon: Shield }, { href: "/agents/marketplace", label: "Marketplace", icon: TrendingUp }]} />}
        {n.href === "/admin" && <AdminSubLinks pathname={pathname} superAdmin={owner} />}
      </Fragment>
    );
  };

  const sidebar = (
    <nav className="relative flex h-full flex-col">
      <div className="relative z-10 flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
        <Link href="/" aria-label="Merod home" className="flex items-center gap-2"><Logo /><span className="rounded-md border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-warn">{user.tradingMode === "live" ? "LIVE" : "PAPER"}</span></Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-3">
        {groups.map((g) => (
          <div key={g.label ?? "main"} className="mb-2">
            {g.label && <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{g.label}</div>}
            <div className="flex flex-col gap-px">{g.items.map(link)}</div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-line p-2.5">
        <AdvisorPanel className="mb-2" />
        <Link href="/settings" className="flex items-center gap-2.5 rounded-lg p-1.5 hover:bg-panel-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-grad text-[13px] font-semibold text-bg">{user.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold">{user.displayName}</span>
            <span className="block truncate text-[11px] text-muted">{user.tradingMode === "live" ? "Live" : "Paper"}{Number.isFinite(equity) ? ` · $${equity >= 1000 ? `${(equity / 1000).toFixed(equity >= 100_000 ? 0 : 1)}k` : equity.toFixed(0)}` : ""}</span>
          </span>
        </Link>
        <div className="mt-1.5 flex items-center justify-between rounded-lg px-1.5 py-1 text-[12px] text-muted">
          <span>Real money</span>
          <span className="flex items-center gap-1.5"><RealMoneySwitch owner={owner} bare /><button onClick={toggle} className="hidden rounded p-1 text-faint hover:bg-panel-2 hover:text-text lg:block" title="Hide menu  ( [ )" aria-label="Hide menu"><PanelLeftClose className="size-3.5" /></button></span>
        </div>
      </div>
    </nav>
  );

  // Inside Talk's floating window (an iframe): just the page, with a small title, no sidebar / top bar / prompt bar.
  if (embedded && mode !== "talk") return (
    <div className="min-h-dvh bg-bg px-3 pb-6 pt-3 text-text sm:px-4"><TitleBlock /><div className="mt-3">{children}</div></div>
  );
  // Talk mode (/talk, flag-gated): a separate full-screen frame. Classic sidebar, top bar, PromptBar, RightRail and MobileNav are not mounted.
  if (mode === "talk") return <TalkFrame>{children}</TalkFrame>;

  return (
    <div className="app-glow min-h-screen">
      <aside aria-hidden={collapsed} className={cx("fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-line bg-bg-2 transition-transform duration-300 lg:block", collapsed && "-translate-x-full")}>
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64 border-r border-line bg-bg-2" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      {collapsed && (
        <button onClick={toggle} title="Show menu  ( [ )" aria-label="Show menu"
          className="fade-up fixed left-0 top-1/2 z-30 hidden -translate-y-1/2 rounded-r-xl border border-l-0 border-line bg-bg-2 px-1 py-4 text-muted shadow-lg hover:text-accent-2 lg:block">
          <PanelLeftOpen className="size-4" />
        </button>
      )}
      <RightRail open={railOpen} onToggle={toggleRail} />
      <div className={cx("transition-[padding]", collapsed ? "lg:pl-0" : "lg:pl-56", railOpen ? "xl:pr-80" : "xl:pr-0")}>
        <TopBar onMenu={() => setMobileOpen(true)} unread={me.data?.unread ?? 0} connected={connected} onModo={() => { try { localStorage.setItem("merod-rail-tab", "modo"); } catch {} if (!railOpen) toggleRail(); window.dispatchEvent(new Event("merod-rail-tab")); }} />
        <main className="mx-auto max-w-[1680px] px-4 pb-28 pt-4 sm:px-6">{children}</main>
      </div>
      <div className={pathname === "/ai" ? "hidden" : "hidden lg:block"}><PromptBar leftCollapsed={collapsed} railOpen={railOpen} /></div>
      <MobileNav />
    </div>
  );
}

/** US equities session status for the top bar (NYSE hours, America/New_York; holidays not modelled). */
function marketStatus(now = new Date()) {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay(), mins = ny.getHours() * 60 + ny.getMinutes();
  const open = 9 * 60 + 30, close = 16 * 60;
  const fmt = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
  if (day >= 1 && day <= 5 && mins >= open && mins < close) return { open: true, text: `NYSE open · closes in ${fmt(close - mins)}` };
  if (day >= 1 && day <= 5 && mins < open) return { open: false, text: `NYSE closed · opens in ${fmt(open - mins)}` };
  return { open: false, text: "NYSE closed · crypto 24/7" };
}

/** Page title in the top bar: small section crumb + title with one word in gold serif italic. */
function TitleBlock() {
  const { title } = useShell();
  if (!title) return null;
  const { section, title: t, accent } = title;
  const i = accent ? t.indexOf(accent) : -1;
  return (
    <div className="hidden min-w-0 shrink-0 md:block">
      {section && <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{section}</div>}
      <div className="truncate text-[19px] font-semibold leading-tight tracking-tight">
        {i >= 0 ? <>{t.slice(0, i)}<span className="serif-accent text-[22px] text-accent-2">{accent}</span>{t.slice(i + accent!.length)}</> : t}
      </div>
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
  const { title } = useShell();
  const [mkt, setMkt] = useState(() => marketStatus());
  useEffect(() => { const t = setInterval(() => setMkt(marketStatus()), 30_000); return () => clearInterval(t); }, []);
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-muted hover:text-text lg:hidden" aria-label="Menu"><Menu className="size-5" /></button>
      <TitleBlock />
      <div className={cx("relative w-full", title ? "ml-auto max-w-sm" : "max-w-md")}>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-faint" />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === "Enter" && !results.length && !agentHits.length) ask(); }}
          placeholder="Search tickers, agents, prompts…" className="h-9 w-full rounded-lg border border-line bg-panel/70 pl-9 pr-12 text-[13px] outline-none placeholder:text-faint focus:border-accent/60" />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line-2 px-1 py-px text-[10px] text-faint sm:block">⌘K</kbd>
        {open && (results.length > 0 || agentHits.length > 0 || q.trim()) && (
          <div className="absolute left-0 right-0 top-11 z-30 min-w-[320px] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
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
      <div className={cx("flex shrink-0 items-center gap-2", !title && "ml-auto")}>
        <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted xl:flex"><span className={cx("size-1.5 rounded-full", mkt.open ? "bg-up pulse-dot" : "bg-faint")} />{mkt.text}</span>
        <MapLink />
        <ModeSwitch callout />
        <span className={cx("hidden rounded-md border px-2 py-1 text-[10px] font-bold tracking-wider sm:block", user.tradingMode === "live" ? "border-down/40 bg-down-soft text-down" : "border-warn/40 bg-warn-soft text-warn")}>{user.tradingMode === "live" ? "LIVE TRADING" : "PAPER TRADING"}</span>
        <Link href="/wallet" className="hidden h-8 items-center gap-1.5 rounded-lg bg-grad px-3 text-[12.5px] font-semibold text-bg sm:flex"><Plus className="size-3.5" /> Deposit</Link>
        <span title={connected ? "Realtime connected" : "Realtime offline — polling"} className={cx("hidden size-2 rounded-full sm:block", connected ? "bg-up pulse-dot" : "bg-faint")} />
        <Link href="/alerts" className="relative rounded-xl p-2.5 text-muted hover:text-text" aria-label="Notifications">
          <Bell className="size-[18px]" strokeWidth={1.6} />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <button onClick={onModo} className="rounded-xl p-2.5 text-muted hover:text-text" aria-label="Open Modo" title="Modo"><Sparkles className="size-[18px]" strokeWidth={1.6} /></button>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} className="flex items-center gap-1.5 rounded-full p-0.5 pr-1 text-muted hover:text-text">
            <span className="flex size-8 items-center justify-center rounded-full bg-grad text-[13px] font-semibold text-bg">{user.displayName.slice(0, 1).toUpperCase()}</span>
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
