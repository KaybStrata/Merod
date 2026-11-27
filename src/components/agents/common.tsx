"use client";
import Link from "next/link";
import {
  Activity, AlertTriangle, BadgeCheck, Bitcoin, Bot, Brain, CandlestickChart, CheckCircle2, CircleDot, Compass, Crosshair, Eye, FlaskConical, Gauge, GitBranch, Globe2, Hammer,
  LineChart, Megaphone, MessagesSquare, Newspaper, PieChart, Radar, Repeat, Scale, ScanSearch, Shield, ShieldCheck, Sparkles, Target, TrendingUp, Users, Wallet, Zap, LogOut, Landmark, Swords,
} from "lucide-react";
import { AssetIcon, cx } from "@/components/ui";
import { usePageTitle } from "@/components/shell/context";

export const ROLE_ICON: Record<string, any> = {
  stock_trading: CandlestickChart, crypto_trading: Bitcoin, memecoin: Zap, sniping: Crosshair, mimic: Repeat, copy_trading: Users, news: Newspaper, social_sentiment: Megaphone,
  wallet_tracking: Wallet, technical_analysis: LineChart, fundamental_analysis: Landmark, arbitrage: Scale, market_scanner: ScanSearch, risk_management: Shield, portfolio: PieChart,
  strategy_builder: Hammer, backtesting: FlaskConical, auto_training: Brain, execution: Target, supervisor: ShieldCheck, counterargument: Swords, exit: LogOut, earnings: BadgeCheck,
  macro: Globe2, agent_builder: Sparkles,
};
export const MARKET: Record<string, string> = {
  stock_trading: "Stocks", crypto_trading: "Crypto", memecoin: "Crypto", sniping: "Crypto", mimic: "Crypto", copy_trading: "Copy", wallet_tracking: "Crypto", arbitrage: "Crypto",
  risk_management: "System", supervisor: "System", portfolio: "System", execution: "System", exit: "System", auto_training: "System", backtesting: "Lab", strategy_builder: "Lab", agent_builder: "Lab",
  news: "Research", social_sentiment: "Research", technical_analysis: "Research", fundamental_analysis: "Stocks", earnings: "Stocks", macro: "Research", market_scanner: "Discovery", counterargument: "Research",
};
export const TRADING_ROLES = new Set(["stock_trading", "crypto_trading", "memecoin", "sniping", "mimic", "copy_trading", "execution", "exit"]);

/** Agent avatar: the asset logo for single-asset trading agents, otherwise the role glyph. */
export function AgentAvatar({ agent, size = 32 }: { agent: any; size?: number }) {
  const sym = agent.symbols?.length === 1 ? agent.symbols[0] : null;
  if (sym && TRADING_ROLES.has(agent.role)) return <AssetIcon symbol={sym} size={size} />;
  const Icon = ROLE_ICON[agent.role] ?? Bot;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-accent-2" style={{ width: size, height: size }}>
      <Icon style={{ width: size * 0.52, height: size * 0.52 }} />
    </span>
  );
}

export const STATUS: Record<string, { label: string; dot: string; text: string }> = {
  running: { label: "Running", dot: "bg-up", text: "text-up" },
  queued: { label: "Starting", dot: "bg-up", text: "text-up" },
  paused: { label: "Paused", dot: "bg-warn", text: "text-warn" },
  pending_approval: { label: "Needs approval", dot: "bg-accent", text: "text-accent-2" },
  risk_blocked: { label: "Risk blocked", dot: "bg-down", text: "text-down" },
  failed: { label: "Failed", dot: "bg-down", text: "text-down" },
  completed: { label: "Stopped", dot: "bg-faint", text: "text-muted" },
  configured: { label: "Ready", dot: "bg-faint", text: "text-muted" },
  draft: { label: "Draft", dot: "bg-faint", text: "text-muted" },
  archived: { label: "Archived", dot: "bg-faint", text: "text-faint" },
};
export function StatusDot({ status, scanning }: { status: string; scanning?: boolean }) {
  const s = STATUS[status] ?? STATUS.draft;
  const label = scanning && status === "running" ? "Scanning" : s.label;
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium", scanning && status === "running" ? "text-[#6aa8ff]" : s.text)}>
      <span className={cx("size-1.5 rounded-full", scanning && status === "running" ? "bg-[#6aa8ff]" : s.dot, (status === "running" || status === "queued") && "pulse-dot")} />{label}
    </span>
  );
}

