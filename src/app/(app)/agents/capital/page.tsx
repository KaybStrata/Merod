"use client";
import Link from "next/link";
import { useState } from "react";
import { Shield, OctagonX, Ban, LogOut, AlertTriangle } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { PageHead, GhostButton, GoldButton, fmtUsd } from "@/components/agents/common";

/** Capital & Risk (screen 8): allocation sliders, cash reserve, exposure, loss caps, permissions, stop controls, approvals. */
export default function CapitalRisk() {
  const cap = useApi<any>("/api/agents/capital", { refreshMs: 30000 });
  const agents = useApi<any>("/api/agents", { refreshMs: 30000 });
  const fleets = useApi<any>("/api/agents/fleets");
  const orders = useApi<any>("/api/orders?status=open");
  const toast = useToast();
  const [edits, setEdits] = useState<Record<string, number>>({});
  const c = cap.data;
  const list: any[] = (agents.data?.agents ?? []).filter((a: any) => ["stock_trading", "crypto_trading", "memecoin", "sniping", "mimic", "copy_trading", "execution", "exit"].includes(a.role));
  const total = c?.total ?? 0;
  const planned = list.reduce((s, a) => s + (edits[a.id] ?? a.metrics.capital), 0);
  const over = planned + (c?.fleetsReserve ?? 0) > total;
  async function apply() {
    try {
      // Lower first, then raise, so the atomic allocation check never trips on ordering.
      const changes = list.filter((a) => edits[a.id] != null && edits[a.id] !== a.metrics.capital).sort((x, y) => (edits[x.id] - x.metrics.capital) - (edits[y.id] - y.metrics.capital));
      for (const a of changes) await api(`/api/agents/${a.id}`, { method: "PATCH", json: { capitalUsd: edits[a.id], note: "Capital reallocated" } });
      toast(`Updated ${changes.length} allocation${changes.length === 1 ? "" : "s"}`, "up"); setEdits({}); cap.refresh(); agents.refresh();
    } catch (e: any) { toast(e.message, "down"); }
  }
  async function stopAll(kind: "pause" | "cancel" | "close") {
    const msg = { pause: "Disable new orders for every agent? Positions and pending orders stay.", cancel: "Cancel every pending agent order?", close: "Close EVERY agent position at market?" }[kind];
    if (!confirm(msg)) return;
    try {
      for (const a of agents.data?.agents ?? []) {
        if (kind === "pause" && ["running", "queued", "risk_blocked"].includes(a.status)) await api(`/api/agents/${a.id}/actions`, { method: "POST", json: { action: "pause", reason: "Account-wide stop" } }).catch(() => {});
        if (kind === "cancel") await api(`/api/agents/${a.id}/actions`, { method: "POST", json: { action: "cancel_orders" } }).catch(() => {});
        if (kind === "close" && a.metrics.positions > 0) await api(`/api/agents/${a.id}/actions`, { method: "POST", json: { action: "close_positions" } }).catch(() => {});
      }
      toast("Done. Outcomes are recorded per agent; broker confirmation decides final fills.", "neutral"); agents.refresh(); cap.refresh();
    } catch (e: any) { toast(e.message, "down"); }
  }
  const pending: any[] = (orders.data?.orders ?? []).filter((o: any) => o.source === "agent" && o.status === "pending_approval");
  return (
    <div>
      <PageHead eyebrow="Merod Sentinel" title="Capital &" accent="Risk" sub="Every agent spends from a virtual sub-ledger inside your paper account. Allocations can't exceed available funds, and capital is reserved atomically before each order." />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        {[["Total (cash + agent holdings)", fmtUsd(total)], ["Allocated to agents", fmtUsd(c?.allocated)], ["Invested by agents", fmtUsd(c?.invested)], ["Reserved (open orders)", fmtUsd(c?.reserved)], ["Pending approval", fmtUsd(c?.pending)], ["Unallocated / reserve", `${fmtUsd(c?.unallocated)} / ${fmtUsd(c?.fleetsReserve)}`]].map(([k, v]) => (
          <div key={k} className="surface rounded-xl px-3.5 py-2.5"><div className="text-[11px] text-muted">{k}</div><div className="num mt-1 text-[1.05rem] font-semibold">{v}</div></div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <section className="surface rounded-2xl p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Shield className="size-4 text-accent-2" /> Allocation</h3>
          {!list.length && <p className="text-sm text-muted">No trading agents yet.</p>}
          <div className="space-y-3">
            {list.map((a) => { const v = edits[a.id] ?? a.metrics.capital; const pct = total ? (v / total) * 100 : 0; return (
              <div key={a.id}>
                <div className="flex items-center justify-between text-sm"><Link href={`/agents/${a.id}`} className="font-medium hover:underline">{a.name}</Link><span className="num text-xs text-muted">{pct.toFixed(1)}% · invested {fmtUsd(a.metrics.invested)}</span></div>
                <div className="mt-1 flex items-center gap-3"><input type="range" min={0} max={Math.max(total, v)} step={50} value={v} onChange={(e) => setEdits({ ...edits, [a.id]: Number(e.target.value) })} className="flex-1 accent-[#d6b37a]" /><input type="number" value={v} onChange={(e) => setEdits({ ...edits, [a.id]: Number(e.target.value) })} className="num h-8 w-28 rounded-lg border border-line bg-panel-2 px-2 text-right text-sm" /></div>
              </div>
            ); })}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
            <span className={over ? "text-down" : "text-muted"}>{over ? <><AlertTriangle className="mr-1 inline size-4" />Over-allocated: {fmtUsd(planned)} of {fmtUsd(total)}</> : <>Planned {fmtUsd(planned)} · cash reserve {fmtUsd(Math.max(0, total - planned))} ({total ? (((total - planned) / total) * 100).toFixed(0) : 0}%)</>}</span>
            <GoldButton onClick={apply} disabled={!Object.keys(edits).length || over}>Apply allocations</GoldButton>
          </div>
        </section>
        <div className="space-y-4">
          <section className="surface space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-semibold">Account-wide stops</h3>
            <p className="text-[11px] text-muted">Three separate actions. None of them guarantees immediate liquidation or a maximum loss.</p>
            <GhostButton className="w-full justify-start" onClick={() => stopAll("pause")}><Ban className="size-4" /> Disable new orders (pause all agents)</GhostButton>
            <GhostButton className="w-full justify-start" onClick={() => stopAll("cancel")}><OctagonX className="size-4" /> Cancel pending agent orders</GhostButton>
            <GhostButton className="w-full justify-start text-down" onClick={() => stopAll("close")}><LogOut className="size-4" /> Close all agent positions</GhostButton>
          </section>
          <section className="surface rounded-2xl p-4">
            <h3 className="mb-2 text-sm font-semibold">Fleet loss caps</h3>
            {(fleets.data?.fleets ?? []).map((f: any) => <Link key={f.id} href={`/agents/fleets/${f.id}`} className="flex justify-between py-1 text-sm hover:underline"><span>{f.name}</span><span className={cx("text-xs", f.status === "risk_blocked" ? "text-down" : "text-muted")}>{Number(f.daily_loss_pct)}% / day · {f.status.replace("_", " ")}</span></Link>)}
            {!(fleets.data?.fleets ?? []).length && <p className="text-xs text-muted">No fleets.</p>}
          </section>
          <section className="surface rounded-2xl p-4">
            <h3 className="mb-2 text-sm font-semibold">Permissions</h3>
            <ul className="space-y-1.5 text-[12px] text-muted">
              <li>• Agents run in <b className="text-warn">paper</b> mode. Live execution is locked until separately authorised.</li>
              <li>• Research roles never receive capital or trading permissions.</li>
              <li>• No agent, prompt, supervisor or template can raise autonomy, capital or limits.</li>
              <li>• Supervised (level 4) orders wait for your approval: {pending.length} pending. <Link href="/portfolio" className="text-accent-2 underline">Review</Link></li>
              <li>• Account automation limits: <Link href="/settings" className="text-accent-2 underline">Settings → Trading permissions</Link></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
