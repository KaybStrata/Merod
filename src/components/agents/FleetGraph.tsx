"use client";
import Link from "next/link";
import { cx } from "@/components/ui";
import { AgentAvatar, STATUS, fmtSigned, toneOf } from "./common";

const OVERSIGHT = ["supervisor", "risk_management", "portfolio"];
const TRADING = ["stock_trading", "crypto_trading", "memecoin", "sniping", "mimic", "copy_trading", "execution", "exit", "arbitrage"];
const NODE_W = 216, NODE_H = 74, COL_GAP = 96, ROW_GAP = 22, PAD = 28;

/**
 * Fleet canvas: research → trading → oversight columns on a dot grid, joined by gold edges (animated while the
 * downstream agent runs). Click a node to inspect it (onSelect); without onSelect, nodes link to the agent page.
 */
export function FleetGraph({ agents, edges, selected, onSelect, className }: {
  agents: any[]; edges: { from?: string; to?: string }[]; selected?: string | null; onSelect?: (id: string) => void; className?: string;
}) {
  const col = (a: any) => (OVERSIGHT.includes(a.role) ? 2 : TRADING.includes(a.role) ? 1 : 0);
  const cols = [0, 1, 2].map((c) => agents.filter((a) => col(a) === c));
  const used = cols.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
  const colX = new Map(used.map((c, i) => [c, PAD + i * (NODE_W + COL_GAP)]));
  const rows = Math.max(1, ...cols.map((c) => c.length));
  const W = PAD * 2 + Math.max(1, used.length) * NODE_W + Math.max(0, used.length - 1) * COL_GAP;
  const H = Math.max(260, PAD * 2 + 22 + rows * NODE_H + (rows - 1) * ROW_GAP);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, ci) => {
    const block = c.length * NODE_H + Math.max(0, c.length - 1) * ROW_GAP;
    const top = 22 + PAD + (H - 22 - PAD * 2 - block) / 2;
    c.forEach((a, i) => pos.set(a.id, { x: colX.get(ci)!, y: top + i * (NODE_H + ROW_GAP) }));
  });
  // Fall back to column-to-column links when the fleet has no explicit edges.
  const links = edges.length ? edges : agents.flatMap((a) => col(a) === 0 ? cols[1].map((b) => ({ from: a.id, to: b.id })) : col(a) === 1 ? cols[2].map((b) => ({ from: a.id, to: b.id })) : []);
  const byId = new Map(agents.map((a) => [a.id, a]));
  if (!agents.length) return <div className={cx("flex h-64 items-center justify-center text-[13px] text-muted", className)}>No agents in this fleet yet.</div>;
  return (
    <div className={cx("relative overflow-auto rounded-xl", className)} style={{ backgroundImage: "radial-gradient(var(--line-2) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
      <div className="relative mx-auto" style={{ width: W, height: H }}>
        <svg width={W} height={H} className="absolute inset-0">
          <defs>
            <marker id="fleet-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--accent)" /></marker>
          </defs>
          {links.map((e, i) => {
            const a = e.from && pos.get(e.from), b = e.to && pos.get(e.to); if (!a || !b) return null;
            const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x - 3, y2 = b.y + NODE_H / 2, mid = (x1 + x2) / 2;
            const live = byId.get(e.to!)?.status === "running";
            const hot = selected && (e.from === selected || e.to === selected);
            return (
              <path key={i} d={`M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" markerEnd="url(#fleet-arrow)"
                stroke="var(--accent)" strokeOpacity={hot ? 0.95 : 0.45} strokeWidth={hot ? 1.6 : 1.1} strokeDasharray={live ? "5 5" : undefined}
                className={live ? "fleet-flow" : undefined} />
            );
          })}
        </svg>
        {used.map((ci) => (
          <div key={ci} className="absolute text-[9.5px] font-semibold uppercase tracking-[0.16em] text-faint" style={{ left: colX.get(ci), top: PAD - 6 }}>
            {["Research & discovery", "Trading", "Oversight"][ci]}
          </div>
        ))}
        {agents.map((a) => {
          const p = pos.get(a.id)!;
          const s = STATUS[a.status] ?? STATUS.draft;
          const body = (
            <>
              <div className="flex items-center gap-2.5">
                <AgentAvatar agent={a} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold leading-tight">{a.name}</span>
                  <span className="block truncate text-[10.5px] text-muted">{a.roleName}</span>
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={cx("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-semibold", s.text, a.status === "running" ? "border-up/30 bg-up-soft" : a.status === "risk_blocked" || a.status === "failed" ? "border-down/30 bg-down-soft" : "border-line-2 bg-panel-2")}>
                  <span className={cx("size-1 rounded-full", s.dot, a.status === "running" && "pulse-dot")} />{s.label}
                </span>
                {a.metrics && <span className={cx("num text-[10.5px] font-medium", toneOf(a.metrics.pnl))}>{fmtSigned(a.metrics.pnl)}</span>}
              </div>
            </>
          );
          const cls = cx("absolute rounded-xl border bg-panel/95 p-2.5 text-left shadow-[0_8px_24px_-12px_rgba(0,0,0,.8)] transition-colors",
            selected === a.id ? "border-accent/70 ring-1 ring-accent/40" : "border-line-2 hover:border-accent/40");
          const style = { left: p.x, top: p.y, width: NODE_W, height: NODE_H };
          return onSelect
            ? <button key={a.id} onClick={() => onSelect(a.id)} className={cls} style={style}>{body}</button>
            : <Link key={a.id} href={`/agents/${a.id}`} className={cls} style={style}>{body}</Link>;
        })}
      </div>
      <style>{`@keyframes fleetflow{to{stroke-dashoffset:-20}}.fleet-flow{animation:fleetflow 1.2s linear infinite}`}</style>
    </div>
  );
}
