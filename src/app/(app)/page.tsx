"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BarChart3, Search, Zap, Layers, Bot, ArrowRight, Sparkles, ChevronDown, Info, Paperclip, Image as ImageIcon, SlidersHorizontal, Send, Clock, Grid2x2, List, MoreHorizontal, LayoutDashboard } from "lucide-react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { AreaChart, fmtPct, fmtSigned, toneOf } from "@/components/agents/common";
import HomeDashboard from "@/components/HomeDashboard";
import { WalletFundsPanel } from "@/components/wallet/WalletFundsPanel";

const ACTIONS = [
  { href: "/trade", icon: BarChart3, title: "Trade", text: "Execute trades, set orders, and manage positions" },
  { href: "/research", icon: Search, title: "Research", text: "Analyze markets, tokens, and narratives" },
  { href: "/automations", icon: Zap, title: "Automate", text: "Build and run trading automations" },
  { href: "/strategies", icon: Layers, title: "Strategy", text: "Create, test, and backtest trading strategies" },
  { href: "/bots", icon: Bot, title: "Bot", text: "Deploy and manage AI trading bots" },
];

/** Home (Merod AI workspace): "What do you want to create?" + quick actions + recent workspaces, then your dashboard. */
export default function Home() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"intelligent" | "fast">("intelligent");
  const [tab, setTab] = useState<"all" | "bots" | "strategies" | "automations">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showDash, setShowDash] = useState(true);
  const bots = useApi<any>("/api/bots", { refreshMs: 30000 });
  const strategies = useApi<any>("/api/builder");
  const agents = useApi<any>("/api/agents", { refreshMs: 30000 });
  const send = () => { if (!text.trim()) return; window.dispatchEvent(new CustomEvent("merod-prompt", { detail: mode === "fast" ? `${text} (answer briefly)` : text })); setText(""); };
  const items = useMemo(() => {
    const b = (bots.data?.bots ?? []).map((x: any) => {
      const d = (x.wins ?? 0) + (x.losses ?? 0);
      return { kind: "bots", type: "Trading Bot", icon: Bot, id: x.id, href: `/bots/${x.id}`, title: x.name, text: x.description || `${x.strategy_name ?? "Bot"} on ${(x.symbols ?? []).join(", ")}`, status: x.status === "running" ? "Running" : x.status, live: x.status === "running",
        big: fmtSigned(Number(x.pnl_usd ?? 0)), bigLabel: "Total P&L", tone: toneOf(Number(x.pnl_usd ?? 0)), spark: [] as number[], stats: [["P&L", fmtSigned(Number(x.pnl_usd ?? 0))], ["Win Rate", d ? `${((x.wins / d) * 100).toFixed(1)}%` : "—"], ["Trades", String(x.filled_orders ?? 0)]], at: x.updated_at ?? x.created_at };
    });
    const s = (strategies.data?.strategies ?? []).map((x: any) => {
      const v = x.versions?.[0];
      return { kind: "strategies", type: "Strategy", icon: Layers, id: x.id, href: "/strategies", title: x.name, text: v ? `${v.config?.asset} · ${v.config?.strategy?.kind?.replace("_", " ")} · ${v.config?.timeframe}` : "Strategy", status: "Active", live: true,
        big: v?.ret != null ? fmtPct(Number(v.ret)) : "—", bigLabel: "Backtest Return", tone: toneOf(Number(v?.ret ?? 0)), spark: [], stats: [["Return", v?.ret != null ? fmtPct(Number(v.ret)) : "—"], ["Win Rate", v?.win != null ? `${Number(v.win).toFixed(1)}%` : "—"], ["Versions", String(x.versions?.length ?? 0)]], at: x.updated_at };
    });
    const a = (agents.data?.agents ?? []).map((x: any) => ({ kind: "automations", type: x.role === "market_scanner" ? "Research" : "Agent", icon: x.role === "market_scanner" ? Search : Sparkles, id: x.id, href: `/agents/${x.id}`, title: x.name, text: x.instructions,
      status: x.status === "running" ? (x.role === "market_scanner" ? "Scanning" : "Running") : x.status.replace("_", " "), live: x.status === "running",
      big: x.role === "market_scanner" ? String(x.metrics?.opportunities ?? 0) : fmtPct(x.metrics?.pnlPct), bigLabel: x.role === "market_scanner" ? "Opportunities" : "Return", tone: x.role === "market_scanner" ? "text-text" : toneOf(x.metrics?.pnlPct),
      spark: (x.spark ?? []).map((p: any) => p.v), stats: x.role === "market_scanner" ? [["Signals", String(x.metrics?.signals ?? 0)], ["Qualified", String(x.metrics?.qualified ?? 0)], ["Last Run", x.last_tick_at ? new Date(x.last_tick_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"]]
        : [["P&L", fmtSigned(x.metrics?.pnl)], ["Win Rate", x.metrics?.winRate == null ? "—" : `${x.metrics.winRate.toFixed(1)}%`], ["Trades", String(x.metrics?.trades ?? 0)]], at: x.last_event_at ?? x.created_at }));
    return [...b, ...s, ...a].sort((x, y) => +new Date(y.at ?? 0) - +new Date(x.at ?? 0));
  }, [bots.data, strategies.data, agents.data]);
  const counts = { all: items.length, bots: items.filter((i) => i.kind === "bots").length, strategies: items.filter((i) => i.kind === "strategies").length, automations: items.filter((i) => i.kind === "automations").length };
  const shown = items.filter((i) => tab === "all" || i.kind === tab).slice(0, view === "grid" ? 6 : 12);
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[300px] w-[75%] opacity-90" />
      <div className="relative z-10">
        <div className="eyebrow mb-3 mt-2">Merod AI Workspace</div>
        <h1 className="text-[2.6rem] font-semibold leading-tight tracking-tight sm:text-[3.3rem]">What do you want to <span className="serif-accent text-[1.12em]">create</span>?</h1>
        <p className="mt-2 text-[1.12rem] text-muted">Trade, research, automate, and build trading strategies — all in one intelligent workspace.</p>

        <section className="mt-6 max-w-[1000px] rounded-2xl border border-accent/40 bg-panel/80 p-5 shadow-[0_0_0_1px_rgba(214,179,122,0.12),0_0_40px_-10px_rgba(214,179,122,0.35)]">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 size-6 shrink-0 text-accent-2" />
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={2} maxLength={8000} placeholder="Ask Merod anything…" className="min-w-0 flex-1 resize-none bg-transparent text-[1.2rem] outline-none placeholder:text-muted" />
            <label className="relative hidden items-center gap-1.5 rounded-xl border border-line-2 py-1.5 pl-3 pr-7 text-xs sm:flex"><Zap className="size-3.5" />
              <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="appearance-none bg-transparent outline-none"><option value="intelligent">Intelligent Mode</option><option value="fast">Fast Mode</option></select><ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" /></label>
            <span title="Merod answers from real live and historical market data, with sources." className="hidden text-muted sm:block"><Info className="size-4" /></span>
          </div>
          <div className="mt-5 flex items-center gap-2">
            <span className="flex h-11 items-center gap-2 rounded-xl border border-line-2 px-4 text-sm"><Sparkles className="size-4 text-muted" /> Merod AI <ChevronDown className="size-3.5 text-muted" /></span>
            <button disabled title="Attachments aren't available yet" className="flex size-11 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><Paperclip className="size-4" /></button>
            <button disabled title="Image input isn't available yet" className="flex size-11 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><ImageIcon className="size-4" /></button>
            <Link href="/settings" title="Prompt & AI settings" className="flex size-11 items-center justify-center rounded-full border border-line-2 text-muted hover:text-text"><SlidersHorizontal className="size-4" /></Link>
            <span className="ml-auto text-xs text-faint">{text.length} / 8,000</span>
            <button onClick={send} disabled={!text.trim()} className="flex h-12 w-16 items-center justify-center rounded-2xl bg-grad disabled:opacity-60" aria-label="Send"><Send className="size-5" /></button>
          </div>
        </section>

        <div className="mt-6 grid max-w-[1000px] grid-cols-2 gap-3 md:grid-cols-5">
          {ACTIONS.map((a) => (
            <Link key={a.title} href={a.href} className="surface surface-hover rounded-2xl p-4">
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[15px] font-semibold"><a.icon className="size-5" strokeWidth={1.6} />{a.title}</span><ArrowRight className="size-4 text-muted" /></div>
              <p className="mt-2 text-[12.5px] leading-snug text-muted">{a.text}</p>
            </Link>
          ))}
        </div>

        <div className="mt-4 max-w-[1000px]"><WalletFundsPanel /></div>

        <div className="mt-8 flex max-w-[1000px] flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-[1.3rem] font-semibold"><Clock className="size-5" /> Recent Workspaces</h2>
          <div className="flex gap-1 rounded-xl border border-line bg-panel/60 p-1 text-[12.5px]">
            {([["all", "All"], ["bots", "Bots"], ["strategies", "Strategies"], ["automations", "Automations"]] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx("rounded-lg px-3 py-1.5", tab === k ? "nav-active" : "text-muted hover:text-text")}>{l} ({counts[k]})</button>)}
          </div>
          <Link href={tab === "bots" ? "/bots" : tab === "strategies" ? "/strategies" : "/agents"} className="ml-auto flex items-center gap-1 text-[13px] text-muted hover:text-text">View All <ArrowRight className="size-3.5" /></Link>
          <div className="flex gap-1 rounded-xl border border-line bg-panel/60 p-1"><button onClick={() => setView("grid")} className={cx("rounded-lg p-1.5", view === "grid" ? "nav-active" : "text-muted")} aria-label="Grid"><Grid2x2 className="size-4" /></button><button onClick={() => setView("list")} className={cx("rounded-lg p-1.5", view === "list" ? "nav-active" : "text-muted")} aria-label="List"><List className="size-4" /></button></div>
        </div>
        <div className={cx("mt-4 grid max-w-[1000px] gap-3", view === "grid" ? "md:grid-cols-3" : "grid-cols-1")}>
          {!shown.length && <p className="surface rounded-2xl p-6 text-sm text-muted md:col-span-3">Nothing here yet. Ask Merod to build a bot, strategy or agent above.</p>}
          {shown.map((i) => (
            <Link key={`${i.kind}${i.id}`} href={i.href} className="surface surface-hover relative overflow-hidden rounded-2xl p-4">
              <svg aria-hidden viewBox="0 0 300 60" className="pointer-events-none absolute -right-6 -top-2 h-14 w-60 opacity-50" fill="none">{[0, 1, 2, 3].map((k) => <path key={k} d={`M0 ${48 - k * 3} C 90 ${8 + k * 4}, 170 ${60 - k * 3}, 300 ${10 + k * 3}`} stroke="#d6b37a" strokeOpacity={0.15 + k * 0.07} strokeWidth="0.6" />)}</svg>
              <div className="relative flex items-center gap-2"><span className="flex items-center gap-1.5 rounded-lg border border-line-2 px-2 py-1 text-[11.5px]"><i.icon className="size-3.5" />{i.type}</span><span className={cx("flex items-center gap-1.5 rounded-lg border border-line-2 px-2 py-1 text-[11.5px]", i.live ? "text-up" : "text-muted")}><span className={cx("size-1.5 rounded-full", i.live ? "bg-up" : "bg-faint")} />{i.status}</span><MoreHorizontal className="ml-auto size-4 text-muted" /></div>
              <div className="relative mt-3 text-[1.15rem] font-semibold">{i.title}</div>
              <p className="relative line-clamp-1 text-[12.5px] text-muted">{i.text}</p>
              <div className="relative mt-3 flex items-end justify-between gap-3"><AreaChart data={i.spark} height={46} className="w-[55%]" /><div className="text-right"><div className={cx("num text-[1.45rem] font-semibold", i.tone)}>{i.big}</div><div className="text-[11px] text-muted">{i.bigLabel}</div></div></div>
              <div className="relative mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-[11.5px]">{i.stats.map(([k, v]: [string, string]) => <div key={k}><div className="text-muted">{k}</div><div className="num mt-0.5 text-[13px] font-semibold">{v}</div></div>)}</div>
            </Link>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-2"><button onClick={() => setShowDash(!showDash)} className="flex items-center gap-2 text-[1.1rem] font-semibold"><LayoutDashboard className="size-5" /> Your dashboard <ChevronDown className={cx("size-4 transition-transform", showDash && "rotate-180")} /></button></div>
        {showDash && <div className="mt-3"><HomeDashboard /></div>}
      </div>
    </div>
  );
}
