"use client";
import Link from "next/link";
import { useState } from "react";
import { Pause, Play, SlidersHorizontal, FileText, MoreHorizontal, Clock, Gauge, Layers, TrendingUp, CheckCircle2, AlertTriangle, Copy, Archive, XCircle, LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { AgentAvatar, AreaChart, Bars, MARKET, StatusDot, TRADING_ROLES, fmtPct, fmtSigned, fmtUsd, toneOf } from "./common";

export const isScanner = (a: any) => a.role === "market_scanner";
export const isSupervisor = (a: any) => a.role === "supervisor" || a.role === "risk_management";

export async function agentAct(id: string, action: string) { return api(`/api/agents/${id}/actions`, { method: "POST", json: { action } }); }

/** Compact workspace tile (Agent Workspace grid). */
export function AgentTile({ a, selected, onSelect, onChanged, checked, onCheck }: { a: any; selected?: boolean; onSelect?: () => void; onChanged?: () => void; checked?: boolean; onCheck?: (v: boolean) => void }) {
  const m = a.metrics ?? {};
  const spark = (a.spark ?? []).map((p: any) => p.v);
  return (
    <div onClick={onSelect} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onSelect?.(); }}
      className={cx("surface surface-hover group relative cursor-pointer rounded-2xl p-4 transition-colors", selected && "gold-ring")}>
      {onCheck && <input type="checkbox" checked={!!checked} onClick={(e) => e.stopPropagation()} onChange={(e) => onCheck(e.target.checked)} className="absolute left-2 top-2 size-3.5 opacity-0 accent-[#d6b37a] group-hover:opacity-100 checked:opacity-100" aria-label={`Select ${a.name}`} />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentAvatar agent={a} size={30} />
          <span className="truncate text-[15px] font-semibold">{a.name}</span>
          <span className="shrink-0 rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">{MARKET[a.role] ?? "Agent"}</span>
        </div>
        <StatusDot status={a.status} scanning={isScanner(a)} />
      </div>
      {isScanner(a) ? (
        <>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-[1.25rem] font-semibold">{m.opportunities ?? a.metrics?.opportunities ?? 0} Opportunities</div>
            <Bars values={(a.metrics?.top ?? []).map((t: any) => Math.abs(t.change)).concat(Array(14).fill(0)).slice(0, 18).map((v: number, i: number) => v || (i % 5) + 1)} className="w-32" height={44} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-[12px]"><span className="text-muted">Signals <b className="ml-1 text-text">{a.metrics?.signals ?? 0}</b></span><span className="text-muted">Qualified <b className="ml-1 text-text">{a.metrics?.qualified ?? 0}</b></span><span className="text-right text-muted">New <b className="ml-1 text-text">{a.metrics?.fresh ?? 0}</b></span></div>
        </>
      ) : isSupervisor(a) ? (
        <>
          <div className={cx("mt-4 flex items-center gap-2 text-[1.2rem] font-semibold", a.metrics?.withinLimits === false || a.status === "risk_blocked" ? "text-down" : "text-up")}>
            {a.metrics?.withinLimits === false ? <AlertTriangle className="size-6" /> : <CheckCircle2 className="size-6" />}{a.metrics?.withinLimits === false ? "Limit reached" : "Within Limits"}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-[11.5px]"><span className="text-muted">Portfolio Risk <b className="ml-1 text-text">{a.metrics?.portfolioRiskPct ?? 0}%</b></span><span className="text-muted">Max DD <b className="ml-1 text-text">{a.metrics?.maxDrawdownPct ?? 0}%</b></span><span className="text-right text-muted">Daily Limit <b className="ml-1 text-text">{a.metrics?.dailyLimitPct ?? 2}%</b></span></div>
        </>
      ) : TRADING_ROLES.has(a.role) ? (
        <>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <div className={cx("num text-[1.7rem] font-semibold leading-tight", toneOf(m.pnlPct))}>{fmtPct(m.pnlPct)}</div>
              <div className={cx("num text-[13px]", toneOf(m.pnl))}>{fmtSigned(m.pnl)}</div>
            </div>
            <AreaChart data={spark} height={46} className="w-40" up={(m.pnl ?? 0) >= 0} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-[12px]">
            <span className="text-muted">Capital <b className="num ml-1 text-text">{fmtUsd(m.capital, 0)}</b></span>
            <span className="text-muted">{a.role === "mimic" ? "Follows" : "Positions"} <b className="ml-1 text-text">{a.role === "mimic" ? (a.universe?.wallets?.length ?? 0) : m.positions}</b></span>
            <span className="text-right text-muted">Win Rate <b className="ml-1 text-text">{m.winRate == null ? "—" : `${m.winRate.toFixed(0)}%`}</b></span>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-[12.5px] text-muted">{a.last_event ?? a.instructions}</p>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[12px] text-muted"><span>{a.roleName}</span><span>{a.last_event_at ? ago(a.last_event_at) : "No activity yet"}</span></div>
        </>
      )}
    </div>
  );
}

