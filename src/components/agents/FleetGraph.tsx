"use client";
import Link from "next/link";
import { cx } from "@/components/ui";
import { AgentAvatar, StatusDot } from "./common";

/** Dependency view: research → trading → oversight columns with edges (directed, acyclic). */
export function FleetGraph({ agents, edges }: { agents: any[]; edges: { from?: string; to?: string }[] }) {
  const col = (a: any) => (["supervisor", "risk_management"].includes(a.role) ? 2 : ["stock_trading", "crypto_trading", "memecoin", "sniping", "mimic", "copy_trading", "execution", "exit"].includes(a.role) ? 1 : 0);
  const cols = [0, 1, 2].map((c) => agents.filter((a) => col(a) === c));
  const W = 900, rowH = 74, H = Math.max(160, Math.max(...cols.map((c) => c.length)) * rowH + 30);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, ci) => c.forEach((a, i) => pos.set(a.id, { x: 40 + ci * 300, y: 20 + i * rowH + (H - 30 - c.length * rowH) / 2 })));
  return (
    <div className="relative overflow-x-auto">
      <div className="relative" style={{ width: W, height: H }}>
        <svg width={W} height={H} className="absolute inset-0">
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#d6b37a" /></marker></defs>
          {edges.map((e, i) => { const a = e.from && pos.get(e.from), b = e.to && pos.get(e.to); if (!a || !b) return null;
            const x1 = a.x + 230, y1 = a.y + 28, x2 = b.x - 4, y2 = b.y + 28;
            return <path key={i} d={`M${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`} stroke="#d6b37a" strokeOpacity="0.55" strokeWidth="1.3" fill="none" markerEnd="url(#arrow)" />; })}
        </svg>
        {["Research & discovery", "Trading", "Oversight"].map((l, i) => <div key={l} className="absolute top-0 text-[10px] uppercase tracking-widest text-faint" style={{ left: 40 + i * 300 }}>{l}</div>)}
        {agents.map((a) => { const p = pos.get(a.id)!; return (
          <Link key={a.id} href={`/agents/${a.id}`} className={cx("surface surface-hover absolute flex w-[230px] items-center gap-2.5 rounded-xl p-2.5")} style={{ left: p.x, top: p.y + 10 }}>
            <AgentAvatar agent={a} size={30} />
            <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{a.name}</span><span className="flex items-center gap-2 text-[11px] text-muted"><span className="truncate">{a.roleName}</span><StatusDot status={a.status} /></span></span>
          </Link>
        ); })}
      </div>
    </div>
  );
}
