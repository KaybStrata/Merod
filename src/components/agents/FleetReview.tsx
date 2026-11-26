"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Paperclip, Image as ImageIcon, SlidersHorizontal, Code2, Send, ChevronDown, Sparkles, Trash2, GitBranch } from "lucide-react";
import { api } from "@/lib/api";
import { Modal, cx, useToast } from "@/components/ui";
import { AgentAvatar, GoldButton, GhostButton, fmtUsd } from "./common";

const ROLE_NAMES: Record<string, string> = {};
const AUTONOMY = ["", "Observe", "Suggest", "Prepare", "Supervised", "Conditional", "Autonomous"];
const MODES = ["parallel", "independent", "collaborative", "sequential", "supervisor", "competition"];

/** Fleet review (spec §04 steps 3–5): capital, roles, autonomy, dependencies and missing details, then approve to start in paper. */
export function FleetReview({ draft: initial, onClose, onDone }: { draft: any; onClose: () => void; onDone?: (fleetId: string) => void }) {
  const [d, setD] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [roles, setRoles] = useState<any[]>([]);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => { setD(initial); }, [initial]);
  useEffect(() => { api("/api/agents/catalog").then((r: any) => { setRoles(r.roles); for (const x of r.roles) ROLE_NAMES[x.id] = x.name; }).catch(() => {}); }, []);
  if (!d) return null;
  const set = (i: number, patch: any) => setD({ ...d, agents: d.agents.map((a: any, j: number) => (j === i ? { ...a, ...patch } : a)) });
  const allocated = d.agents.reduce((s: number, a: any) => s + Number(a.capitalUsd || 0), 0);
  const roleOf = (id: string) => roles.find((r) => r.id === id);
  async function approve(start: boolean) {
    setBusy(true);
    try {
      const body = { ...d, capitalUsd: Math.max(Number(d.capitalUsd || 0), allocated + Number(d.reserveUsd || 0)), agents: d.agents.map((a: any) => ({ ...a, capitalUsd: Number(a.capitalUsd || 0), autonomy: Number(a.autonomy) })) };
      delete body.notes; delete body.missing;
      const r: any = await api("/api/agents/fleets", { method: "POST", json: body });
      if (start) await api(`/api/agents/fleets/${r.fleet.id}`, { method: "POST", json: { action: "approve" } });
      toast(start ? `Fleet approved: ${d.agents.length} paper agents starting in parallel` : "Fleet saved for review", "up");
      onDone?.(r.fleet.id); onClose();
      router.push(`/agents/fleets/${r.fleet.id}`);
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><GitBranch className="size-4 text-accent-2" /> Review fleet before it starts</span>} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="sm:col-span-2"><span className="mb-1 block text-[11px] text-muted">Fleet name</span><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className="h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm outline-none focus:border-accent/60" /></label>
          <label><span className="mb-1 block text-[11px] text-muted">Mode</span>
            <select value={d.operationMode} onChange={(e) => setD({ ...d, operationMode: e.target.value })} className="h-9 w-full rounded-lg border border-line bg-panel-2 px-2 text-sm capitalize outline-none">{MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label><span className="mb-1 block text-[11px] text-muted">Daily loss stop (%)</span><input type="number" min={0.1} max={100} step={0.1} value={d.dailyLossPct} onChange={(e) => setD({ ...d, dailyLossPct: Number(e.target.value) })} className="h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm outline-none" /></label>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-warn/30 bg-warn-soft px-2.5 py-1 text-warn">Paper mode</span>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">Allocated {fmtUsd(allocated)}</span>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">Cash reserve {fmtUsd(Number(d.reserveUsd || 0))}</span>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">{d.agents.length} agents</span>
        </div>
        {(d.missing?.length > 0 || d.notes?.length > 0) && (
          <div className="space-y-1.5 rounded-xl border border-line bg-panel-2/60 p-3 text-xs">
            {d.missing?.map((m: string) => <div key={m} className="flex gap-2 text-warn"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{m}</div>)}
            {d.notes?.map((m: string) => <div key={m} className="flex gap-2 text-muted"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent-2" />{m}</div>)}
          </div>
        )}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-panel-2/70 text-left text-[11px] text-muted"><tr><th className="px-3 py-2">Agent</th><th className="px-2">Role</th><th className="px-2">Assets</th><th className="px-2">Autonomy</th><th className="px-2">Capital</th><th className="px-2">Depends on</th><th /></tr></thead>
            <tbody>
              {d.agents.map((a: any, i: number) => {
                const r = roleOf(a.role);
                return (
                  <tr key={a.key} className="border-t border-line align-top">
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><AgentAvatar agent={{ role: a.role, symbols: a.assets }} size={26} /><input value={a.name} onChange={(e) => set(i, { name: e.target.value })} className="h-8 w-40 rounded-md border border-transparent bg-transparent px-1.5 hover:border-line focus:border-accent/60 focus:outline-none" /></div></td>
                    <td className="px-2 py-2"><select value={a.role} onChange={(e) => set(i, { role: e.target.value })} className="h-8 max-w-[150px] rounded-md border border-line bg-panel-2 px-1.5 text-xs">{roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                      {r && !r.trades && <div className="mt-1 text-[10px] text-faint">Read-only</div>}</td>
                    <td className="px-2 py-2"><input value={(a.assets ?? []).join(", ")} onChange={(e) => set(i, { assets: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="SOL, BTC" className="h-8 w-28 rounded-md border border-line bg-panel-2 px-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><select value={a.autonomy} onChange={(e) => set(i, { autonomy: Number(e.target.value) })} className="h-8 rounded-md border border-line bg-panel-2 px-1.5 text-xs">{[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={l} disabled={!!r && !r.trades && l > 3}>{l} · {AUTONOMY[l]}</option>)}</select></td>
                    <td className="px-2 py-2"><input type="number" min={0} value={a.capitalUsd} disabled={!!r && !r.trades} onChange={(e) => set(i, { capitalUsd: Number(e.target.value) })} className="num h-8 w-24 rounded-md border border-line bg-panel-2 px-1.5 text-xs disabled:opacity-40" /></td>
                    <td className="px-2 py-2 text-[11px] text-muted">{a.dependsOn?.length ? a.dependsOn.map((k: string) => d.agents.find((x: any) => x.key === k)?.name ?? k).join(", ") : "—"}</td>
                    <td className="px-2 py-2"><button onClick={() => setD({ ...d, agents: d.agents.filter((_: any, j: number) => j !== i).map((x: any) => ({ ...x, dependsOn: (x.dependsOn ?? []).filter((k: string) => k !== a.key) })) })} className="rounded p-1 text-faint hover:text-down" aria-label="Remove agent"><Trash2 className="size-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-faint">Scanning and wallet monitoring stay read-only unless you give them trading permissions. Every order still passes the risk service and the order engine. Live trading can&apos;t be switched on from here.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GhostButton onClick={() => approve(false)} disabled={busy || !d.agents.length}>Save for later</GhostButton>
          <GoldButton onClick={() => approve(true)} disabled={busy || !d.agents.length}>{busy ? "Starting…" : <>Approve & start in paper <ArrowRight className="size-4" /></>}</GoldButton>
        </div>
      </div>
    </Modal>
  );
}

/** "Create and direct your agent fleet…" composer (Command Center / Workspace). */
export function FleetComposer({ placeholder = "Create and direct your agent fleet…", selected, fleetId, compact = false, className }: { placeholder?: string; selected?: string[]; fleetId?: string; compact?: boolean; className?: string }) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState<"all" | "agents" | "fleet" | "supervisor">(selected?.length ? "agents" : fleetId ? "fleet" : "all");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const [showJson, setShowJson] = useState(false);
  const toast = useToast();
  const router = useRouter();
  useEffect(() => { if (selected?.length) setScope("agents"); }, [selected?.length]);
  const scopeLabel = { all: "All agents", agents: `${selected?.length ?? 0} selected`, fleet: "This fleet", supervisor: "Supervisor" }[scope];
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r: any = await api("/api/agents/command", { method: "POST", json: { text, scope, ids: selected, fleetId } });
      if (r.kind === "draft") setDraft(r.draft);
      else if (r.kind === "actions") toast(`${r.action}: ${r.results.filter((x: any) => x.ok).length}/${r.results.length} agents`, "up");
      else if (r.kind === "instruction") toast(`Instruction sent to ${r.targets.length} agent${r.targets.length === 1 ? "" : "s"} (new version)`, "up");
      else toast(r.message, r.kind === "refused" ? "down" : "neutral");
      if (r.kind !== "draft") setText("");
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <>
      <div className={cx("rounded-2xl border border-line-2 bg-panel/80 shadow-[0_0_0_1px_rgba(214,179,122,0.06),0_20px_60px_-30px_rgba(214,179,122,0.25)]", compact ? "p-2" : "p-4", className)}>
        <div className="flex items-start gap-3">
          <Sparkles className={cx("shrink-0 text-accent-2", compact ? "ml-2 mt-2.5 size-5" : "mt-1 size-6")} />
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={compact ? 1 : 2} placeholder={placeholder} className={cx("min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-muted", compact ? "py-2.5 text-[14px]" : "text-[1.15rem]")} />
          {compact && <button onClick={send} disabled={busy || !text.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-grad disabled:opacity-50" aria-label="Send"><Send className="size-4" /></button>}
        </div>
        {!compact && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="relative flex h-10 items-center gap-2 rounded-xl border border-line-2 bg-panel-2/70 pl-3 pr-8 text-sm">
              <GitBranch className="size-4 text-muted" />
              <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="appearance-none bg-transparent outline-none" aria-label="Command scope">
                <option value="all">Merod Agents</option>
                {!!selected?.length && <option value="agents">Selected ({selected.length})</option>}
                {fleetId && <option value="fleet">This fleet</option>}
                <option value="supervisor">Supervisor</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" />
            </label>
            <button disabled title="Attachments aren't available yet" className="flex size-10 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><Paperclip className="size-4" /></button>
            <button disabled title="Image input isn't available yet" className="flex size-10 items-center justify-center rounded-full border border-line-2 text-faint opacity-60"><ImageIcon className="size-4" /></button>
            <button onClick={() => router.push("/agents/new")} title="Advanced: configure one agent" className="flex size-10 items-center justify-center rounded-full border border-line-2 text-muted hover:text-text"><SlidersHorizontal className="size-4" /></button>
            <button onClick={() => setShowJson(true)} title="Prompt examples" className="flex size-10 items-center justify-center rounded-full border border-line-2 text-muted hover:text-text"><Code2 className="size-4" /></button>
            <span className="ml-auto hidden text-[11px] text-faint sm:block">Sends to: {scopeLabel}</span>
            <button onClick={send} disabled={busy || !text.trim()} className="flex h-11 w-16 items-center justify-center rounded-2xl bg-grad disabled:opacity-50" aria-label="Send"><Send className="size-5" /></button>
          </div>
        )}
      </div>
      {draft && <FleetReview draft={draft} onClose={() => setDraft(null)} />}
      <Modal open={showJson} onClose={() => setShowJson(false)} title="Prompt examples">
        <div className="space-y-2">
          {EXAMPLES.map((e) => (
            <button key={e.title} onClick={() => { setText(e.text); setShowJson(false); }} className="block w-full rounded-xl border border-line bg-panel-2/60 p-3 text-left hover:border-accent/40">
              <div className="text-sm font-semibold">{e.title}</div><div className="mt-0.5 text-xs text-muted">{e.text}</div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

export const EXAMPLES = [
  { title: "Five-agent fleet", text: "Create five independent agents. One to trade Solana, one to trade Bitcoin, one to scan NVIDIA and Tesla, one to monitor profitable Solana wallets, and one to supervise all four. Allocate $10,000 across the trading agents, test everything in paper mode, and stop new orders if combined daily losses reach 2%." },
  { title: "Multi-Asset Trading Fleet", text: "Create independent agents for BTC, SOL, NVDA, AAPL and TSLA. Give each its own strategy and capital allocation from $10,000. Run them simultaneously in paper mode and provide a combined performance report." },
  { title: "Wallet Intelligence Fleet", text: "Create 10 agents to monitor 10 different public Solana wallets. Evaluate realized performance, liquidity, consistency and drawdown. Flag eligible mimic-trading opportunities for review." },
  { title: "Competitive Strategy Testing", text: "Create five agents that trade the same asset SOL using different strategies. Give each $10,000 in virtual funds. Compare their risk-adjusted performance over 30 days." },
  { title: "Market News Intelligence", text: "Create separate agents for stocks news, crypto news, economic news and public social sentiment. Have a supervisor combine their findings and deliver relevant opportunities with supporting sources." },
  { title: "Portfolio Defense", text: "Monitor all my running agents and portfolio positions. Flag excessive concentration, stale market data and abnormal losses. Pause new automated orders when approved risk limits are breached." },
  { title: "Dynamic Agent Fleet", text: "Create agents to scan supported stocks and crypto for strong momentum, propose specialist agents for qualifying assets, paper-test them, and request approval before deploying real capital." },
];