/** Fleet card (Command Center): autonomy, capital, P&L, sparkline, last action, controls. */
export function AgentFleetCard({ a, onChanged }: { a: any; onChanged?: () => void }) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const m = a.metrics ?? {};
  const spark = (a.spark ?? []).map((p: any) => p.v);
  const autonomy = a.autonomy_level >= 6 ? "High" : a.autonomy_level >= 4 ? "Medium" : "Low";
  const running = a.status === "running" || a.status === "queued";
  async function act(action: string) {
    try { await agentAct(a.id, action); toast(`${a.name}: ${action.replace("_", " ")}`, "up"); onChanged?.(); } catch (e: any) { toast(e.message, "down"); }
    setMenu(false);
  }
  return (
    <div className="surface surface-hover relative flex flex-col overflow-hidden rounded-2xl p-4">
      <svg aria-hidden viewBox="0 0 300 60" className="pointer-events-none absolute -right-8 -top-3 h-16 w-64 opacity-60" fill="none">
        {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M0 ${48 - i * 3} C 90 ${8 + i * 4}, 170 ${60 - i * 3}, 300 ${10 + i * 3}`} stroke="#d6b37a" strokeOpacity={0.12 + i * 0.06} strokeWidth={i === 2 ? 1 : 0.5} />)}
      </svg>
      <div className="relative flex items-start justify-between">
        <AgentAvatar agent={a} size={38} />
        <span className={cx("flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", running ? "border-up/30 bg-up-soft text-up" : "border-line-2 bg-panel-2 text-muted")}>
          <span className={cx("size-1.5 rounded-full", running ? "bg-up pulse-dot" : "bg-faint")} />{running ? "Running" : (a.status as string).replace("_", " ")}
        </span>
      </div>
      <Link href={`/agents/${a.id}`} className="relative mt-3 text-[1.08rem] font-semibold leading-tight hover:underline">{a.name}</Link>
      <p className="relative mt-1 line-clamp-2 min-h-[2.4rem] text-[12px] leading-snug text-muted">{a.instructions}</p>
      <dl className="relative mt-3 space-y-1.5 text-[12px]">
        <div className="flex justify-between"><dt className="flex items-center gap-1.5 text-muted"><Gauge className="size-3.5" /> Autonomy</dt><dd className="font-medium">{autonomy}</dd></div>
        <div className="flex justify-between"><dt className="flex items-center gap-1.5 text-muted"><Layers className="size-3.5" /> Assigned Capital</dt><dd className="num font-medium">{fmtUsd(m.capital, 0)}</dd></div>
        <div className="flex justify-between"><dt className="flex items-center gap-1.5 text-muted"><TrendingUp className="size-3.5" /> P&L (24h)</dt><dd className={cx("num font-medium", toneOf(m.pnl24h))}>{m.capital ? fmtPct((m.pnl24h / m.capital) * 100) : fmtSigned(m.pnl24h)}</dd></div>
      </dl>
      <AreaChart data={spark} height={40} className="relative mt-3" up={(m.pnl ?? 0) >= 0} />
      <div className="relative mt-2 border-t border-line pt-2 text-[11.5px]">
        <div className="flex justify-between text-muted"><span className="flex items-center gap-1.5"><Clock className="size-3.5" /> Last Action</span><span>{a.last_event_at ? ago(a.last_event_at) : "—"}</span></div>
        <div className="mt-1 line-clamp-1 text-text/90">{a.last_event ?? "Waiting to start"}</div>
      </div>
      <div className="relative mt-3 grid grid-cols-4 gap-1.5">
        <button onClick={() => act(running ? "pause" : a.status === "paused" ? "resume" : "start")} className="flex h-9 items-center justify-center rounded-lg border border-line-2 text-muted hover:text-text" title={running ? "Pause new entries" : "Start"}>{running ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
        <Link href={`/agents/${a.id}?tab=settings`} className="flex h-9 items-center justify-center rounded-lg border border-line-2 text-muted hover:text-text" title="Edit settings"><SlidersHorizontal className="size-4" /></Link>
        <Link href={`/agents/${a.id}?tab=log`} className="flex h-9 items-center justify-center rounded-lg border border-line-2 text-muted hover:text-text" title="Decision log"><FileText className="size-4" /></Link>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} className="flex h-9 w-full items-center justify-center rounded-lg border border-line-2 text-muted hover:text-text" title="More"><MoreHorizontal className="size-4" /></button>
          {menu && (
            <div className="absolute bottom-10 right-0 z-20 w-48 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => act("fork")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-panel-2"><Copy className="size-3.5" /> Duplicate (fork)</button>
              <button onClick={() => act("cancel_orders")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-panel-2"><XCircle className="size-3.5" /> Cancel open orders</button>
              <button onClick={() => { if (confirm(`Close all of ${a.name}'s positions at market?`)) act("close_positions"); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-panel-2"><LogOut className="size-3.5" /> Close positions</button>
              <button onClick={() => act("stop")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-panel-2"><Pause className="size-3.5" /> Stop</button>
              <button onClick={() => act("archive")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-down hover:bg-panel-2"><Archive className="size-3.5" /> Archive</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
