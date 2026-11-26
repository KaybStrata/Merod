"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2, ShieldCheck, Play, Save } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { PageHead, ROLE_ICON, GoldButton, GhostButton, fmtUsd } from "@/components/agents/common";

const field = "h-10 w-full rounded-xl border border-line bg-panel-2/70 px-3 text-sm outline-none focus:border-accent/60";

/** Agent Creator (screen 2): prompt, role, assets, model, tools, capital, autonomy, schedule, risk limits, preview, paper start. */
export default function AgentCreator() {
  const cat = useApi<any>("/api/agents/catalog");
  const cap = useApi<any>("/api/agents/capital");
  const router = useRouter();
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [f, setF] = useState<any>({ name: "", role: "crypto_trading", assets: "", wallets: "", model: "auto", autonomy: 5, capitalUsd: 1000, scheduleKind: "continuous", everySec: 60, condSym: "BTC", condOp: "above", condVal: 0, shareKnowledge: true,
    strategy: { kind: "momentum", tradeUsd: 100, takeProfitPct: 4, stopLossPct: 2, maxOpen: 3 }, risk: { maxOrderUsd: "", maxPositionUsd: "", dailyLossUsd: "" } });
  const [busy, setBusy] = useState(false);
  const roles: any[] = cat.data?.roles ?? [];
  const role = roles.find((r) => r.id === f.role);
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));
  const setS = (p: any) => setF((x: any) => ({ ...x, strategy: { ...x.strategy, ...p } }));
  const setR = (p: any) => setF((x: any) => ({ ...x, risk: { ...x.risk, ...p } }));
  const trades = !!role?.trades;
  async function draft() {
    if (!prompt.trim()) return;
    try {
      const r: any = await api("/api/agents/fleets/plan", { method: "POST", json: { prompt } });
      const a = r.draft.agents[0];
      if (!a) { toast(r.draft.missing?.[0] ?? "Couldn't draft an agent from that", "down"); return; }
      set({ name: a.name, role: a.role, assets: (a.assets ?? []).join(", "), autonomy: a.autonomy, capitalUsd: a.capitalUsd || f.capitalUsd, strategy: { ...f.strategy, ...(a.strategy ?? {}) } });
      if (r.draft.agents.length > 1) toast(`That describes ${r.draft.agents.length} agents. Drafted the first; use Fleet Builder for all of them.`, "neutral");
    } catch (e: any) { toast(e.message, "down"); }
  }
  const body = useMemo(() => {
    const num = (v: any) => (v === "" || v == null ? undefined : Number(v));
    const s: any = { ...f.strategy };
    for (const k of Object.keys(s)) if (k !== "kind" && s[k] !== undefined && s[k] !== "") s[k] = Number(s[k]);
    return {
      name: f.name || `${f.assets.split(/[,\s]+/)[0] || role?.name || "New"} ${role?.name ?? "Agent"}`.slice(0, 60), role: f.role, instructions: prompt || role?.defaultInstructions || "",
      assets: f.assets.split(/[,\s]+/).filter(Boolean), wallets: f.wallets.split(/[,\s]+/).filter(Boolean), model: f.model, autonomy: Number(f.autonomy), capitalUsd: trades ? Number(f.capitalUsd || 0) : 0,
      strategy: s, risk: { maxOrderUsd: num(f.risk.maxOrderUsd), maxPositionUsd: num(f.risk.maxPositionUsd), dailyLossUsd: num(f.risk.dailyLossUsd) },
      schedule: f.scheduleKind === "condition" ? { kind: "condition", everySec: Number(f.everySec), condition: { symbol: f.condSym, op: f.condOp, value: Number(f.condVal) } } : { kind: f.scheduleKind, everySec: Number(f.everySec) },
      toolPolicy: { shareKnowledge: f.shareKnowledge },
    };
  }, [f, prompt, role, trades]);
  async function save(start: boolean) {
    setBusy(true);
    try {
      const r: any = await api("/api/agents", { method: "POST", json: body });
      if (r.error) throw new Error(r.error);
      if (start) await api(`/api/agents/${r.agent.id}/actions`, { method: "POST", json: { action: "start" } });
      for (const n of r.agent.notes ?? []) toast(n, "neutral");
      toast(start ? `${r.agent.name} started in paper mode` : `${r.agent.name} saved`, "up");
      router.push(`/agents/${r.agent.id}`);
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const groups = [["market", "Market & strategy specialists"], ["operations", "Operations & oversight"]] as const;
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[220px] w-[60%] opacity-70" />
      <PageHead eyebrow="Merod Forge" title="Create an" accent="agent" sub="Describe it, pick a role and limits, preview, then start it in paper mode." />
      <div className="relative z-10 grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <section className="surface rounded-2xl p-4">
            <div className="flex items-start gap-3"><Sparkles className="mt-1 size-5 text-accent-2" />
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="e.g. Trade SOL on momentum, $100 per trade, take profit at 4% and stop at 2%" className="min-w-0 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-muted" />
            </div>
            <div className="mt-2 flex justify-end"><GhostButton onClick={draft} disabled={!prompt.trim()}><Wand2 className="size-4" /> Draft from prompt</GhostButton></div>
          </section>

          <section className="surface rounded-2xl p-4">
            <h3 className="mb-3 text-sm font-semibold">Role</h3>
            {groups.map(([g, label]) => (
              <div key={g} className="mb-3">
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-faint">{label}</div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {roles.filter((r) => r.group === g).map((r) => { const I = ROLE_ICON[r.id]; return (
                    <button key={r.id} onClick={() => set({ role: r.id, autonomy: r.defaultAutonomy, strategy: { ...f.strategy, kind: r.strategy === "none" ? f.strategy.kind : r.strategy } })}
                      className={cx("flex items-start gap-2 rounded-xl border p-2.5 text-left", f.role === r.id ? "gold-ring border-transparent bg-accent-soft" : "border-line hover:border-line-2")}>
                      {I && <I className="mt-0.5 size-4 shrink-0 text-accent-2" />}<span><span className="block text-[13px] font-medium">{r.name}{!r.trades && <span className="ml-1 text-[10px] text-faint">read-only</span>}</span><span className="block text-[11px] leading-snug text-muted">{r.description}</span></span>
                    </button>
                  ); })}
                </div>
              </div>
            ))}
          </section>

          <section className="surface grid gap-3 rounded-2xl p-4 sm:grid-cols-2">
            <label><span className="mb-1 block text-xs text-muted">Name</span><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="SOL Momentum" className={field} /></label>
            <label><span className="mb-1 block text-xs text-muted">Assets (symbols, comma-separated)</span><input value={f.assets} onChange={(e) => set({ assets: e.target.value })} placeholder="SOL, BTC" className={field} /></label>
            {(f.role === "mimic" || f.role === "wallet_tracking") && <label className="sm:col-span-2"><span className="mb-1 block text-xs text-muted">Public Solana wallets</span><input value={f.wallets} onChange={(e) => set({ wallets: e.target.value })} placeholder="Wallet addresses, comma-separated" className={field} /></label>}
            <label><span className="mb-1 block text-xs text-muted">AI model</span><select value={f.model} onChange={(e) => set({ model: e.target.value })} className={field}>{(cat.data?.models ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <div><span className="mb-1 block text-xs text-muted">Tools this role may use</span><div className="flex flex-wrap gap-1.5">{(role?.tools ?? []).map((t: string) => <span key={t} className="rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] text-muted">{t.replace("_", " ")}</span>)}</div>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={f.shareKnowledge} onChange={(e) => set({ shareKnowledge: e.target.checked })} className="accent-[#d6b37a]" /> May contribute to the shared knowledge library</label></div>
          </section>

          <section className="surface rounded-2xl p-4">
            <h3 className="mb-3 text-sm font-semibold">Autonomy</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {(cat.data?.autonomy ?? []).map((l: any) => { const dis = !trades && l.level > 3; return (
                <button key={l.level} disabled={dis} onClick={() => set({ autonomy: l.level })} className={cx("rounded-xl border p-3 text-left disabled:opacity-35", Number(f.autonomy) === l.level ? "gold-ring border-transparent bg-accent-soft" : "border-line hover:border-line-2")}>
                  <div className="text-[13px] font-semibold">{l.level} · {l.name}</div><div className="mt-0.5 text-[11px] leading-snug text-muted">{l.text}</div>
                </button>
              ); })}
            </div>
            {!trades && <p className="mt-2 text-[11px] text-faint">{role?.name} agents are research-only: no capital, max autonomy Prepare.</p>}
          </section>

          {trades && (
            <section className="surface grid gap-3 rounded-2xl p-4 sm:grid-cols-3">
              <h3 className="text-sm font-semibold sm:col-span-3">Strategy & capital</h3>
              <label><span className="mb-1 block text-xs text-muted">Strategy</span><select value={f.strategy.kind} onChange={(e) => setS({ kind: e.target.value })} className={field}>{(cat.data?.strategies ?? []).filter((s: any) => s.id !== "none").map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
              <label><span className="mb-1 block text-xs text-muted">Capital allocated ($)</span><input type="number" min={0} value={f.capitalUsd} onChange={(e) => set({ capitalUsd: e.target.value })} className={field} /><span className="mt-1 block text-[10px] text-faint">Unallocated: {fmtUsd(cap.data?.unallocated)}</span></label>
              <label><span className="mb-1 block text-xs text-muted">$ per trade</span><input type="number" min={1} value={f.strategy.tradeUsd} onChange={(e) => setS({ tradeUsd: e.target.value })} className={field} /></label>
              <label><span className="mb-1 block text-xs text-muted">Take profit (%)</span><input type="number" min={0} step={0.1} value={f.strategy.takeProfitPct} onChange={(e) => setS({ takeProfitPct: e.target.value })} className={field} /></label>
              <label><span className="mb-1 block text-xs text-muted">Stop loss (%)</span><input type="number" min={0} step={0.1} value={f.strategy.stopLossPct} onChange={(e) => setS({ stopLossPct: e.target.value })} className={field} /></label>
              <label><span className="mb-1 block text-xs text-muted">Max open positions</span><input type="number" min={1} value={f.strategy.maxOpen} onChange={(e) => setS({ maxOpen: e.target.value })} className={field} /></label>
              {f.strategy.kind === "dip" && <label><span className="mb-1 block text-xs text-muted">Buy after dip (%)</span><input type="number" step={0.1} value={f.strategy.dipPct ?? 3} onChange={(e) => setS({ dipPct: e.target.value })} className={field} /></label>}
              {(f.strategy.kind === "momentum" || f.strategy.kind === "news") && <label><span className="mb-1 block text-xs text-muted">Min 24h move (%)</span><input type="number" step={0.1} value={f.strategy.minChangePct ?? 1.5} onChange={(e) => setS({ minChangePct: e.target.value })} className={field} /></label>}
              {f.strategy.kind === "mean_reversion" && <label><span className="mb-1 block text-xs text-muted">Buy at RSI ≤</span><input type="number" value={f.strategy.rsiBuy ?? 30} onChange={(e) => setS({ rsiBuy: e.target.value })} className={field} /></label>}
              {f.strategy.kind === "dca" && <label><span className="mb-1 block text-xs text-muted">Buy every (hours)</span><input type="number" min={1} value={f.strategy.everyHours ?? 24} onChange={(e) => setS({ everyHours: e.target.value })} className={field} /></label>}
            </section>
          )}

          <section className="surface grid gap-3 rounded-2xl p-4 sm:grid-cols-3">
            <h3 className="text-sm font-semibold sm:col-span-3">Risk limits & schedule</h3>
            <label><span className="mb-1 block text-xs text-muted">Max order ($)</span><input type="number" value={f.risk.maxOrderUsd} onChange={(e) => setR({ maxOrderUsd: e.target.value })} placeholder="Account limit" className={field} /></label>
            <label><span className="mb-1 block text-xs text-muted">Max position ($)</span><input type="number" value={f.risk.maxPositionUsd} onChange={(e) => setR({ maxPositionUsd: e.target.value })} placeholder="Capital" className={field} /></label>
            <label><span className="mb-1 block text-xs text-muted">Daily loss limit ($)</span><input type="number" value={f.risk.dailyLossUsd} onChange={(e) => setR({ dailyLossUsd: e.target.value })} placeholder="None" className={field} /></label>
            <label><span className="mb-1 block text-xs text-muted">Runs</span><select value={f.scheduleKind} onChange={(e) => set({ scheduleKind: e.target.value })} className={field}><option value="continuous">Continuously</option><option value="interval">On an interval</option><option value="condition">Only when a condition holds</option></select></label>
            <label><span className="mb-1 block text-xs text-muted">Check every (seconds)</span><input type="number" min={15} value={f.everySec} onChange={(e) => set({ everySec: e.target.value })} className={field} /></label>
            {f.scheduleKind === "condition" && <div className="flex gap-1.5"><input value={f.condSym} onChange={(e) => set({ condSym: e.target.value.toUpperCase() })} className={cx(field, "w-20")} /><select value={f.condOp} onChange={(e) => set({ condOp: e.target.value })} className={field}><option value="above">above</option><option value="below">below</option><option value="change_up">24h up %</option><option value="change_down">24h down %</option></select><input type="number" value={f.condVal} onChange={(e) => set({ condVal: e.target.value })} className={cx(field, "w-24")} /></div>}
          </section>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-[88px] xl:self-start">
          <section className="surface rounded-2xl p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-accent-2" /> Preview</h3>
            <dl className="space-y-1.5 text-[12.5px]">
              {[["Name", body.name], ["Role", role?.name ?? "—"], ["Assets", body.assets.join(", ") || (f.role === "market_scanner" ? "Whole market scan" : "—")], ["Mode", "Paper"], ["Autonomy", `${body.autonomy} · ${(cat.data?.autonomy ?? []).find((l: any) => l.level === body.autonomy)?.name ?? ""}`],
                ["Capital", trades ? fmtUsd(body.capitalUsd) : "None (read-only)"], ["Strategy", trades ? `${(cat.data?.strategies ?? []).find((s: any) => s.id === body.strategy.kind)?.label} · $${body.strategy.tradeUsd}/trade · TP ${body.strategy.takeProfitPct}% · SL ${body.strategy.stopLossPct}%` : "Analysis only"],
                ["Schedule", body.schedule.kind === "condition" ? `When ${f.condSym} ${f.condOp.replace("_", " ")} ${f.condVal}` : `${body.schedule.kind} · every ${body.schedule.everySec}s`], ["Model", (cat.data?.models ?? []).find((m: any) => m.id === f.model)?.label ?? f.model]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-3 rounded-lg bg-panel-2 p-2 text-[11px] text-muted">Orders go through the risk service and the paper order engine: permissions, price freshness, buying power, capital reservation and idempotency. The agent can&apos;t raise its own limits.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <GhostButton onClick={() => save(false)} disabled={busy}><Save className="size-4" /> Save</GhostButton>
              <GoldButton onClick={() => save(true)} disabled={busy}><Play className="size-4" /> Start paper</GoldButton>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
