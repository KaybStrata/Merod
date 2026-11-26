"use client";
import Link from "next/link";
import { use, useMemo, useRef, useState } from "react";
import { ArrowLeft, Play, Pause, OctagonX, LogOut, Archive, ShieldAlert, Bookmark, Copy, Check, Settings2, ScrollText, ExternalLink, Network, Rows3 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, usePageTitle } from "@/components/shell/context";
import { Skeleton, cx, useToast } from "@/components/ui";
import { FleetGraph } from "@/components/agents/FleetGraph";
import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { AgentTile } from "@/components/agents/AgentCard";
import { FleetComposer } from "@/components/agents/FleetReview";
import { AgentAvatar, AreaChart, KindBadge, StatusDot, fmtPct, fmtSigned, fmtUsd, toneOf, clock } from "@/components/agents/common";

/** Fleet detail (design 04): agent graph canvas, right inspector, bottom stats strip with controls. */
export default function FleetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, refresh } = useApi<any>(`/api/agents/fleets/${id}`, { refreshMs: 20000 });
  const ev = useApi<any>(`/api/agents/events?fleet=${id}&limit=200`, { refreshMs: 20000 });
  const toast = useToast();
  const last = useRef(0);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  useRealtime((e) => { if (e.type === "agent" && Date.now() - last.current > 3000) { last.current = Date.now(); refresh(); ev.refresh(); } });
  const f = data?.fleet, agents: any[] = data?.agents ?? [];
  usePageTitle(f ? { section: "Automate · Agents · Fleet", title: `Fleet ${f.name}`, accent: f.name } : { section: "Automate · Agents", title: "Fleet" }, [f?.name]);
  const events: any[] = ev.data?.events ?? [];
  const stats = useMemo(() => {
    const cap = agents.reduce((s, a) => s + a.metrics.capital, 0);
    const pnl = agents.reduce((s, a) => s + a.metrics.pnl, 0), pnl24 = agents.reduce((s, a) => s + a.metrics.pnl24h, 0);
    const open = agents.reduce((s, a) => s + (a.metrics.positions ?? 0), 0);
    const closers = agents.filter((a) => a.metrics.winRate != null);
    const win = closers.length ? closers.reduce((s, a) => s + a.metrics.winRate, 0) / closers.length : null;
    const hour = Date.now() - 3600_000;
    const decisionsHr = events.filter((e) => e.kind === "decision" && +new Date(e.created_at) > hour).length;
    // Latency: time from a decision to the execution that shares its correlation id.
    const dec = new Map(events.filter((e) => e.kind === "decision" && e.correlation_id).map((e) => [e.correlation_id, +new Date(e.created_at)]));
    const lat = events.filter((e) => e.kind === "execution" && e.correlation_id && dec.has(e.correlation_id)).map((e) => +new Date(e.created_at) - dec.get(e.correlation_id)!).filter((x) => x >= 0);
    const avgLat = lat.length ? lat.reduce((s, x) => s + x, 0) / lat.length : null;
    return { cap, pnl, pnl24, open, win, decisionsHr, avgLat };
  }, [agents, events]);
  if (!data) return <Skeleton className="h-[600px] rounded-2xl" />;
  const selected = agents.find((a) => a.id === sel) ?? null;

  async function act(action: string, msg?: string) {
    if (msg && !confirm(msg)) return;
    try { const r: any = await api(`/api/agents/fleets/${id}`, { method: "POST", json: { action } }); toast(action === "deploy_collection" ? "Copy created: review and approve it" : action.replace("_", " "), "up"); if (action === "deploy_collection" && r?.fleet?.id) location.href = `/agents/fleets/${r.fleet.id}`; refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  async function agentAct(a: any, action: string) {
    try { await api(`/api/agents/${a.id}/actions`, { method: "POST", json: { action } }); toast(`${a.name}: ${action}`, "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  const running = agents.filter((a) => a.status === "running").length;
  const statusCls = f.status === "running" ? "border-up/30 bg-up-soft text-up" : f.status === "risk_blocked" ? "border-down/30 bg-down-soft text-down" : f.status === "pending_approval" ? "border-accent/30 bg-accent-soft text-accent-2" : "border-line-2 bg-panel-2 text-muted";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/agents/fleets" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-text"><ArrowLeft className="size-3.5" /> Fleets</Link>
        <span className={cx("rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", statusCls)}>{f.status.replace("_", " ")}</span>
        <span className="rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">PAPER</span>
        <span className="text-[12px] text-muted">{running} / {agents.length} agents live · <span className="capitalize">{f.operation_mode}</span> · loss stop {Number(f.daily_loss_pct)}% · reserve {fmtUsd(Number(f.reserve_usd), 0)}</span>
        {f.stop_reason && <span className="text-[12px] text-down">{f.stop_reason}</span>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {f.status === "pending_approval" && <Btn gold onClick={() => act("approve")}><Check className="size-3.5" /> Approve & start paper</Btn>}
          {f.status === "risk_blocked" && <Btn gold onClick={() => act("unblock", "Re-enable new orders after the loss limit? The limit stays active.")}><ShieldAlert className="size-3.5" /> Review & re-enable</Btn>}
          <Btn onClick={() => act(f.is_collection ? "deploy_collection" : "save_collection")}>{f.is_collection ? <><Copy className="size-3.5" /> Deploy copy</> : <><Bookmark className="size-3.5" /> Save as collection</>}</Btn>
          <Btn onClick={() => act("close_positions", "Close every position held by this fleet at market?")}><LogOut className="size-3.5" /> Close positions</Btn>
          <Btn danger onClick={() => act("emergency_stop", "Emergency stop: disable new orders and cancel pending orders for every agent in this fleet? Open positions stay open.")}><OctagonX className="size-3.5" /> Emergency stop</Btn>
          <Btn onClick={() => act("archive", "Archive this fleet and all its agents?")} title="Archive"><Archive className="size-3.5" /></Btn>
        </div>
      </div>
      {f.prompt && <p className="max-w-4xl text-[12.5px] text-muted">“{f.prompt}”</p>}

      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        <section className="surface flex min-h-[520px] flex-col rounded-2xl">
          <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <h3 className="text-[13px] font-semibold">Workflow</h3>
            <span className="text-[11px] text-faint">{agents.length} agents · {(f.graph?.edges ?? []).length || "auto"} links</span>
            <div className="ml-auto flex gap-0.5 rounded-lg border border-line p-0.5">
              <button onClick={() => setView("graph")} className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-[11px]", view === "graph" ? "nav-active" : "text-muted")}><Network className="size-3.5" /> Graph</button>
              <button onClick={() => setView("list")} className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-[11px]", view === "list" ? "nav-active" : "text-muted")}><Rows3 className="size-3.5" /> Agents</button>
            </div>
          </header>
          {view === "graph"
            ? <FleetGraph agents={agents} edges={f.graph?.edges ?? []} selected={sel} onSelect={(x) => setSel(sel === x ? null : x)} className="m-2 flex-1" />
            : <div className="grid flex-1 content-start gap-2.5 p-3 md:grid-cols-2">{agents.map((a) => <Link key={a.id} href={`/agents/${a.id}`}><AgentTile a={a} /></Link>)}</div>}
          <div className="border-t border-line p-2.5"><FleetComposer compact fleetId={id} placeholder="Instruct this fleet… (e.g. “pause”, “focus on lower-volatility entries today”)" /></div>
        </section>

        <aside className="surface flex flex-col rounded-2xl">
          {selected ? <AgentInspector a={selected} events={events.filter((e) => e.agent_id === selected.id)} onAct={(x) => agentAct(selected, x)} onClose={() => setSel(null)} /> : (
            <div className="p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Fleet capital</div>
              <div className="num mt-1 text-[1.6rem] font-semibold leading-none">{fmtUsd(stats.cap, 0)}</div>
              <div className={cx("num mt-1 text-[12px]", toneOf(stats.pnl))}>{fmtSigned(stats.pnl)} all time · <span className={toneOf(stats.pnl24)}>{fmtSigned(stats.pnl24)} today</span></div>
              <AreaChart data={equitySeries(agents)} height={60} className="mt-2" up={stats.pnl >= 0} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Mini k="Win rate" v={stats.win == null ? "—" : `${stats.win.toFixed(1)}%`} />
                <Mini k="Open positions" v={String(stats.open)} />
                <Mini k="Trades 24h" v={String(agents.reduce((s, a) => s + (a.metrics.trades24h ?? 0), 0))} />
                <Mini k="Fees paid" v={fmtUsd(agents.reduce((s, a) => s + (a.metrics.fees ?? 0), 0))} />
              </div>
            </div>
          )}
          {!selected && (
            <div className="border-t border-line p-3.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Agents · tap a node to inspect</div>
              <ul className="space-y-0.5">
                {agents.map((a) => {
                  const on = a.status === "running" || a.status === "queued";
                  const canToggle = on || a.status === "paused";
                  return (
                    <li key={a.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-panel-2">
                      <button onClick={() => setSel(a.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <AgentAvatar agent={a} size={22} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{a.name}</span>
                        <span className={cx("num text-[11px]", toneOf(a.metrics.pnl))}>{fmtSigned(a.metrics.pnl, 0)}</span>
                      </button>
                      <Toggle on={on} disabled={!canToggle} title={canToggle ? (on ? "Pause new entries" : "Resume") : a.status.replace("_", " ")} onChange={() => agentAct(a, on ? "pause" : "resume")} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!selected && (
            <div className="min-h-0 flex-1 border-t border-line p-3.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Recent decisions</div>
              <ul className="space-y-1.5">
                {events.filter((e) => e.kind === "decision" || e.kind === "execution").slice(0, 7).map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-[11.5px]"><span className="num shrink-0 pt-px text-[10.5px] text-faint">{clock(e.created_at).slice(0, 5)}</span><KindBadge kind={e.kind} /><span className="line-clamp-2 flex-1">{e.title}</span></li>
                ))}
                {!events.some((e) => e.kind === "decision" || e.kind === "execution") && <li className="text-[12px] text-muted">No decisions yet. They appear here as agents run.</li>}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <div className="surface flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl px-4 py-3">
        <Stat k="Fleet capital" v={fmtUsd(stats.cap, 0)} />
        <Stat k="Today P&L" v={<span className={toneOf(stats.pnl24)}>{fmtSigned(stats.pnl24)} <span className="text-[11px]">{stats.cap ? fmtPct((stats.pnl24 / stats.cap) * 100) : ""}</span></span>} />
        <Stat k="Open positions" v={String(stats.open)} />
        <Stat k="Decisions / hr" v={String(stats.decisionsHr)} />
        <Stat k="Win rate" v={stats.win == null ? "—" : `${stats.win.toFixed(1)}%`} />
        <Stat k="Avg latency" v={stats.avgLat == null ? "—" : stats.avgLat < 1000 ? `${Math.round(stats.avgLat)}ms` : `${(stats.avgLat / 1000).toFixed(1)}s`} />
        <div className="ml-auto flex gap-1.5">
          {f.status === "running" && <Btn onClick={() => act("pause")}><Pause className="size-3.5" /> Pause</Btn>}
          {f.status === "paused" && <Btn gold onClick={() => act("resume")}><Play className="size-3.5" /> Resume</Btn>}
          <Link href={agents[0] ? `/agents/${agents[0].id}` : "/agents"}><Btn><Settings2 className="size-3.5" /> Configure</Btn></Link>
          <a href="#fleet-logs"><Btn><ScrollText className="size-3.5" /> Logs</Btn></a>
        </div>
      </div>

      <div id="fleet-logs"><ActivityFeed fleetId={id} className="h-[520px]" title="Fleet logs" /></div>
      {data.competition && <Link href="/agents/arena" className="surface block rounded-2xl p-3.5 text-[13px]">This fleet is an Arena competition ({data.competition.days} days, {fmtUsd(Number(data.competition.capital_each_usd), 0)} each). <span className="text-accent-2">Open the leaderboard →</span></Link>}
    </div>
  );
}

/** Fleet equity: sum of member snapshots when present, else current capital + P&L. */
function equitySeries(agents: any[]) {
  const series = agents.map((a) => (a.spark ?? []).map((p: any) => p.v)).filter((s: number[]) => s.length > 1);
  if (!series.length) return [];
  const n = Math.min(...series.map((s: number[]) => s.length));
  return Array.from({ length: n }, (_, i) => series.reduce((t: number, s: number[]) => t + s[s.length - n + i], 0));
}

function AgentInspector({ a, events, onAct, onClose }: { a: any; events: any[]; onAct: (action: string) => void; onClose: () => void }) {
  const m = a.metrics;
  const on = a.status === "running" || a.status === "queued";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line p-3.5">
        <AgentAvatar agent={a} size={34} />
        <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold">{a.name}</div><div className="flex items-center gap-2 text-[11px] text-muted"><span className="truncate">{a.roleName}</span><StatusDot status={a.status} /></div></div>
        <button onClick={onClose} className="text-[11px] text-muted hover:text-text">Fleet</button>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3.5">
        <Mini k="Capital" v={fmtUsd(m.capital, 0)} />
        <Mini k="P&L" v={<span className={toneOf(m.pnl)}>{fmtSigned(m.pnl)}</span>} />
        <Mini k="Win rate" v={m.winRate == null ? "—" : `${m.winRate.toFixed(1)}%`} />
        <Mini k="Positions" v={String(m.positions ?? 0)} />
        <Mini k="Trades" v={String(m.trades ?? 0)} />
        <Mini k="Approvals" v={String(m.pendingApprovals ?? 0)} />
      </div>
      <div className="space-y-1.5 border-t border-line p-3.5 text-[12px]">
        <Row k="Running" v={<Toggle on={on} disabled={!(on || a.status === "paused")} onChange={() => onAct(on ? "pause" : "resume")} />} />
        <Row k="Autonomy" v={`Level ${a.autonomy_level}`} />
        <Row k="Model" v={a.routedModel ?? a.model ?? "—"} />
        <Row k="Assets" v={(a.symbols ?? []).slice(0, 4).join(", ") || "Scanner"} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-3.5">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Recent decisions</div>
        <ul className="space-y-1.5">
          {events.slice(0, 8).map((e) => <li key={e.id} className="flex items-start gap-2 text-[11.5px]"><span className="num shrink-0 pt-px text-[10.5px] text-faint">{clock(e.created_at).slice(0, 5)}</span><KindBadge kind={e.kind} /><span className="line-clamp-2 flex-1">{e.title}</span></li>)}
          {!events.length && <li className="text-[12px] text-muted">Nothing yet from this agent.</li>}
        </ul>
      </div>
      <div className="flex gap-1.5 border-t border-line p-3"><Link href={`/agents/${a.id}`} className="flex-1"><Btn className="w-full"><ExternalLink className="size-3.5" /> Open agent</Btn></Link></div>
    </div>
  );
}

function Btn({ children, gold, danger, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { gold?: boolean; danger?: boolean }) {
  return <button {...p} className={cx("inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium disabled:opacity-50", gold ? "bg-grad font-semibold text-bg" : danger ? "border border-down/40 text-down hover:bg-down-soft" : "border border-line-2 bg-panel/60 hover:border-accent/50", className)}>{children}</button>;
}
function Toggle({ on, onChange, disabled, title }: { on: boolean; onChange: () => void; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onChange} disabled={disabled} title={title} aria-pressed={on} className={cx("relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40", on ? "bg-up" : "bg-line-2")}>
      <span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-[14px]" : "left-0.5")} />
    </button>
  );
}
function Mini({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="rounded-lg border border-line bg-bg-2/60 px-2.5 py-2"><div className="text-[10px] text-faint">{k}</div><div className="num mt-0.5 text-[13.5px] font-semibold">{v}</div></div>;
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted">{k}</span><span className="truncate text-right">{v}</span></div>;
}
function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{k}</div><div className="num mt-0.5 text-[15px] font-semibold">{v}</div></div>;
}
