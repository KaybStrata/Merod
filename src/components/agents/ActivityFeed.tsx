"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ChevronDown } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { KIND, ROLE_ICON, clock } from "./common";

const FILTERS = [["all", "All"], ["thought", "Thoughts"], ["analysis", "Analysis"], ["decision", "Decisions"], ["execution", "Executions"]] as const;

/** Live agent activity: thoughts, analysis, decisions and executions streamed from the server-side workers. */
export function ActivityFeed({ agentId, fleetId, compact = false, title = "Live Agent Activity", className, limit = 60 }: { agentId?: string; fleetId?: string; compact?: boolean; title?: string; className?: string; limit?: number }) {
  const [kind, setKind] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>(agentId ?? "");
  const qs = new URLSearchParams({ limit: String(limit), kind, ...(agentFilter ? { agent: agentFilter } : {}), ...(fleetId ? { fleet: fleetId } : {}) });
  const { data, refresh } = useApi<any>(`/api/agents/events?${qs}`, { refreshMs: 15000 });
  const agents = useApi<any>(!agentId && !compact ? "/api/agents" : null);
  const last = useRef(0);
  useRealtime((e) => { if ((e.type === "agent" || e.type === "agent_message") && Date.now() - last.current > 1200) { last.current = Date.now(); refresh(); } });
  const events: any[] = data?.events ?? [];
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => { if (events[0]) { setFresh(events[0].id); const t = setTimeout(() => setFresh(null), 1500); return () => clearTimeout(t); } }, [events[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={cx("surface flex min-h-0 flex-col rounded-2xl", className)}>
      <header className="flex items-start justify-between gap-2 px-4 pb-2 pt-3.5">
        <div className="flex items-center gap-2.5">
          <Activity className="size-5 text-up" />
          <div>
            <h3 className="text-[1.05rem] font-semibold leading-tight">{title}</h3>
            {!compact && (
              <div className="flex items-center gap-1 text-[11px] text-muted">
                <span>Real-time</span><span>•</span>
                <label className="relative inline-flex items-center">
                  <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="appearance-none bg-transparent pr-4 text-[11px] text-muted outline-none" disabled={!!agentId}>
                    <option value="">All Agents</option>
                    {(agents.data?.agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 size-3" />
                </label>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="mx-3 mb-2 flex gap-1 rounded-xl border border-line bg-bg-2/60 p-1">
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} className={cx("flex-1 rounded-lg px-1.5 py-1 text-[11px] font-medium transition-colors", kind === k ? "nav-active" : "text-muted hover:text-text")}>{l}</button>
        ))}
      </div>
      <ol className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!events.length && <li className="px-2 py-8 text-center text-xs text-muted">No agent activity yet. Start an agent to see its thinking, analysis and trades here live.</li>}
        {events.map((e, i) => {
          const k = KIND[e.kind] ?? KIND.system;
          const Icon = e.kind === "execution" || e.kind === "analysis" || e.kind === "decision" ? k.icon : ROLE_ICON[e.agent_role] ?? k.icon;
          return (
            <li key={e.id} className={cx("relative flex gap-3 border-b border-line/60 py-2.5 pl-4 last:border-0", fresh === e.id && "fade-up")}>
              <span className={cx("absolute left-0 top-0 h-full w-px", i === events.length - 1 ? "bg-transparent" : "bg-line-2")} />
              <span className={cx("absolute -left-[3px] top-4 size-[7px] rounded-full", e.kind === "thought" ? "bg-[#b9a3f0]" : e.kind === "decision" ? "bg-[#6aa8ff]" : e.kind === "warning" ? "bg-warn" : e.kind === "approval" ? "bg-accent" : "bg-up")} />
              <span className={cx("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel-2", e.kind === "execution" ? "text-up" : e.kind === "decision" ? "text-[#8fbcff]" : e.kind === "thought" ? "text-[#c9b6ff]" : "text-up")}><Icon className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {e.agent_id ? <Link href={`/agents/${e.agent_id}`} className="truncate text-[13px] font-semibold hover:underline">{e.agent_name}</Link> : <span className="truncate text-[13px] font-semibold">Fleet</span>}
                    <span className={cx("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium", k.cls)}>{k.label}</span>
                  </span>
                  <span className="num shrink-0 text-[10px] text-faint">{clock(e.created_at)}</span>
                </div>
                <div className="mt-0.5 text-[12.5px] leading-snug text-text/90">{e.title}</div>
                {!compact && e.body && <div className="mt-0.5 line-clamp-3 text-[11.5px] leading-snug text-muted">{e.body}</div>}
                {e.data?.url && <a href={e.data.url} target="_blank" rel="noreferrer" className="text-[10px] text-accent-2 hover:underline">Source: {e.data.source ?? "article"} ↗</a>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
