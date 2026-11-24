"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home, Compass, CandlestickChart, Sparkles, Zap, Bot, Users, PieChart, Wallet, Settings, Shield, Bell, Search, Menu, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen, Plug,
  Radio, GraduationCap, Percent, Brain, KeyRound,
} from "lucide-react";
import { ShellProvider, useRealtime, useShell, type ShellUser } from "./context";
import { PromptBar } from "./PromptBar";
import { Logo } from "./Logo";
import { ToastProvider, useToast, cx, Badge } from "@/components/ui";
import { api, useApi } from "@/lib/api";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/terminal", label: "Trade", icon: CandlestickChart },
  { href: "/ai", label: "AI Trade", icon: Sparkles },
  { href: "/shortcuts", label: "Shortcuts", icon: Zap },
  { href: "/bots", label: "Agents & Bots", icon: Bot },
  { href: "/activity", label: "Live Activity", icon: Radio },
  { href: "/learning", label: "AI Learning", icon: Brain },
  { href: "/training", label: "Auto-Training", icon: GraduationCap },
  { href: "/social", label: "Social", icon: Users },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/wallet", label: "Wallet & Funding", icon: Wallet },
  { href: "/broker-keys", label: "Broker Keys", icon: KeyRound },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Sidebar panel with a curved ("warped") right edge and a soft green glow line.
 * Drawn as a stretched SVG behind the nav; the stroke keeps a constant width at any height.
 */
function CurvedSidebarBackground() {
  // Right edge sweeps between x=90 and x=100 (of 100) so it never cuts into the menu items.
  const edge = "M92,0 C100,40 100,120 97,220 C93,360 90,470 91,560 C92,690 100,800 99,880 C98,940 94,980 92,1000";
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sidebarGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
          <stop offset="35%" stopColor="var(--accent)" stopOpacity="0.95" />
          <stop offset="70%" stopColor="var(--accent-orange)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--accent-orange)" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="sidebarFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--bg-2)" stopOpacity="0.96" />
          <stop offset="100%" stopColor="var(--panel)" stopOpacity="0.92" />
        </linearGradient>
      </defs>
      <path d={`M0,0 L92,0 ${edge.slice(edge.indexOf("C"))} L0,1000 Z`} fill="url(#sidebarFill)" />
      <path d={edge} fill="none" stroke="url(#sidebarGlow)" strokeWidth="6" vectorEffect="non-scaling-stroke" opacity="0.25" />
      <path d={edge} fill="none" stroke="url(#sidebarGlow)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Shell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellProvider user={user}>
        <Frame>{children}</Frame>
      </ShellProvider>
    </ToastProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { user, connected } = useShell();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toast = useToast();
  const me = useApi<any>("/api/auth/me", { refreshMs: 30000 });
  useEffect(() => { try { setCollapsed(localStorage.getItem("merod-nav") === "1"); } catch {} }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  useRealtime((e) => {
    if (e.type === "fill") toast(`${e.payload.paper ? "[Paper] " : ""}${e.payload.side === "buy" ? "Bought" : "Sold"} ${Number(e.payload.quantity).toPrecision(4)} ${e.payload.symbol}`, e.payload.side === "buy" ? "up" : "neutral");
    if (e.type === "notification") me.refresh();
  });
  const toggle = () => { setCollapsed((c) => { try { localStorage.setItem("merod-nav", c ? "0" : "1"); } catch {} return !c; }); };
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const nav = [...NAV,
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Shield }, { href: "/admin/integrations", label: "Integrations", icon: Plug }] : []),
    ...(user.role === "super_admin" ? [{ href: "/admin/fees", label: "Fees (Super admin)", icon: Percent }] : []),
  ];

  const sidebar = (
    <nav className={cx("relative flex h-full flex-col gap-0.5 overflow-y-auto p-3", !collapsed && "lg:pr-6")}>
      <div className={cx("mb-4 flex items-center px-2 pt-1", collapsed ? "justify-center" : "justify-between")}>
        <Link href="/"><Logo compact={collapsed} /></Link>
      </div>
      {nav.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname === n.href || (pathname.startsWith(n.href + "/") && !(n.href === "/admin" && pathname.startsWith("/admin/integrations")));
        return (
          <Link key={n.href} href={n.href} title={collapsed ? n.label : undefined}
            className={cx("flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors", collapsed && "justify-center px-2",
              active ? "bg-accent-soft text-text shadow-[inset_0_0_0_1px_rgba(20,195,187,.35)]" : "text-muted hover:bg-panel-2 hover:text-text")}>
            <n.icon className={cx("size-[18px] shrink-0", active && "text-accent-2")} />
            {!collapsed && <span className="truncate">{n.label}</span>}
          </Link>
        );
      })}
      <div className="mt-auto space-y-2">
        {!collapsed && (
          <div className="rounded-xl border border-warn/25 bg-warn-soft p-3 text-xs text-warn">
            <div className="font-semibold">Paper trading mode</div>
            <div className="mt-0.5 text-warn/80">Virtual funds. Real-money trading is disabled pending approvals.</div>
          </div>
        )}
        <button onClick={toggle} className="hidden w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-faint hover:text-text lg:flex">
          {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="app-glow min-h-screen">
      <aside className={cx("fixed inset-y-0 left-0 z-30 hidden lg:block transition-[width]", collapsed ? "w-[72px]" : "w-60")}>
        <CurvedSidebarBackground />
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64 border-r border-line bg-bg-2" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className={cx("transition-[padding]", collapsed ? "lg:pl-[72px]" : "lg:pl-60")}>
        <TopBar onMenu={() => setMobileOpen(true)} unread={me.data?.unread ?? 0} connected={connected} />
        <main className="mx-auto max-w-[1600px] px-4 pb-48 pt-4 sm:px-6">{children}</main>
      </div>
      <PromptBar />
    </div>
  );
}

