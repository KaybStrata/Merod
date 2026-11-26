"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Users, Zap, BarChart3, Target, Layers, Info, ArrowRight, Bell, CheckCircle2, AlertTriangle, Play, Pause, Check, Copy, Rocket, Grid2x2, List, ChevronDown, PlayCircle, Activity } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { Empty, Skeleton, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { FleetComposer } from "@/components/agents/FleetReview";
import { AgentFleetCard, AgentTile } from "@/components/agents/AgentCard";
import { AreaChart, Ring, fmtPct, fmtSigned, toneOf } from "@/components/agents/common";

/** Merod Agents Command Center: create, direct and monitor a fleet of prompted agents. */
export default function CommandCenter() {
  const { data, refresh, loading } = useApi<any>("/api/agents", { refreshMs: 20000 });
  const fleets = useApi<any>("/api/agents/fleets", { refreshMs: 30000 });
  const last = useRef(0);
  useRealtime((e) => { if (e.type === "agent" && Date.now() - last.current > 3000) { last.current = Date.now(); refresh(); } });
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "running" | "paused" | "approval">("all");
  const [sort, setSort] = useState<"performance" | "newest" | "name">("performance");
  const [view, setView] = useState<"grid" | "list">("grid");
  const agents: any[] = data?.agents ?? [];
  const events: any[] = data?.events ?? [];
  const running = agents.filter((a) => a.status === "running" || a.status === "queued");
  const paused = agents.filter((a) => a.status === "paused");
  const needsApproval = agents.filter((a) => a.status === "pending_approval" || a.metrics?.pendingApprovals > 0);
  const capital = agents.reduce((s, a) => s + (a.metrics?.capital ?? 0), 0);
  const pnl = agents.reduce((s, a) => s + (a.metrics?.pnl ?? 0), 0);
  const pnl24 = agents.reduce((s, a) => s + (a.metrics?.pnl24h ?? 0), 0);
  const closes = agents.filter((a) => a.metrics?.winRate != null);
  const winRate = closes.length ? closes.reduce((s, a) => s + a.metrics.winRate, 0) / closes.length : null;
  const failed = agents.filter((a) => a.status === "failed" || a.status === "risk_blocked");
  const combinedSpark = useMemo(() => {
    const series = agents.map((a) => (a.spark ?? []).map((p: any) => p.v)).filter((s) => s.length > 1);
    if (!series.length) return [];
    const n = Math.min(...series.map((s) => s.length));
    return Array.from({ length: n }, (_, i) => series.reduce((t, s) => t + s[s.length - n + i], 0));
  }, [agents]);
  const shown = agents
    .filter((a) => filter === "all" || (filter === "running" ? running.includes(a) : filter === "paused" ? paused.includes(a) : needsApproval.includes(a)))
    .sort((a, b) => sort === "performance" ? (b.metrics?.pnlPct ?? 0) - (a.metrics?.pnlPct ?? 0) : sort === "name" ? a.name.localeCompare(b.name) : +new Date(b.created_at) - +new Date(a.created_at));
  const uptime = agents.length ? ((agents.length - failed.length) / agents.length) * 100 : 100;
  const recentExec = events.filter((e) => e.kind === "execution" || e.kind === "warning").length;
  const execOk = events.filter((e) => e.kind === "execution").length;
  const successRate = recentExec ? (execOk / recentExec) * 100 : 100;
  const utilisation = capital > 0 ? (agents.reduce((s, a) => s + (a.metrics?.invested ?? 0), 0) / capital) * 100 : 0;

  async function fleetControl(action: "run" | "pause" | "approve" | "clone" | "deploy") {
    try {
      if (action === "run") { for (const a of agents.filter((x) => ["configured", "paused", "completed", "draft"].includes(x.status))) await api(`/api/agents/${a.id}/actions`, { method: "POST", json: { action: a.status === "paused" ? "resume" : "start" } }); toast("All stopped agents started (paper)", "up"); }
      if (action === "pause") { for (const a of running) await api(`/api/agents/${a.id}/actions`, { method: "POST", json: { action: "pause" } }); toast(`Paused ${running.length} agents (new entries off; positions kept)`, "neutral"); }
      if (action === "approve") {
        const pending = (fleets.data?.fleets ?? []).filter((f: any) => f.status === "pending_approval");
        for (const f of pending) await api(`/api/agents/fleets/${f.id}`, { method: "POST", json: { action: "approve" } });
        for (const a of agents.filter((x) => x.status === "pending_approval" && !x.fleet_id)) await api(`/api/agents/${a.id}/actions`, { method: "POST", json: { action: "approve" } });
        toast(pending.length ? `Approved ${pending.length} fleet${pending.length === 1 ? "" : "s"}` : "Nothing waiting for approval. Order approvals are on Portfolio.", "up");
      }
      if (action === "clone") { const f = (fleets.data?.fleets ?? [])[0]; if (!f) { toast("No fleet to clone yet", "neutral"); return; } await api(`/api/agents/fleets/${f.id}`, { method: "POST", json: { action: "deploy_collection" } }); toast(`Cloned "${f.name}" (waiting for approval)`, "up"); }
      if (action === "deploy") { const f = (fleets.data?.fleets ?? []).find((x: any) => x.status === "pending_approval"); if (!f) { toast("No fleet waiting to deploy. Create one with the prompt above.", "neutral"); return; } await api(`/api/agents/fleets/${f.id}`, { method: "POST", json: { action: "approve" } }); toast(`Deployed "${f.name}" in paper`, "up"); }
      refresh(); fleets.refresh();
    } catch (e: any) { toast(e.message, "down"); }
  }

  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[280px] w-[70%] opacity-90" />
      <div className="relative z-10">
        <div className="eyebrow mb-3">Merod Agents Command Center</div>
        <h1 className="text-[2.4rem] font-semibold leading-tight tracking-tight sm:text-[3rem]">Agents <span className="serif-accent text-[1.12em]">Command Center</span></h1>
        <p className="mt-2 max-w-3xl text-[1.1rem] text-muted">Create, direct, and monitor a fleet of prompted agents that research, trade, and manage your portfolio in parallel.</p>
        <FleetComposer className="mt-6" />

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={Users} label="Active Agents" value={String(agents.length)} sub="In fleet" deco={<Layers className="size-14 text-line-2" strokeWidth={1} />} />
          <Tile icon={Zap} label="Running" value={`${running.length} / ${agents.length}`} sub={failed.length ? `${failed.length} need attention` : "All agents operational"} deco={<div className="flex h-12 items-end gap-1">{[3, 5, 8, 11].map((h, i) => <span key={i} className="w-1.5 rounded-sm bg-gradient-to-t from-[#6b5532] to-[#d6b37a]" style={{ height: h * 4 }} />)}</div>} />
          <Tile icon={BarChart3} label="Combined P&L" value={<span className={toneOf(pnl)}>{fmtSigned(pnl)}</span>} sub={<span className={toneOf(pnl24)}>{capital ? fmtPct((pnl24 / capital) * 100) : "—"} (24h)</span>} deco={<AreaChart data={combinedSpark} height={44} className="w-28" up={pnl >= 0} />} />
          <Tile icon={Target} label="Fleet Win Rate" value={winRate == null ? "—" : `${winRate.toFixed(1)}%`} sub={`${closes.length} agent${closes.length === 1 ? "" : "s"} with closed trades`} deco={<Ring pct={winRate ?? 0} size={52} stroke={5} />} />
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-[1.2rem] font-semibold"><Layers className="size-5" /> Agent Fleet ({agents.length})</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl border border-line bg-panel/60 p-1 text-[12px]">
              {([["all", `All (${agents.length})`], ["running", `Running (${running.length})`], ["paused", `Paused (${paused.length})`], ["approval", `Needs Approval (${needsApproval.length})`]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={cx("rounded-lg px-3 py-1.5", filter === k ? "nav-active" : "text-muted hover:text-text")}>{l}</button>
              ))}
            </div>
            <label className="relative flex items-center text-[12px] text-muted">Sort:
              <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="ml-1 appearance-none bg-transparent pr-5 font-medium text-text outline-none"><option value="performance">Performance</option><option value="newest">Newest</option><option value="name">Name</option></select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3.5" />
            </label>
            <div className="flex gap-1 rounded-xl border border-line bg-panel/60 p-1">
              <button onClick={() => setView("grid")} className={cx("rounded-lg p-1.5", view === "grid" ? "nav-active" : "text-muted")} aria-label="Grid"><Grid2x2 className="size-4" /></button>
              <button onClick={() => setView("list")} className={cx("rounded-lg p-1.5", view === "list" ? "nav-active" : "text-muted")} aria-label="List"><List className="size-4" /></button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 2xl:grid-cols-[1fr_330px]">
          <div>
            {loading && !data ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-80" /><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
              : !shown.length ? <Empty icon={<Users className="size-6" />} title={agents.length ? "No agents match this filter" : "No agents yet"}>Describe a fleet in the prompt above, or <Link href="/agents/new" className="text-accent-2 underline">create one agent</Link>, or install a template from the <Link href="/agents/marketplace" className="text-accent-2 underline">Marketplace</Link>.</Empty>
              : view === "grid"
                ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-5">{shown.map((a) => <AgentFleetCard key={a.id} a={a} onChanged={refresh} />)}</div>
                : <div className="grid gap-3 lg:grid-cols-2">{shown.map((a) => <Link key={a.id} href={`/agents/${a.id}`}><AgentTile a={a} /></Link>)}</div>}
          </div>
          <aside className="space-y-4">
            <section className="surface rounded-2xl p-4">
              <header className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[15px] font-semibold"><Activity className="size-4 text-accent-2" /> Fleet Health</h3><span title="Computed from agent statuses and recent executions"><Info className="size-4 text-muted" /></span></header>
              <div className="mt-3 flex items-center gap-3">
                {failed.length ? <AlertTriangle className="size-9 text-warn" /> : <CheckCircle2 className="size-9 text-up" />}
                <div><div className="text-[1.3rem] font-semibold">{failed.length ? "Needs attention" : "Healthy"}</div><div className={cx("text-xs", failed.length ? "text-warn" : "text-up")}>{agents.length - failed.length} / {agents.length} agents running normally</div></div>
              </div>
              <div className="mt-4 space-y-2.5 text-[12px]">
                <Meter label="Uptime (agents OK)" value={uptime} text={`${uptime.toFixed(1)}%`} />
                <Meter label="Task Success Rate" value={successRate} text={`${successRate.toFixed(1)}%`} />
                <Meter label="Capital Utilization" value={utilisation} text={`${utilisation.toFixed(1)}%`} />
              </div>
            </section>
            <section className="surface rounded-2xl p-4">
              <header className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[15px] font-semibold"><Bell className="size-4" /> System Alerts</h3><Link href="/agents/workspace" className="flex items-center gap-1 text-[11px] text-muted hover:text-text">All Alerts <ArrowRight className="size-3" /></Link></header>
              <ul className="mt-2 space-y-1">
                {failed.length === 0 && <li className="flex items-center gap-2.5 py-1.5 text-[12.5px]"><CheckCircle2 className="size-4 text-up" /><span className="flex-1">All agents operating normally</span><span className="text-[10px] text-faint">Now</span></li>}
                {events.filter((e) => e.kind === "warning" || e.kind === "approval" || e.kind === "training").slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-start gap-2.5 py-1.5 text-[12.5px]">{e.kind === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" />}<span className="line-clamp-2 flex-1">{e.title}</span><span className="shrink-0 text-[10px] text-faint">{ago(e.created_at)}</span></li>
                ))}
              </ul>
            </section>
            <section className="surface rounded-2xl p-4">
              <h3 className="text-[15px] font-semibold">Fleets</h3>
              <ul className="mt-2 space-y-1.5">
                {(fleets.data?.fleets ?? []).slice(0, 6).map((f: any) => (
                  <li key={f.id}><Link href={`/agents/fleets/${f.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-[12.5px] hover:bg-panel-2"><span className="truncate font-medium">{f.name}</span><span className={cx("shrink-0 text-[11px]", f.status === "running" ? "text-up" : f.status === "risk_blocked" ? "text-down" : "text-muted")}>{f.status.replace("_", " ")} · {f.agents}</span></Link></li>
                ))}
                {!(fleets.data?.fleets ?? []).length && <li className="text-[12px] text-muted">One prompt can create a whole fleet. Try the examples under the {"</>"} button.</li>}
              </ul>
            </section>
          </aside>
        </div>

        <div className="surface mt-5 flex flex-wrap items-center gap-3 rounded-2xl p-3">
          <div className="flex items-center gap-3 pr-4 sm:border-r sm:border-line"><PlayCircle className="size-6 text-muted" /><div><div className="text-[15px] font-semibold">Fleet Controls</div><div className="text-[11px] text-muted">Run actions across your agent fleet</div></div></div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
            <button onClick={() => fleetControl("run")} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-grad text-sm font-semibold"><Play className="size-4" /> Run</button>
            <button onClick={() => fleetControl("pause")} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-2 text-sm hover:border-accent/40"><Pause className="size-4" /> Pause</button>
            <button onClick={() => fleetControl("approve")} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-2 text-sm hover:border-accent/40"><Check className="size-4" /> Approve</button>
            <button onClick={() => fleetControl("clone")} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-2 text-sm hover:border-accent/40"><Copy className="size-4" /> Clone</button>
            <button onClick={() => fleetControl("deploy")} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-2 text-sm hover:border-accent/40"><Rocket className="size-4" /> Deploy</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, deco }: { icon: any; label: string; value: React.ReactNode; sub: React.ReactNode; deco?: React.ReactNode }) {
  return (
    <div className="surface flex items-center justify-between gap-3 rounded-2xl p-4">
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-5 text-muted" strokeWidth={1.6} />
        <div><div className="text-[13px] text-text/90">{label}</div><div className="num mt-1 text-[1.55rem] font-semibold leading-none">{value}</div><div className="mt-1.5 text-[11.5px] text-muted">{sub}</div></div>
      </div>
      {deco}
    </div>
  );
}
function Meter({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <div className="flex items-center gap-3"><span className="w-36 shrink-0 text-muted">{label}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-up" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span><span className="num w-12 text-right">{text}</span></div>
  );
}
