"use client";
import Link from "next/link";
import { use, useRef } from "react";
import { ArrowLeft, Play, Pause, OctagonX, LogOut, Archive, ShieldAlert, Bookmark, Copy, Check } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { Skeleton, cx, useToast } from "@/components/ui";
import { FleetGraph } from "@/components/agents/FleetGraph";
import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { AgentTile } from "@/components/agents/AgentCard";
import { FleetComposer } from "@/components/agents/FleetReview";
import { GhostButton, GoldButton, fmtPct, fmtSigned, fmtUsd, toneOf } from "@/components/agents/common";

export default function FleetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, refresh } = useApi<any>(`/api/agents/fleets/${id}`, { refreshMs: 20000 });
  const toast = useToast();
  const last = useRef(0);
  useRealtime((e) => { if (e.type === "agent" && Date.now() - last.current > 3000) { last.current = Date.now(); refresh(); } });
  if (!data) return <Skeleton className="h-[500px] rounded-2xl" />;
  const f = data.fleet, agents: any[] = data.agents;
  const pnl = agents.reduce((s, a) => s + a.metrics.pnl, 0), pnl24 = agents.reduce((s, a) => s + a.metrics.pnl24h, 0), cap = agents.reduce((s, a) => s + a.metrics.capital, 0);
  async function act(action: string, msg?: string) {
    if (msg && !confirm(msg)) return;
    try { const r: any = await api(`/api/agents/fleets/${id}`, { method: "POST", json: { action } }); toast(action === "deploy_collection" ? "Copy created: review and approve it" : action.replace("_", " "), "up"); if (action === "deploy_collection" && r?.fleet?.id) location.href = `/agents/fleets/${r.fleet.id}`; refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <div className="space-y-4">
      <Link href="/agents/fleets" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text"><ArrowLeft className="size-3.5" /> Fleet Builder</Link>
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-[1.9rem] font-semibold tracking-tight">{f.name}</h1><span className={cx("rounded-full px-2 py-0.5 text-xs", f.status === "running" ? "bg-up-soft text-up" : f.status === "risk_blocked" ? "bg-down-soft text-down" : f.status === "pending_approval" ? "bg-accent-soft text-accent-2" : "bg-panel-2 text-muted")}>{f.status.replace("_", " ")}</span><span className="rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">PAPER</span></div>
          <p className="mt-1 max-w-3xl text-sm text-muted">{f.prompt}</p>
          <p className="mt-1 text-xs text-muted"><span className="capitalize">{f.operation_mode}</span> · daily loss stop {Number(f.daily_loss_pct)}% · reserve {fmtUsd(Number(f.reserve_usd))}{f.stop_reason && <span className="text-down"> · {f.stop_reason}</span>}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {f.status === "pending_approval" && <GoldButton onClick={() => act("approve")}><Check className="size-4" /> Approve & start paper</GoldButton>}
          {f.status === "risk_blocked" && <GoldButton onClick={() => act("unblock", "Re-enable new orders after the loss limit? The limit stays active.")}><ShieldAlert className="size-4" /> Review & re-enable</GoldButton>}
          {f.status === "paused" && <GhostButton onClick={() => act("resume")}><Play className="size-4" /> Resume</GhostButton>}
          {f.status === "running" && <GhostButton onClick={() => act("pause")}><Pause className="size-4" /> Pause new entries</GhostButton>}
          <GhostButton onClick={() => act("emergency_stop", "Emergency stop: disable new orders and cancel pending orders for every agent in this fleet? Open positions stay open.")} className="text-down"><OctagonX className="size-4" /> Emergency stop</GhostButton>
          <GhostButton onClick={() => act("close_positions", "Close every position held by this fleet at market?")}><LogOut className="size-4" /> Close positions</GhostButton>
          <GhostButton onClick={() => act(f.is_collection ? "deploy_collection" : "save_collection")}>{f.is_collection ? <><Copy className="size-4" /> Deploy copy</> : <><Bookmark className="size-4" /> Save as collection</>}</GhostButton>
          <GhostButton onClick={() => act("archive", "Archive this fleet and all its agents?")}><Archive className="size-4" /></GhostButton>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Agents", `${agents.filter((a) => a.status === "running").length} running / ${agents.length}`], ["Capital", fmtUsd(cap, 0)], ["P&L", <span key="p" className={toneOf(pnl)}>{fmtSigned(pnl)}</span>], ["Daily P&L", <span key="d" className={toneOf(pnl24)}>{fmtSigned(pnl24)} ({cap ? fmtPct((pnl24 / cap) * 100) : "—"})</span>]].map(([k, v]) => <div key={k as string} className="surface rounded-xl px-3.5 py-2.5"><div className="text-[11px] text-muted">{k}</div><div className="num mt-1 text-[1.15rem] font-semibold">{v}</div></div>)}
      </div>
      <section className="surface rounded-2xl p-4"><h3 className="mb-3 text-sm font-semibold">Workflow</h3><FleetGraph agents={agents} edges={f.graph?.edges ?? []} /></section>
      <FleetComposer compact fleetId={id} placeholder="Instruct this fleet… (e.g. “pause”, “focus on lower-volatility entries today”)" />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="grid gap-3 md:grid-cols-2">{agents.map((a) => <Link key={a.id} href={`/agents/${a.id}`}><AgentTile a={a} /></Link>)}</div>
        <ActivityFeed fleetId={id} className="h-[600px]" title="Fleet activity" />
      </div>
      {data.competition && <Link href="/agents/arena" className="surface block rounded-2xl p-4 text-sm">This fleet is an Arena competition ({data.competition.days} days, {fmtUsd(Number(data.competition.capital_each_usd), 0)} each). <span className="text-accent-2">Open the leaderboard →</span></Link>}
    </div>
  );
}
