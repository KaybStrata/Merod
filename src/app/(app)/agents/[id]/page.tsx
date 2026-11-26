"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Brain, History, GitBranch, Lock, Unlock, RotateCcw, Play, Pause, Square, Share2, ArrowRightLeft, Repeat2, Database } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, usePageTitle } from "@/components/shell/context";
import { Modal, Skeleton, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { LiveExecution } from "@/components/agents/LiveExecution";
import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { agentAct } from "@/components/agents/AgentCard";
import { AgentAvatar, AreaChart, KindBadge, StatusDot, GoldButton, GhostButton, fmtPct, fmtSigned, fmtUsd, toneOf, clock } from "@/components/agents/common";

type Tab = "overview" | "instructions" | "memory" | "executions" | "versions" | "log" | "settings";
const AUT = ["", "Observe", "Suggest", "Prepare", "Supervised", "Conditional", "Autonomous"];

/** Individual Agent (screen 3): live chart, instructions, memory, metrics, decisions, executions, versions and controls. */
export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const { data, refresh } = useApi<any>(`/api/agents/${id}`, { refreshMs: 20000 });
  const toast = useToast();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "overview");
  useRealtime((e) => { if (e.type === "agent" && e.payload?.agent_id === id) refresh(); });
  usePageTitle({ section: `Automate · Agents${data?.agent?.roleName ? ` · ${data.agent.roleName}` : ""}`, title: data?.agent?.name ?? "Agent", accent: data?.agent?.name }, [data?.agent?.name]);
  if (!data) return <Skeleton className="h-[500px] rounded-2xl" />;
  const a = data.agent, m = a.metrics;
  const running = a.status === "running" || a.status === "queued";
  async function act(action: string) { try { await agentAct(id, action); toast(action.replace("_", " "), "up"); refresh(); } catch (e: any) { toast(e.message, "down"); } }
  const TABS: [Tab, string][] = [["overview", "Overview"], ["instructions", "Instructions"], ["memory", "Memory"], ["executions", "Executions"], ["versions", `Versions (${a.version})`], ["log", "Black box"], ["settings", "Settings"]];
  return (
    <div className="space-y-4">
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text"><ArrowLeft className="size-3.5" /> Agents</Link>
      <div className="flex flex-wrap items-center gap-4">
        <AgentAvatar agent={{ ...a, symbols: data.assets.map((x: any) => x.symbol) }} size={40} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-[1.15rem] font-semibold tracking-tight">{a.name}</h2><StatusDot status={a.status} /><span className="rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">PAPER</span></div>
          <div className="text-[12px] text-muted">{a.roleName} · autonomy {a.autonomy_level} ({AUT[a.autonomy_level]}) · v{a.version} · model {a.routedModel}{a.fleet_id && <> · <Link href={`/agents/fleets/${a.fleet_id}`} className="underline">fleet</Link></>}{a.stop_reason && <span className="text-warn"> · {a.stop_reason}</span>}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {a.status === "pending_approval" && <GoldButton onClick={() => act("approve")}>Approve configuration</GoldButton>}
          <GhostButton onClick={() => act(running ? "pause" : a.status === "paused" ? "resume" : "start")}>{running ? <><Pause className="size-4" /> Pause new entries</> : <><Play className="size-4" /> {a.status === "paused" ? "Resume" : "Start (paper)"}</>}</GhostButton>
          <GhostButton onClick={() => act("cancel_orders")}>Cancel orders</GhostButton>
          <GhostButton onClick={() => { if (confirm("Close all of this agent's positions at market?")) act("close_positions"); }}>Close positions</GhostButton>
          <GhostButton onClick={() => act("stop")}><Square className="size-4" /> Stop</GhostButton>
          <GhostButton onClick={() => act("fork")}><GitBranch className="size-4" /> Fork</GhostButton>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[["P&L", <span key="p" className={toneOf(m.pnl)}>{fmtSigned(m.pnl)}</span>], ["Return", <span key="r" className={toneOf(m.pnlPct)}>{fmtPct(m.pnlPct)}</span>], ["Capital", fmtUsd(m.capital, 0)], ["Invested", fmtUsd(m.invested)], ["Win rate", m.winRate == null ? "—" : `${m.winRate.toFixed(0)}%`], ["Trades / fees", `${m.trades} · ${fmtUsd(m.fees)}`]].map(([k, v]) => (
          <div key={k as string} className="surface rounded-xl px-3.5 py-2.5"><div className="text-[11px] text-muted">{k}</div><div className="num mt-1 text-[1.15rem] font-semibold">{v}</div></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-panel/60 p-1">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx("rounded-xl px-3.5 py-2 text-[13px]", tab === k ? "nav-active" : "text-muted hover:text-text")}>{l}</button>)}
      </div>
      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <LiveExecution agentId={id} onChanged={refresh} />
            <section className="surface rounded-2xl p-4"><h3 className="mb-2 text-sm font-semibold">Equity (paper)</h3><AreaChart data={data.spark.map((p: any) => p.v)} height={120} /></section>
            {data.positions.length > 1 && <section className="surface rounded-2xl p-4"><h3 className="mb-2 text-sm font-semibold">Open positions</h3>{data.positions.map((p: any) => <div key={p.assetId} className="flex justify-between border-b border-line/60 py-1.5 text-sm last:border-0"><span>{p.symbol} · {Number(p.qty).toPrecision(6)}</span><span className={cx("num", toneOf(p.pnl))}>{fmtSigned(p.pnl)} ({fmtPct(p.pnlPct)})</span></div>)}</section>}
          </div>
          <ActivityFeed agentId={id} className="h-[640px]" title="Decision summaries" />
        </div>
      )}
      {tab === "instructions" && <Instructions a={a} onSaved={refresh} />}
      {tab === "memory" && <Memory a={a} />}
      {tab === "executions" && (
        <section className="surface overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[640px] text-sm"><thead className="text-left text-[11px] text-muted"><tr className="border-b border-line"><th className="px-4 py-2.5">Time</th><th>Side</th><th>Asset</th><th>Status</th><th className="text-right">Filled</th><th className="text-right">Price</th><th className="pr-4 text-right">Realised</th></tr></thead>
            <tbody>{data.orders.map((o: any) => <tr key={o.id} className="border-b border-line/60 last:border-0"><td className="px-4 py-2 text-xs text-muted">{new Date(o.created_at).toLocaleString()}</td><td className={o.side === "buy" ? "text-up" : "text-down"}>{o.side}</td><td>{o.symbol}</td><td className="text-xs" title={o.status_reason ?? ""}>{o.status.replace("_", " ")}</td><td className="num text-right">{Number(o.filled_quantity).toPrecision(6)}</td><td className="num text-right">{o.avg_fill_price ? fmtUsd(Number(o.avg_fill_price)) : "—"}</td><td className={cx("num pr-4 text-right", toneOf(Number(o.realized_pnl)))}>{o.side === "sell" ? fmtSigned(Number(o.realized_pnl)) : ""}</td></tr>)}</tbody>
          </table>
          {!data.orders.length && <p className="p-6 text-center text-sm text-muted">No orders yet.</p>}
        </section>
      )}
      {tab === "versions" && <Versions a={a} versions={data.versions} genealogy={data.genealogy} onRestored={refresh} />}
      {tab === "log" && <BlackBox events={data.events} />}
      {tab === "settings" && <Settings a={a} assets={data.assets} positions={data.positions} onSaved={refresh} />}
    </div>
  );
}