function TopBar({ onMenu, unread, connected }: { onMenu: () => void; unread: number; connected: boolean }) {
  const { user } = useShell();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { setTheme((document.documentElement.dataset.theme as any) === "light" ? "light" : "dark"); }, []);
  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); return; }
    const t = setTimeout(() => api(`/api/assets?q=${encodeURIComponent(q)}&limit=8`).then((r: any) => setResults(r.assets)).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q]);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t; setTheme(t);
    try { localStorage.setItem("merod-theme", t); } catch {}
  };
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-muted hover:text-text lg:hidden" aria-label="Menu"><Menu className="size-5" /></button>
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <span className="truncate text-sm text-muted">Welcome back, <span className="font-semibold text-text">@{user.handle}</span></span>
        <Badge tone="warn">PAPER</Badge>
      </div>
      <div className="relative mx-auto w-full max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search stocks, crypto, contract addresses…" className="h-10 w-full rounded-xl border border-line bg-panel/70 pl-9 pr-3 text-sm outline-none placeholder:text-faint focus:border-accent" />
        {open && results.length > 0 && (
          <div className="absolute left-0 right-0 top-12 z-30 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
            {results.map((a) => (
              <button key={a.id} onMouseDown={() => { router.push(`/terminal/${a.id}`); setQ(""); }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-panel-2">
                <span className="min-w-0"><span className="font-semibold">{a.symbol}</span> <span className="truncate text-sm text-muted">{a.name}</span></span>
                <span className="shrink-0 text-xs text-faint">{a.venue}{a.risk_flags?.includes("demo_data") ? " · DEMO" : ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span title={connected ? "Realtime connected" : "Realtime offline — polling"} className={cx("hidden size-2 rounded-full sm:block", connected ? "bg-up pulse-dot" : "bg-faint")} />
      <button onClick={flip} className="rounded-lg p-2 text-muted hover:text-text" aria-label="Toggle theme">{theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}</button>
      <Link href="/alerts" className="relative rounded-lg p-2 text-muted hover:text-text" aria-label="Notifications">
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <div className="relative">
        <button onClick={() => setMenu(!menu)} className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-2">{user.displayName.slice(0, 1).toUpperCase()}</button>
        {menu && (
          <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onMouseLeave={() => setMenu(false)}>
            <Link href={`/social/${user.handle}`} className="block px-4 py-2.5 text-sm hover:bg-panel-2">My profile</Link>
            <Link href="/settings" className="block px-4 py-2.5 text-sm hover:bg-panel-2">Settings</Link>
            {!user.totpEnabled && <Link href="/settings?tab=security" className="block px-4 py-2.5 text-sm text-warn hover:bg-panel-2">Enable 2FA</Link>}
            <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}
              className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-down hover:bg-panel-2"><LogOut className="size-4" /> Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
