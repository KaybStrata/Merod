"use client";
import { useState } from "react";
import { Bot, Sparkles, X } from "lucide-react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";
import { ago } from "@/lib/format";
import { TipRow } from "@/components/shell/AdvisorPanel";

const $ = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const p = (n: number | null | undefined) => (n == null || Number(n) === 0 ? "—" : `${n}%`);

/**
 * Map side panel: everything about your bots, agents and trades in one place.
 *   Setups  – every bot and agent now (status, $ per trade, stop, target, dip, capital) and every settings change made to them.
 *   Actions – trades, fills, Mimic copies and agent decisions, newest first.
 *   Advice  – the Advisor's suggestions (apply in one click) and every Update / Recording analysis.
 */
export function MapHistory({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"setups" | "actions" | "advice">("setups");
  const setups = useApi<any>(tab === "setups" ? "/api/bots/bulk" : null, { refreshMs: 20_000 });
  const changes = useApi<any>(tab === "setups" ? "/api/live-stream?filter=bot&limit=300" : null, { refreshMs: 20_000 });
  const agentEv = useApi<any>(tab === "setups" || tab === "actions" ? "/api/live-stream?filter=agent&limit=200" : null, { refreshMs: 20_000 });
  const trades = useApi<any>(tab === "actions" ? "/api/live-stream?filter=trades&limit=200" : null, { refreshMs: 15_000 });
  const tips = useApi<any>(tab === "advice" ? "/api/advisor?limit=60" : null, { refreshMs: 15_000 });
  const updates = useApi<any>(tab === "advice" ? "/api/live-stream?filter=update&limit=100" : null, { refreshMs: 20_000 });

  const configLines = [
    ...((changes.data?.items ?? []) as any[]).filter((i) => i.kind === "state"),
    ...((agentEv.data?.items ?? []) as any[]).filter((i) => i.kind === "state" || /updated|changed|revision|settings/i.test(i.title)),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  const actions = [...((trades.data?.items ?? []) as any[]), ...((agentEv.data?.items ?? []) as any[]).filter((i) => i.kind === "decision" || i.kind === "execution")]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);

  return (
    <aside className="surface flex w-80 shrink-0 flex-col rounded-2xl">
      <div className="flex items-center gap-1 border-b border-line p-2">
        {(["setups", "actions", "advice"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-md px-2 py-1 text-[12px] capitalize", tab === k ? "bg-accent/20 text-accent-2" : "text-muted hover:text-text")}>{k}</button>
        ))}
        <button onClick={onClose} className="ml-auto rounded-md p-1 text-faint hover:text-text" aria-label="Close panel"><X className="size-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 text-[12px]">
        {tab === "setups" && (
          <>
            <div className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Now</div>
            {(setups.data?.items ?? []).map((r: any) => (
              <div key={r.id} className="rounded-lg border border-line p-2">
                <div className="flex items-center gap-1.5">{r.kind === "bot" ? <Bot className="size-3.5 text-sky-300" /> : <Sparkles className="size-3.5 text-violet-300" />}<span className="truncate font-medium">{r.name}</span><span className={cx("ml-auto text-[10.5px]", r.status === "running" ? "text-up" : "text-muted")}>{r.status.replace("_", " ")}</span></div>
                <div className="mt-0.5 text-[11px] text-muted">{r.detail}</div>
                <div className="num mt-1 text-[11px] text-muted">{$(r.amountUsd)}/trade · stop {p(r.stopLossPct)} · target {p(r.takeProfitPct)}{r.dipPct ? ` · dip ${r.dipPct}%` : ""}{r.kind === "agent" ? ` · capital ${$(r.capitalUsd)}` : ""}</div>
              </div>
            ))}
            {setups.data && !(setups.data.items ?? []).length && <p className="px-1 text-muted">No bots or agents yet.</p>}
            <div className="px-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Settings changes (last 30 days)</div>
            {configLines.map((i) => <Line key={i.id} i={i} />)}
            {changes.data && !configLines.length && <p className="px-1 text-muted">No changes yet.</p>}
          </>
        )}
        {tab === "actions" && (
          <>
            {actions.map((i) => <Line key={i.id} i={i} />)}
            {trades.data && !actions.length && <p className="px-1 text-muted">No trades or decisions in the last 30 days.</p>}
          </>
        )}
        {tab === "advice" && (
          <>
            <div className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Advisor suggestions</div>
            {(tips.data?.tips ?? []).map((t: any) => <TipRow key={t.id} t={t} onDone={tips.refresh} />)}
            {tips.data && !(tips.data.tips ?? []).length && <p className="px-1 text-muted">{tips.data.settings?.active ? "No suggestions right now." : "The Advisor is off: turn it on in the left sidebar for continuous suggestions."}</p>}
            <div className="px-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Learn & Learning analyses</div>
            {(updates.data?.items ?? []).map((i: any) => <Line key={i.id} i={i} />)}
            {updates.data && !(updates.data.items ?? []).length && <p className="px-1 text-muted">None yet. Use Update / Record in Talk.</p>}
          </>
        )}
      </div>
    </aside>
  );
}

function Line({ i }: { i: any }) {
  const tone = i.kind === "execution" ? "border-l-up" : i.kind === "warning" ? "border-l-down" : i.kind === "decision" ? "border-l-accent" : "border-l-line";
  return (
    <div className={cx("rounded-md border border-line border-l-2 px-2 py-1.5", tone)}>
      <div className="flex items-center gap-1.5 text-[10.5px] text-faint"><span className="truncate">{i.actor}</span><span className="ml-auto shrink-0">{ago(i.at)}</span></div>
      <div className="text-[12px] leading-snug">{i.title}{i.pnl != null && <span className={cx("ml-1 text-[11px]", i.pnl >= 0 ? "text-up" : "text-down")}>{i.pnl >= 0 ? "+" : "−"}${Math.abs(i.pnl).toFixed(2)}</span>}</div>
      {i.body && <div className="mt-0.5 line-clamp-2 text-[11px] text-muted">{i.body}</div>}
    </div>
  );
}
