"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Users, Swords, Brain, BarChart3, FileText, Grid2x2, List, Plus, UserPlus, GitBranch, CalendarClock, MoreHorizontal, Zap, Shield, Database, Save } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { Empty, Modal, Skeleton, cx, useToast } from "@/components/ui";
import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { AgentTile } from "@/components/agents/AgentCard";
import { LiveExecution } from "@/components/agents/LiveExecution";
import { FleetComposer } from "@/components/agents/FleetReview";
import { Ring, fmtPct, fmtSigned, fmtUsd, toneOf } from "@/components/agents/common";

type Tab = "agents" | "fleet" | "arena" | "training" | "performance" | "logs";

/** Agent Workspace (spec §03 / screen 1): grid of agents, per-agent live execution, scoped prompts, saved layouts. */
export default function Workspace() {
  const { data, refresh, loading } = useApi<any>("/api/agents", { refreshMs: 20000 });
  const cap = useApi<any>("/api/agents/capital", { refreshMs: 30000 });
  const fleets = useApi<any>("/api/agents/fleets", { refreshMs: 30000 });
  const arena = useApi<any>("/api/agents/arena");
  const training = useApi<any>("/api/agents/training");
  const layouts = useApi<any>("/api/agents/layouts");
  const toast = useToast();
  const last = useRef(0);
  useRealtime((e) => { if (e.type === "agent" && Date.now() - last.current > 3000) { last.current = Date.now(); refresh(); } });
  const [tab, setTab] = useState<Tab>("agents");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [schedule, setSchedule] = useState(false);
  const [more, setMore] = useState(false);
  const agents: any[] = useMemo(() => {
    const list: any[] = data?.agents ?? [];
    if (!order.length) return list;
    return [...list].sort((a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9));
  }, [data, order]);
  useEffect(() => { if (!selected && agents.length) setSelected((agents.find((a) => a.status === "running" && a.metrics?.capital > 0) ?? agents[0]).id); }, [agents, selected]);
  // Restore the "Default" saved layout once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !layouts.data) return; restored.current = true;
    const l = layouts.data.layouts?.find((x: any) => x.name === "Default")?.layout;
    if (l) { setView(l.view); setOrder(l.order ?? []); if (l.selected) setSelected(l.selected); if (l.tab) setTab(l.tab); }
  }, [layouts.data]);
  const running = agents.filter((a) => a.status === "running" || a.status === "queued");
  const pnl24 = agents.reduce((s, a) => s + (a.metrics?.pnl24h ?? 0), 0);
  const capital = agents.reduce((s, a) => s + (a.metrics?.capital ?? 0), 0);
  const trades24 = agents.reduce((s, a) => s + (a.metrics?.trades24h ?? 0), 0);
  const blocked = agents.some((a) => a.status === "risk_blocked");
  const dragId = useRef<string | null>(null);
  const onDrop = (target: string) => {
    const ids = agents.map((a) => a.id), from = ids.indexOf(dragId.current ?? ""), to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]); setOrder(ids);
  };
  async function saveLayout() {
    try { await api("/api/agents/layouts", { method: "POST", json: { name: "Default", layout: { view, order: agents.map((a) => a.id), selected, tab } } }); toast("Layout saved", "up"); layouts.refresh(); } catch (e: any) { toast(e.message, "down"); }
  }
  const TABS: [Tab, string, any, number?][] = [["agents", "My Agents", Bot, agents.length], ["fleet", "Agent Fleet", Users], ["arena", "Agent Arena", Swords], ["training", "Auto-Training", Brain], ["performance", "Performance", BarChart3], ["logs", "Logs", FileText]];

  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[2.1rem] font-semibold tracking-tight">Agent Workspace</h1>
            <p className="text-[1.02rem] text-muted">Create, deploy, and run multiple AI trading agents in parallel.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Total P&L (24h)" value={<span className={toneOf(pnl24)}>{fmtSigned(pnl24)}</span>} chip={capital ? <span className={cx("text-[11px]", toneOf(pnl24))}>{fmtPct((pnl24 / capital) * 100)}</span> : null} />
            <Stat label="Active Agents" value={`${running.length} / ${agents.length}`} />
            <Stat label="Total Capital" value={fmtUsd(cap.data?.total, 0)} />
            <Stat label="Allocated" value={fmtUsd(cap.data?.allocated, 0)} chip={<span className="flex items-center gap-1.5 text-[11px] text-up">{(cap.data?.allocatedPct ?? 0).toFixed(0)}% <Ring pct={cap.data?.allocatedPct ?? 0} size={26} stroke={3} /></span>} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-panel/60 p-1">
            {TABS.map(([k, l, I, n]) => (
              <button key={k} onClick={() => setTab(k)} className={cx("flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px]", tab === k ? "nav-active" : "text-muted hover:text-text")}>
                <I className="size-4" />{l}{n != null && <span className="rounded-full bg-grad px-1.5 text-[10px] font-bold">{n}</span>}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex gap-1 rounded-xl border border-line bg-panel/60 p-1">
              <button onClick={() => setView("grid")} className={cx("rounded-lg p-1.5", view === "grid" ? "nav-active" : "text-muted")} aria-label="Grid view"><Grid2x2 className="size-4" /></button>
              <button onClick={() => setView("list")} className={cx("rounded-lg p-1.5", view === "list" ? "nav-active" : "text-muted")} aria-label="List view"><List className="size-4" /></button>
            </div>
            <button onClick={saveLayout} className="flex h-10 items-center gap-1.5 rounded-xl border border-line-2 px-3 text-xs text-muted hover:text-text" title="Save layout (order, view, selected agent)"><Save className="size-4" /> Save layout</button>
            <Link href="/agents/new" className="flex h-10 items-center gap-2 rounded-xl bg-grad px-4 text-sm font-semibold"><Plus className="size-4" /> Create Agent</Link>
          </div>
        </div>

        {tab === "agents" && (loading && !data ? <div className="grid gap-3 md:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
          : !agents.length ? <Empty icon={<Bot className="size-6" />} title="No agents yet" action={<Link href="/agents/new" className="text-accent-2 underline">Create your first agent</Link>}>Or describe a whole fleet in the prompt below.</Empty>
          : <div className={cx("grid gap-3", view === "grid" ? "md:grid-cols-2 min-[1850px]:grid-cols-3" : "grid-cols-1")}>
              {agents.map((a) => (
                <div key={a.id} draggable onDragStart={() => { dragId.current = a.id; }} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(a.id)}>
                  <AgentTile a={a} selected={selected === a.id} onSelect={() => setSelected(a.id)} onChanged={refresh}
                    checked={checked.has(a.id)} onCheck={(v) => setChecked((s) => { const n = new Set(s); v ? n.add(a.id) : n.delete(a.id); return n; })} />
                </div>
              ))}
            </div>)}
        {tab === "fleet" && <FleetList fleets={fleets.data?.fleets ?? []} />}
        {tab === "arena" && <SimpleList empty="No competitions yet." link="/agents/arena" rows={(arena.data?.competitions ?? []).map((c: any) => ({ id: c.id, title: c.name, sub: `${c.entries.length} agents · ${c.status} · leader: ${c.entries[0]?.name ?? "—"} ${c.entries[0] ? fmtPct(c.entries[0].returnPct) : ""}` }))} />}
        {tab === "training" && <SimpleList empty="No improvement proposals yet." link="/agents/training" rows={(training.data?.candidates ?? []).slice(0, 8).map((c: any) => ({ id: c.id, title: `${c.agent_name}: ${(c.diagnosis?.reasons ?? [])[0] ?? "proposal"}`, sub: `${c.status} · ${c.evidence?.verdict ?? "no backtest evidence"}` }))} />}
        {tab === "performance" && <PerfTable agents={agents} />}
        {tab === "logs" && <ActivityFeed className="h-[560px]" limit={150} title="All agent logs" />}

        {selected && tab === "agents" && <LiveExecution agentId={selected} onChanged={refresh} />}

        <div className="flex flex-col gap-2 lg:flex-row">
          <FleetComposer compact className="flex-1" selected={[...checked]} placeholder={checked.size ? `Give an instruction to ${checked.size} selected agent${checked.size === 1 ? "" : "s"}…` : "Give an instruction to one or multiple agents… (e.g., “Run SOL and BTC momentum in parallel”)"} />
          <div className="grid grid-cols-4 gap-2 lg:flex">
            <button onClick={() => toast(checked.size ? `${checked.size} agent${checked.size === 1 ? "" : "s"} selected: your next prompt goes to them` : "Tick the checkbox on agent cards to assign them to the prompt", "neutral")} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line-2 px-4 text-sm hover:border-accent/40"><UserPlus className="size-4" /><span className="hidden sm:inline">Assign Agents</span></button>
            <Link href="/agents/fleets" className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line-2 px-4 text-sm hover:border-accent/40"><GitBranch className="size-4" /><span className="hidden sm:inline">Create Fleet</span></Link>
            <button onClick={() => setSchedule(true)} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line-2 px-4 text-sm hover:border-accent/40"><CalendarClock className="size-4" /><span className="hidden sm:inline">Schedule</span></button>
            <div className="relative">
              <button onClick={() => setMore(!more)} className="flex h-14 w-full items-center justify-center rounded-2xl border border-line-2 px-4 hover:border-accent/40" aria-label="More"><MoreHorizontal className="size-4" /></button>
              {more && <div className="absolute bottom-16 right-0 z-20 w-52 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onMouseLeave={() => setMore(false)}>
                <Link href="/agents/rooms" className="block px-3 py-2 text-xs hover:bg-panel-2">Agent rooms</Link>
                <Link href="/agents/capital" className="block px-3 py-2 text-xs hover:bg-panel-2">Capital & risk</Link>
                <Link href="/agents/marketplace" className="block px-3 py-2 text-xs hover:bg-panel-2">Templates marketplace</Link>
                <Link href="/library" className="block px-3 py-2 text-xs hover:bg-panel-2">Knowledge vault</Link>
              </div>}
            </div>
          </div>
        </div>

        <div className="surface flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-4 py-3 text-[13px]">
          <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-up pulse-dot" /> System Live</span>
          <span className="flex items-center gap-2 text-muted"><Database className="size-4" /> {agents.length} Agents ({running.length} Running)</span>
          <span className="flex items-center gap-2 text-muted"><Zap className="size-4" /> {trades24} Executions (24h)</span>
          <span className="flex items-center gap-2 text-muted"><BarChart3 className="size-4" /> <span className={toneOf(pnl24)}>{capital ? fmtPct((pnl24 / capital) * 100) : "—"}</span> Total P&L</span>
          <span className="flex items-center gap-2 text-muted"><Shield className="size-4" /> Risk: {blocked ? <span className="text-down">Limit reached</span> : "Within Limits"}</span>
          <span className="ml-auto flex h-5 items-end gap-[2px]">{Array.from({ length: 24 }, (_, i) => <span key={i} className="w-1 rounded-sm bg-up/70" style={{ height: `${25 + ((i * 37) % 75)}%` }} />)}</span>
        </div>
      </div>
      <ActivityFeed className="h-[calc(100vh-130px)] 2xl:sticky 2xl:top-[88px]" />
      <ScheduleModal open={schedule} onClose={() => setSchedule(false)} agents={agents} />
    </div>
  );
}

