"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home, Compass, CandlestickChart, Sparkles, Zap, Bot, Users, PieChart, Wallet, Settings, Shield, Bell, Search, Menu, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen, Plug,
  Radio, GraduationCap, Percent, Brain, KeyRound, Globe2, Gauge, Cpu, MessagesSquare, Copy,
} from "lucide-react";
import { ShellProvider, useRealtime, useShell, type ShellUser } from "./context";
import { RightRail } from "./RightRail";
import { PromptBar } from "./PromptBar";
import { Logo } from "./Logo";
import { ToastProvider, useToast, cx, Badge } from "@/components/ui";
import { api, useApi } from "@/lib/api";

const NAV: { href: string; label: string; icon: any; also?: string[] }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/progress", label: "Progress", icon: Gauge },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/terminal", label: "Trade", icon: CandlestickChart },
  { href: "/bots", label: "Bots & Shortcut Buttons", icon: Bot, also: ["/shortcuts"] },
  { href: "/activity", label: "Live & World Activity", icon: Radio, also: ["/world"] },
  { href: "/learning", label: "AI Learning", icon: Brain },
  { href: "/training", label: "Auto-Training", icon: GraduationCap },
  { href: "/chat", label: "Community Chat", icon: MessagesSquare },
  { href: "/social", label: "Social", icon: Users },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/wallet", label: "Wallet & Funding", icon: Wallet },
  { href: "/broker-keys", label: "Broker Keys", icon: KeyRound },
  { href: "/ai-keys", label: "AI Keys", icon: Cpu },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
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

function Frame({ children }: { children: React.ReactNode }) {
  const { user, connected } = useShell();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toast = useToast();
  const me = useApi<any>("/api/auth/me", { refreshMs: 30000 });
  const [railOpen, setRailOpen] = useState(true);
  useEffect(() => { try { setCollapsed(localStorage.getItem("merod-nav") === "1"); setRailOpen(localStorage.getItem("merod-rail") !== "0"); } catch {} }, []);
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
  const nav = [...NAV,
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Shield }, { href: "/admin/integrations", label: "Integrations", icon: Plug }] : []),
    ...(user.role === "super_admin" ? [{ href: "/copy", label: "Copy Trading", icon: Copy }, { href: "/admin/fees", label: "Fees (Super admin)", icon: Percent }] : []),
  ] as { href: string; label: string; icon: any; also?: string[] }[];

  const sidebar = (
    <nav className="relative flex h-full flex-col">
      {/* Logo sits outside the scroll area so its glow is never clipped. */}
      <div className="relative z-10 flex shrink-0 items-center justify-between px-5 pb-3 pt-4">
        <Link href="/" aria-label="Merod home"><Logo /></Link>
        <button onClick={toggle} className="hidden rounded-lg p-1.5 text-faint hover:bg-panel-2 hover:text-text lg:block" title="Hide menu  ( [ )" aria-label="Hide menu">
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
      {nav.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname === n.href || (pathname.startsWith(n.href + "/") && !(n.href === "/admin" && pathname.startsWith("/admin/integrations")))
          || !!n.also?.some((x) => pathname === x || pathname.startsWith(x + "/"));
        return (
          <Link key={n.href} href={n.href} 
            className={cx("flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-accent-soft text-text shadow-[inset_0_0_0_1px_rgba(56,189,248,.35)]" : "text-muted hover:bg-panel-2 hover:text-text")}>
            <n.icon className={cx("size-[18px] shrink-0", active && "text-accent-2")} />
            <span className="leading-tight">{n.label}</span>
          </Link>
        );
      })}
      <div className="mt-auto space-y-2">
        {(
          <div className="rounded-xl border border-warn/25 bg-warn-soft p-3 text-xs text-warn">
            <div className="font-semibold">Paper trading mode</div>
            <div className="mt-0.5 text-warn/80">Virtual funds. Real money only after an admin turns it on.</div>
          </div>
        )}
        <button onClick={toggle} className="hidden w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-faint hover:text-text lg:flex">
          <PanelLeftClose className="size-4" /> Hide menu
        </button>
      </div>
      </div>
    </nav>
  );

  return (
    <div className="app-glow min-h-screen">
      <aside aria-hidden={collapsed} className={cx("fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-bg-2 transition-transform duration-300 lg:block", collapsed && "-translate-x-full")}>
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
      <div className={cx("transition-[padding]", collapsed ? "lg:pl-0" : "lg:pl-60", railOpen ? "xl:pr-72" : "xl:pr-0")}>
        <TopBar onMenu={() => setMobileOpen(true)} unread={me.data?.unread ?? 0} connected={connected} />
        <main className="mx-auto max-w-[1600px] px-4 pb-32 pt-4 sm:px-6">{children}</main>
      </div>
      <PromptBar leftCollapsed={collapsed} railOpen={railOpen} />
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