export const KIND: Record<string, { label: string; cls: string; icon: any }> = {
  thought: { label: "Thought", cls: "bg-[rgba(185,163,240,.14)] text-[#c9b6ff]", icon: Brain },
  analysis: { label: "Analysis", cls: "bg-up-soft text-up", icon: Activity },
  decision: { label: "Decision", cls: "bg-[rgba(106,168,255,.14)] text-[#8fbcff]", icon: Target },
  execution: { label: "Execution", cls: "bg-up-soft text-up", icon: CheckCircle2 },
  warning: { label: "Warning", cls: "bg-warn-soft text-warn", icon: AlertTriangle },
  approval: { label: "Approval", cls: "bg-accent-soft text-accent-2", icon: CircleDot },
  state: { label: "Status", cls: "bg-panel-2 text-muted", icon: Gauge },
  message: { label: "Message", cls: "bg-panel-2 text-muted", icon: MessagesSquare },
  training: { label: "Training", cls: "bg-accent-soft text-accent-2", icon: Brain },
  system: { label: "System", cls: "bg-panel-2 text-muted", icon: Eye },
};
export function KindBadge({ kind }: { kind: string }) {
  const k = KIND[kind] ?? KIND.system;
  return <span className={cx("rounded-md px-1.5 py-0.5 text-[10px] font-medium", k.cls)}>{k.label}</span>;
}

export const fmtUsd = (n: number | null | undefined, d = 2) => n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const fmtSigned = (n: number | null | undefined, d = 2) => n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const fmtPct = (n: number | null | undefined, d = 2) => n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
export const toneOf = (n: number | null | undefined) => (n == null ? "text-muted" : n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");
export const clock = (t: string | number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });

/** Smooth area chart for agent equity (green when up, red when down). */
export function AreaChart({ data, height = 56, className, up: upProp }: { data: number[]; height?: number; className?: string; up?: boolean }) {
  const w = 300, h = height;
  if (data.length < 2) return <div className={cx("flex items-center justify-center text-[10px] text-faint", className)} style={{ height }}>Chart builds as the agent runs</div>;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const up = upProp ?? data[data.length - 1] >= data[0];
  const c = up ? "var(--up)" : "var(--down)";
  const id = `ag${Math.round(Math.random() * 1e9)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cx("w-full", className)} style={{ height }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity="0.35" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={c} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
export function Bars({ values, height = 40, className }: { values: number[]; height?: number; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={cx("flex items-end gap-[3px]", className)} style={{ height }}>
      {values.map((v, i) => <span key={i} className={cx("w-full rounded-t-sm", i >= values.length - 4 ? "bg-[#6aa8ff]" : "bg-line-2")} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />)}
    </div>
  );
}

/** Ring gauge (capital utilisation, fleet win rate). */
export function Ring({ pct, size = 34, stroke = 4, tone = "up" }: { pct: number; size?: number; stroke?: number; tone?: "up" | "accent" }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line-2)" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={tone === "up" ? "var(--up)" : "var(--accent)"} strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={c - (p / 100) * c} strokeLinecap="round" />
    </svg>
  );
}

export const AGENT_TABS = [
  { href: "/agents", label: "Command Center", icon: Radar },
  { href: "/agents/workspace", label: "Workspace", icon: Compass },
  { href: "/agents/fleets", label: "Fleet Builder", icon: GitBranch },
  { href: "/agents/rooms", label: "Rooms", icon: MessagesSquare },
  { href: "/agents/arena", label: "Arena", icon: Swords },
  { href: "/agents/training", label: "Auto-Training", icon: Brain },
  { href: "/agents/capital", label: "Capital & Risk", icon: Shield },
  { href: "/agents/marketplace", label: "Marketplace", icon: TrendingUp },
];
/** Page header: the title goes to the top bar (section crumb + gold serif accent); the page keeps a compact subtitle row + actions. */
export function PageHead({ eyebrow, title, accent, sub, right }: { eyebrow?: string; title: string; accent?: string; sub?: string; right?: React.ReactNode }) {
  const full = accent ? `${title}${title.endsWith("-") ? "" : " "}${accent}`.trim() : title;
  usePageTitle({ section: `Automate · ${eyebrow?.replace(/^Merod\s+/, "") ?? "Agents"}`, title: full, accent });
  if (!sub && !right) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {sub ? <p className="max-w-3xl text-[13px] leading-relaxed text-muted">{sub}</p> : <span />}
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
export function GoldButton({ children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cx("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-grad px-3.5 text-[13px] font-semibold text-bg disabled:opacity-50", className)}>{children}</button>;
}
export function GhostButton({ children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cx("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-2 bg-panel/60 px-3 text-[13px] font-medium text-text hover:border-accent/50 disabled:opacity-50", className)}>{children}</button>;
}
export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-xs text-muted hover:text-text">{children}</Link>;
}
