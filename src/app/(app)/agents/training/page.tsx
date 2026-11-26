"use client";
import Link from "next/link";
import { useState } from "react";
import { Brain, Check, X, FlaskConical, AlertTriangle } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Empty, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { PageHead, GhostButton, GoldButton, fmtPct } from "@/components/agents/common";

/** Auto-Training (screen 7 / Merod Forge): past mistakes, candidates, version diff, backtest evidence, approve or reject. */
export default function AgentTraining() {
  const { data, refresh } = useApi<any>("/api/agents/training", { refreshMs: 60000 });
  const agents = useApi<any>("/api/agents");
  const toast = useToast();
  const [pick, setPick] = useState("");
  async function decide(id: string, decision: "approve" | "reject") { try { await api(`/api/agents/training/${id}`, { method: "POST", json: { decision } }); toast(decision === "approve" ? "Approved: deployed as a new version (rollback in Versions)" : "Rejected", "up"); refresh(); } catch (e: any) { toast(e.message, "down"); } }
  async function review() { if (!pick) return; try { const r: any = await api("/api/agents/training", { method: "POST", json: { agentId: pick } }); toast(r.message, "neutral"); refresh(); } catch (e: any) { toast(e.message, "down"); } }
  const list: any[] = data?.candidates ?? [];
  return (
    <div>
      <PageHead eyebrow="Merod Forge" title="Auto-" accent="Training" sub="Agents learn by evaluating their past decisions after costs and proposing versioned improvements, validated on in-sample and out-of-sample history. Nothing changes until you approve." />
      <section className="surface mb-4 flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <Brain className="ml-1 size-5 text-accent-2" /><span className="text-sm">Review an agent now:</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 rounded-lg border border-line bg-panel-2 px-2 text-sm"><option value="">Choose…</option>{(agents.data?.agents ?? []).filter((a: any) => ["stock_trading", "crypto_trading", "memecoin", "sniping", "mimic"].includes(a.role)).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <GhostButton onClick={review} disabled={!pick} className="h-9">Run review</GhostButton>
        <span className="ml-auto text-[11px] text-faint">The underlying AI model is not retrained. Learning = evaluation + versioned configuration changes.</span>
      </section>
      {!list.length ? <Empty icon={<FlaskConical className="size-6" />} title="No proposals yet">Add an Auto-Training agent to a fleet, or run a review above once an agent has closed some trades.</Empty> : (
        <div className="space-y-3">
          {list.map((c) => {
            const ev = c.evidence ?? {};
            const keys = Object.keys({ ...c.current_strategy, ...c.proposed }).filter((k) => JSON.stringify(c.current_strategy?.[k]) !== JSON.stringify(c.proposed?.[k]));
            return (
              <section key={c.id} className={cx("surface rounded-2xl p-4", c.status !== "proposed" && "opacity-70")}>
                <header className="flex flex-wrap items-center gap-2"><Link href={`/agents/${c.agent_id}`} className="font-semibold hover:underline">{c.agent_name}</Link><span className="text-xs text-muted">based on v{c.base_version} · {ago(c.created_at)}</span><span className={cx("ml-auto rounded-full px-2 py-0.5 text-[11px]", c.status === "proposed" ? "bg-accent-soft text-accent-2" : c.status === "approved" ? "bg-up-soft text-up" : "bg-panel-2 text-muted")}>{c.status}</span></header>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border border-line bg-bg-2/60 p-3 text-sm"><div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Diagnosis</div><div>{c.diagnosis?.wins ?? 0} wins · {c.diagnosis?.losses ?? 0} losses · net ${Number(c.diagnosis?.netPnl ?? 0).toFixed(2)}</div><ul className="mt-1 list-disc pl-4 text-xs text-muted">{(c.diagnosis?.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul></div>
                  <div className="rounded-xl border border-line bg-bg-2/60 p-3 text-xs"><div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Version diff</div>{keys.map((k) => <div key={k} className="flex justify-between py-0.5"><span className="text-muted">{k}</span><span><span className="text-down line-through">{String(c.current_strategy?.[k] ?? "—")}</span> → <span className="text-up">{String(c.proposed?.[k])}</span></span></div>)}</div>
                  <div className="rounded-xl border border-line bg-bg-2/60 p-3 text-xs"><div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Evidence (backtested, not live)</div>
                    {ev.current ? <table className="w-full"><thead className="text-faint"><tr><th /><th className="text-right">In-sample</th><th className="text-right">Out-of-sample</th></tr></thead><tbody>
                      <tr><td className="text-muted">Current</td><td className="num text-right">{fmtPct(ev.current.inSample.returnPct)}</td><td className="num text-right">{fmtPct(ev.current.outOfSample.returnPct)}</td></tr>
                      <tr><td className="text-muted">Candidate</td><td className="num text-right">{fmtPct(ev.candidate.inSample.returnPct)}</td><td className="num text-right">{fmtPct(ev.candidate.outOfSample.returnPct)}</td></tr></tbody></table> : <p className="text-muted">{ev.note}</p>}
                    {ev.verdict && <p className={cx("mt-1.5 flex gap-1", /beats/.test(ev.verdict) && !/not/.test(ev.verdict) ? "text-up" : "text-warn")}>{!/beats/.test(ev.verdict) || /not/.test(ev.verdict) ? <AlertTriangle className="size-3.5 shrink-0" /> : null}{ev.verdict}</p>}
                    {ev.bars && <p className="mt-1 text-faint">{ev.bars} real hourly bars of {ev.asset}</p>}
                  </div>
                </div>
                {c.status === "proposed" && <div className="mt-3 flex justify-end gap-2"><GhostButton onClick={() => decide(c.id, "reject")}><X className="size-4" /> Reject</GhostButton><GoldButton onClick={() => decide(c.id, "approve")}><Check className="size-4" /> Approve & deploy</GoldButton></div>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