function Stat({ label, value, chip }: { label: string; value: React.ReactNode; chip?: React.ReactNode }) {
  return <div className="surface rounded-xl px-3.5 py-2.5"><div className="text-[11px] text-muted">{label}</div><div className="num mt-1 flex items-center gap-2 text-[1.2rem] font-semibold">{value}{chip}</div></div>;
}
function FleetList({ fleets }: { fleets: any[] }) {
  if (!fleets.length) return <Empty icon={<Users className="size-6" />} title="No fleets yet" action={<Link href="/agents/fleets" className="text-accent-2 underline">Open the Fleet Builder</Link>}>A fleet is a group of agents created from one prompt.</Empty>;
  return <div className="grid gap-3 md:grid-cols-2">{fleets.map((f) => (
    <Link key={f.id} href={`/agents/fleets/${f.id}`} className="surface surface-hover rounded-2xl p-4">
      <div className="flex justify-between"><span className="font-semibold">{f.name}</span><span className={cx("text-xs", f.status === "running" ? "text-up" : f.status === "risk_blocked" ? "text-down" : "text-muted")}>{f.status.replace("_", " ")}</span></div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-muted"><span>{f.agents} agents</span><span>{f.running} running</span><span className="capitalize">{f.operation_mode}</span><span className={cx("text-right", toneOf(f.pnl))}>{fmtSigned(f.pnl)}</span></div>
    </Link>))}</div>;
}
function SimpleList({ rows, empty, link }: { rows: { id: string; title: string; sub: string }[]; empty: string; link: string }) {
  return <div className="surface rounded-2xl p-2">{!rows.length && <p className="p-6 text-center text-sm text-muted">{empty}</p>}{rows.map((r) => <Link key={r.id} href={link} className="block rounded-xl px-3 py-2.5 hover:bg-panel-2"><div className="text-sm font-medium">{r.title}</div><div className="text-xs text-muted">{r.sub}</div></Link>)}<Link href={link} className="block px-3 py-2 text-right text-xs text-accent-2">Open →</Link></div>;
}
function PerfTable({ agents }: { agents: any[] }) {
  return (
    <div className="surface overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-[11px] text-muted"><tr className="border-b border-line"><th className="px-4 py-2.5">Agent</th><th>Status</th><th className="text-right">Capital</th><th className="text-right">P&L</th><th className="text-right">Return</th><th className="text-right">Win rate</th><th className="pr-4 text-right">Trades</th></tr></thead>
        <tbody>{agents.map((a) => <tr key={a.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-2"><Link href={`/agents/${a.id}`} className="font-medium hover:underline">{a.name}</Link><div className="text-[11px] text-muted">{a.roleName}</div></td><td className="text-xs capitalize text-muted">{a.status.replace("_", " ")}</td><td className="num text-right">{fmtUsd(a.metrics.capital, 0)}</td><td className={cx("num text-right", toneOf(a.metrics.pnl))}>{fmtSigned(a.metrics.pnl)}</td><td className={cx("num text-right", toneOf(a.metrics.pnlPct))}>{fmtPct(a.metrics.pnlPct)}</td><td className="num text-right">{a.metrics.winRate == null ? "—" : `${a.metrics.winRate.toFixed(0)}%`}</td><td className="num pr-4 text-right">{a.metrics.trades}</td></tr>)}</tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-faint">Paper results. Backtested and live results are labelled separately.</p>
    </div>
  );
}
/** Prompt scheduling + agent scheduling (continuous / interval / condition). */
function ScheduleModal({ open, onClose, agents }: { open: boolean; onClose: () => void; agents: any[] }) {
  const [id, setId] = useState(""); const [kind, setKind] = useState("prompt"); const [at, setAt] = useState(""); const [text, setText] = useState("");
  const [every, setEvery] = useState(60); const [sym, setSym] = useState("BTC"); const [op, setOp] = useState("above"); const [val, setVal] = useState(0);
  const toast = useToast();
  async function save() {
    const a = agents.find((x) => x.id === id); if (!a) { toast("Pick an agent", "down"); return; }
    try {
      const schedule = kind === "prompt" ? { ...a.schedule, prompts: [...(a.schedule?.prompts ?? []), { at: new Date(at).toISOString(), text, delivered: false }] }
        : kind === "interval" ? { ...a.schedule, kind: "interval", everySec: every } : kind === "condition" ? { ...a.schedule, kind: "condition", condition: { symbol: sym, op, value: val } } : { ...a.schedule, kind: "continuous", everySec: 60 };
      await api(`/api/agents/${id}`, { method: "PATCH", json: { schedule, note: `Schedule: ${kind}` } });
      toast("Schedule saved", "up"); onClose();
    } catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Schedule">
      <div className="space-y-3 text-sm">
        <select value={id} onChange={(e) => setId(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-panel-2 px-2"><option value="">Choose an agent…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <div className="flex gap-1 rounded-xl border border-line p-1 text-xs">{[["prompt", "Deliver instruction later"], ["interval", "Run every…"], ["condition", "Only when…"], ["continuous", "Continuous"]].map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={cx("flex-1 rounded-lg py-1.5", kind === k ? "nav-active" : "text-muted")}>{l}</button>)}</div>
        {kind === "prompt" && <><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-panel-2 px-2" /><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Tighten your stop to 1.5% before the Fed decision" rows={3} className="w-full rounded-lg border border-line bg-panel-2 p-2" /></>}
        {kind === "interval" && <label className="block">Every <input type="number" min={15} value={every} onChange={(e) => setEvery(Number(e.target.value))} className="mx-2 h-9 w-24 rounded-lg border border-line bg-panel-2 px-2" /> seconds</label>}
        {kind === "condition" && <div className="flex gap-2"><input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} className="h-9 w-24 rounded-lg border border-line bg-panel-2 px-2" /><select value={op} onChange={(e) => setOp(e.target.value)} className="h-9 rounded-lg border border-line bg-panel-2 px-2"><option value="above">price above</option><option value="below">price below</option><option value="change_up">24h up ≥ %</option><option value="change_down">24h down ≥ %</option></select><input type="number" value={val} onChange={(e) => setVal(Number(e.target.value))} className="h-9 w-28 rounded-lg border border-line bg-panel-2 px-2" /></div>}
        <div className="flex justify-end"><button onClick={save} className="h-9 rounded-lg bg-grad px-4 text-sm font-semibold">Save schedule</button></div>
      </div>
    </Modal>
  );
}