function Instructions({ a, onSaved }: { a: any; onSaved: () => void }) {
  const [text, setText] = useState(a.instructions); const [note, setNote] = useState(""); const toast = useToast();
  useEffect(() => setText(a.instructions), [a.instructions]);
  async function save() { try { await api(`/api/agents/${a.id}`, { method: "PATCH", json: { instructions: text, note: note || "Instructions edited" } }); toast("Saved as a new version", "up"); setNote(""); onSaved(); } catch (e: any) { toast(e.message, "down"); } }
  return (
    <section className="surface space-y-3 rounded-2xl p-4">
      <p className="text-xs text-muted">Live prompt editing: every change is validated and saved as a new version (v{a.version + 1}); the agent keeps running. Instructions can&apos;t change autonomy, capital, limits or switch to live.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="w-full rounded-xl border border-line bg-panel-2/60 p-3 text-sm outline-none focus:border-accent/60" />
      <div className="flex gap-2"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note (optional)" className="h-10 flex-1 rounded-xl border border-line bg-panel-2/60 px-3 text-sm" /><GoldButton onClick={save} disabled={text === a.instructions}>Save version</GoldButton></div>
    </section>
  );
}
function Memory({ a }: { a: any }) {
  const mem = a.memory ?? {}; const kb = useApi<any>("/api/agents/knowledge");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["lessons", "notes", "preferences"] as const).map((k) => (
        <section key={k} className="surface rounded-2xl p-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold capitalize"><Brain className="size-4 text-accent-2" /> {k}</h3>
          {(mem[k] ?? []).length ? <ul className="space-y-1.5 text-sm">{[...mem[k]].reverse().map((x: any, i: number) => <li key={i} className="border-b border-line/60 pb-1.5 last:border-0"><div>{x.text}</div><div className="text-[10px] text-faint">{x.t ? ago(x.t) : ""}</div></li>)}</ul> : <p className="text-xs text-muted">Nothing yet. The agent records {k === "lessons" ? "lessons from losing trades" : k} here.</p>}
        </section>
      ))}
      <section className="surface rounded-2xl p-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Database className="size-4 text-accent-2" /> Shared knowledge (Vault)</h3>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">{(kb.data?.knowledge ?? []).filter((k: any) => !a.fleet_id || k.fleet_id === a.fleet_id || !k.fleet_id).slice(0, 30).map((k: any) => <li key={k.id} className="border-b border-line/60 pb-1.5 last:border-0"><div className="text-[11px] text-accent-2">{k.topic} · {k.agent_name ?? "you"}</div><div>{k.body}</div></li>)}</ul>
      </section>
    </div>
  );
}
function Versions({ a, versions, genealogy, onRestored }: { a: any; versions: any[]; genealogy: any; onRestored: () => void }) {
  const toast = useToast(); const [cmp, setCmp] = useState<number | null>(versions[1]?.version ?? null);
  const cur = versions[0]?.config, old = versions.find((v) => v.version === cmp)?.config;
  const keys = cur && old ? Object.keys({ ...cur, ...old }).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(old[k])) : [];
  async function restore(v: number) { try { await api(`/api/agents/${a.id}/versions`, { method: "POST", json: { version: v } }); toast(`Restored v${v} as a new version`, "up"); onRestored(); } catch (e: any) { toast(e.message, "down"); } }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="surface rounded-2xl p-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="size-4" /> Version history</h3>
        <ul className="space-y-1">{versions.map((v) => <li key={v.version} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-panel-2"><button onClick={() => setCmp(v.version)} className="min-w-0 text-left"><span className="font-medium">v{v.version}</span> <span className="text-xs text-muted">{v.change_note} · {v.created_by} · {ago(v.created_at)}</span></button>{v.version !== a.version && <button onClick={() => restore(v.version)} className="flex shrink-0 items-center gap-1 text-xs text-accent-2"><RotateCcw className="size-3" /> Restore</button>}</li>)}</ul>
      </section>
      <section className="surface rounded-2xl p-4"><h3 className="mb-2 text-sm font-semibold">Diff: v{a.version} vs v{cmp ?? "—"}</h3>
        {!old ? <p className="text-xs text-muted">Pick an older version to compare.</p> : !keys.length ? <p className="text-xs text-muted">No differences.</p> :
          <div className="space-y-2 text-xs">{keys.map((k) => <div key={k}><div className="font-medium">{k}</div><div className="rounded bg-down-soft p-1.5 font-mono text-[11px] text-down">− {JSON.stringify(old[k])}</div><div className="mt-0.5 rounded bg-up-soft p-1.5 font-mono text-[11px] text-up">+ {JSON.stringify(cur[k])}</div></div>)}</div>}
        <h3 className="mb-1 mt-4 flex items-center gap-2 text-sm font-semibold"><GitBranch className="size-4" /> Genealogy</h3>
        <div className="text-xs text-muted">{a.lineage !== "created" && <>This agent was <b>{a.lineage}</b>{genealogy.parent && <> from <Link className="underline" href={`/agents/${genealogy.parent.id}`}>{genealogy.parent.name}</Link></>}. </>}{genealogy.children.length ? <>Descendants: {genealogy.children.map((c: any) => <Link key={c.id} className="mr-1 underline" href={`/agents/${c.id}`}>{c.name} ({c.lineage})</Link>)}</> : "No forks yet."}</div>
      </section>
    </div>
  );
}
function BlackBox({ events }: { events: any[] }) {
  const [replay, setReplay] = useState<any>(null); const toast = useToast();
  async function run(id: number) { try { setReplay(await api(`/api/agents/events/${id}/replay`, { method: "POST" })); } catch (e: any) { toast(e.message, "down"); } }
  return (
    <section className="surface rounded-2xl p-2">
      <p className="px-3 py-2 text-xs text-muted">Agent Black Box: inputs, decision summaries, rule checks and outcomes for every step. Replay re-runs the current rules on a decision&apos;s recorded inputs.</p>
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-3 rounded-xl px-3 py-2 hover:bg-panel-2">
          <span className="num w-16 shrink-0 text-[11px] text-faint">{clock(e.created_at)}</span><KindBadge kind={e.kind} />
          <div className="min-w-0 flex-1"><div className="text-sm">{e.title} <span className="text-[10px] text-faint">v{e.version ?? "?"}</span></div>{e.body && <div className="text-xs text-muted">{e.body}</div>}</div>
          {e.data?.inputs && <button onClick={() => run(e.id)} className="flex shrink-0 items-center gap-1 text-xs text-accent-2"><Repeat2 className="size-3.5" /> Replay</button>}
        </div>
      ))}
      <Modal open={!!replay} onClose={() => setReplay(null)} title="Agent replay">
        {replay && <div className="space-y-2 text-sm">
          {replay.note ? <p className="text-muted">{replay.note}</p> : <>
            <div className="rounded-lg bg-panel-2 p-2"><div className="text-[11px] text-muted">Recorded (v{replay.recordedVersion})</div>{replay.recorded ? `${replay.recorded.action.toUpperCase()} · ${replay.recorded.reason}` : "—"}</div>
            <div className="rounded-lg bg-panel-2 p-2"><div className="text-[11px] text-muted">Replayed with current rules (v{replay.currentVersion})</div>{replay.replay.action.toUpperCase()} · {replay.replay.reason}</div>
            <p className={replay.sameDecision ? "text-up" : "text-warn"}>{replay.sameDecision ? "Same decision." : "The current version would decide differently."}</p></>}
        </div>}
      </Modal>
    </section>
  );
}
function Settings({ a, assets, positions, onSaved }: { a: any; assets: any[]; positions: any[]; onSaved: () => void }) {
  const toast = useToast();
  const others = useApi<any>("/api/agents");
  const [s, setS] = useState<any>({ autonomy: a.autonomy_level, capitalUsd: Number(a.capital_usd), tradeUsd: a.strategy?.tradeUsd ?? 100, takeProfitPct: a.strategy?.takeProfitPct ?? 0, stopLossPct: a.strategy?.stopLossPct ?? 0, maxOpen: a.strategy?.maxOpen ?? 3,
    maxOrderUsd: a.risk?.maxOrderUsd ?? "", dailyLossUsd: a.risk?.dailyLossUsd ?? "", assets: assets.map((x) => x.symbol).join(", "), wallets: (a.universe?.wallets ?? []).join(", "), everySec: a.schedule?.everySec ?? 60, model: a.model });
  const [handTo, setHandTo] = useState(""); const [handAsset, setHandAsset] = useState(positions[0]?.assetId ?? ""); const [vis, setVis] = useState<"private" | "public">("private");
  const set = (p: any) => setS((x: any) => ({ ...x, ...p }));
  const fld = "h-9 w-full rounded-lg border border-line bg-panel-2/70 px-2.5 text-sm outline-none focus:border-accent/60";
  async function save() {
    try {
      const num = (v: any) => (v === "" ? undefined : Number(v));
      await api(`/api/agents/${a.id}`, { method: "PATCH", json: { autonomy: Number(s.autonomy), capitalUsd: Number(s.capitalUsd), assets: s.assets.split(/[,\s]+/).filter(Boolean), wallets: s.wallets.split(/[,\s]+/).filter(Boolean), model: s.model,
        strategy: { tradeUsd: Number(s.tradeUsd), takeProfitPct: Number(s.takeProfitPct), stopLossPct: Number(s.stopLossPct), maxOpen: Number(s.maxOpen) }, risk: { maxOrderUsd: num(s.maxOrderUsd), dailyLossUsd: num(s.dailyLossUsd) },
        schedule: { everySec: Number(s.everySec) }, note: "Settings changed" } });
      toast("Saved as a new version", "up"); onSaved();
    } catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="surface grid gap-3 rounded-2xl p-4 sm:grid-cols-3">
        <label><span className="mb-1 block text-xs text-muted">Autonomy</span><select value={s.autonomy} onChange={(e) => set({ autonomy: e.target.value })} className={fld}>{[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={l}>{l} · {AUT[l]}</option>)}</select></label>
        <label><span className="mb-1 block text-xs text-muted">Capital ($)</span><input type="number" value={s.capitalUsd} onChange={(e) => set({ capitalUsd: e.target.value })} className={fld} /></label>
        <label><span className="mb-1 block text-xs text-muted">Model</span><select value={s.model} onChange={(e) => set({ model: e.target.value })} className={fld}><option value="auto">Automatic routing</option><option value="rules">Rules only</option><option value="claude-haiku-5-5">Claude Haiku 5.5</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5</option><option value="claude-opus-5-5">Claude Opus 5.5</option></select></label>
        <label><span className="mb-1 block text-xs text-muted">$ per trade</span><input type="number" value={s.tradeUsd} onChange={(e) => set({ tradeUsd: e.target.value })} className={fld} /></label>
        <label><span className="mb-1 block text-xs text-muted">Take profit %</span><input type="number" step={0.1} value={s.takeProfitPct} onChange={(e) => set({ takeProfitPct: e.target.value })} className={fld} /></label>
        <label><span className="mb-1 block text-xs text-muted">Stop loss %</span><input type="number" step={0.1} value={s.stopLossPct} onChange={(e) => set({ stopLossPct: e.target.value })} className={fld} /></label>
        <label><span className="mb-1 block text-xs text-muted">Max open</span><input type="number" value={s.maxOpen} onChange={(e) => set({ maxOpen: e.target.value })} className={fld} /></label>
        <label><span className="mb-1 block text-xs text-muted">Max order $</span><input type="number" value={s.maxOrderUsd} onChange={(e) => set({ maxOrderUsd: e.target.value })} className={fld} /></label>
        <label><span className="mb-1 block text-xs text-muted">Daily loss limit $</span><input type="number" value={s.dailyLossUsd} onChange={(e) => set({ dailyLossUsd: e.target.value })} className={fld} /></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs text-muted">Assets</span><input value={s.assets} onChange={(e) => set({ assets: e.target.value })} className={fld} /></label>
        <label><span className="mb-1 block text-xs text-muted">Check every (s)</span><input type="number" min={15} value={s.everySec} onChange={(e) => set({ everySec: e.target.value })} className={fld} /></label>
        {(a.role === "mimic" || a.role === "wallet_tracking") && <label className="sm:col-span-3"><span className="mb-1 block text-xs text-muted">Wallets</span><input value={s.wallets} onChange={(e) => set({ wallets: e.target.value })} className={fld} /></label>}
        <div className="flex items-center justify-between sm:col-span-3">
          <button onClick={async () => { try { await api(`/api/agents/${a.id}`, { method: "PATCH", json: { lockedStrategy: !a.locked_strategy } }); onSaved(); } catch (e: any) { toast(e.message, "down"); } }} className="flex items-center gap-1.5 text-xs text-muted hover:text-text">{a.locked_strategy ? <><Lock className="size-3.5" /> Strategy locked (auto-training can&apos;t change it)</> : <><Unlock className="size-3.5" /> Lock strategy</>}</button>
          <GoldButton onClick={save}>Save settings</GoldButton>
        </div>
      </section>
      <div className="space-y-4">
        <section className="surface space-y-2 rounded-2xl p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><ArrowRightLeft className="size-4" /> Hand off a position</h3>
          {!positions.length ? <p className="text-xs text-muted">No open positions to hand off.</p> : <>
            <select value={handAsset} onChange={(e) => setHandAsset(e.target.value)} className={fld}>{positions.map((p: any) => <option key={p.assetId} value={p.assetId}>{p.symbol} · {Number(p.qty).toPrecision(5)}</option>)}</select>
            <select value={handTo} onChange={(e) => setHandTo(e.target.value)} className={fld}><option value="">To agent…</option>{(others.data?.agents ?? []).filter((x: any) => x.id !== a.id).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <GhostButton className="w-full" disabled={!handTo} onClick={async () => { try { await api("/api/agents", { method: "POST", json: { action: "handoff", from: a.id, to: handTo, assetId: handAsset } }); toast("Handed off (recorded in both agents' logs)", "up"); onSaved(); } catch (e: any) { toast(e.message, "down"); } }}>Hand off</GhostButton></>}
        </section>
        <section className="surface space-y-2 rounded-2xl p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Share2 className="size-4" /> Publish as a template</h3>
          <p className="text-xs text-muted">Shares the configuration only: never memory, keys, capital or positions. Performance is shown as verified paper results.</p>
          <select value={vis} onChange={(e) => setVis(e.target.value as any)} className={fld}><option value="private">Private (only you)</option><option value="public">Public (everyone on Merod)</option></select>
          <GhostButton className="w-full" onClick={async () => { try { await api("/api/agents/marketplace", { method: "POST", json: { agentId: a.id, visibility: vis } }); toast("Published to the Marketplace", "up"); } catch (e: any) { toast(e.message, "down"); } }}>Publish</GhostButton>
        </section>
        <section className="surface rounded-2xl p-4"><button onClick={async () => { try { await api("/api/agents/training", { method: "POST", json: { agentId: a.id } }).then((r: any) => toast(r.message, "neutral")); } catch (e: any) { toast(e.message, "down"); } }} className="w-full text-left text-sm"><span className="font-semibold">Run an auto-training review now</span><span className="block text-xs text-muted">Evaluates closed trades and proposes a versioned improvement with backtest evidence.</span></button></section>
        <section className="surface rounded-2xl p-4"><button onClick={async () => { if (!confirm("Archive this agent? Open orders are cancelled.")) return; try { await agentAct(a.id, "archive"); location.href = "/agents"; } catch (e: any) { toast(e.message, "down"); } }} className="text-sm text-down">Archive agent</button></section>
      </div>
    </div>
  );
}
