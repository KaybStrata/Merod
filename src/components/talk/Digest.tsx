"use client";
import { PortfolioSpark } from "./PortfolioSpark";
import { Clock } from "lucide-react";
import { cx } from "@/components/ui";
import { usd } from "./widgets/Widgets";

export type DigestT = {
  greetingName: string; since: string;
  portfolio: { total: number; overnight: number; cash: number; riskUsedPct: number | null };
  events: { at: string; kind: string; agent?: string | null; text: string; pnl?: number | null }[];
};
const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const hm = (t: string) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });

/** "While you were away": serif greeting, 4 stat tiles and what happened since the last visit (all from the user's own data). */
export function Digest({ d }: { d: DigestT }) {
  const p = d.portfolio;
  const up = p.overnight >= 0;
  const n = d.events.length;
  return (
    <section className="fade-up">
      <div className="mb-3 text-center text-[10.5px] font-semibold uppercase tracking-[0.2em] text-faint">
        {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} · {hm(new Date().toISOString())}
      </div>
      <div className="flex items-start gap-3">
        <MerodAvatar />
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold leading-snug tracking-tight sm:text-[24px]">
            {greet()}{d.greetingName ? `, ${d.greetingName}` : ""}. {n ? `${n} thing${n === 1 ? "" : "s"} happened since you left` : "A quiet stretch since you left"}
            {Math.abs(p.overnight) >= 0.01 && <> — you&apos;re <span className={cx("serif-accent text-[1.12em]", up ? "text-accent-2" : "text-down")}>{up ? "up" : "down"} {usd(Math.abs(p.overnight), 0)}</span> today</>}.
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile label="Portfolio" value={usd(p.total, 0)} />
            <Tile label="Today" value={`${up ? "+" : ""}${usd(p.overnight, 0)}`} tone={up ? "up" : "down"} sub={p.total ? `${((p.overnight / Math.max(1, p.total - p.overnight)) * 100).toFixed(2)}%` : undefined}><PortfolioSpark compact height={34} className="mt-1" /></Tile>
            <Tile label="Cash" value={usd(p.cash, 0)} />
            <div className="rounded-xl border border-line bg-panel/60 px-3 py-2.5">
              <div className="text-[11.5px] text-muted">Risk used</div>
              {p.riskUsedPct == null ? <div className="num text-[17px] font-semibold">No limit</div>
                : <><div className="num text-[17px] font-semibold">{p.riskUsedPct} <span className="text-[11px] text-faint">/ 100%</span></div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-panel-2"><span className="block h-full bg-accent" style={{ width: `${Math.min(100, p.riskUsedPct)}%` }} /></div></>}
            </div>
          </div>
          {n > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted"><Clock className="size-3.5" /> While you were away · {n} action{n === 1 ? "" : "s"}</div>
              <ol className="mt-1.5 divide-y divide-line/60">
                {d.events.slice(0, 8).map((e, i) => (
                  <li key={i} className="flex items-center gap-3 py-1.5 text-[13px]">
                    <span className="num w-11 shrink-0 text-[11.5px] text-faint">{hm(e.at)}</span>
                    <span className={cx("size-1.5 shrink-0 rounded-full", e.kind === "fill" ? "bg-up" : e.kind === "alert" ? "bg-warn" : "bg-accent-2")} />
                    <span className="min-w-0 flex-1 truncate">{e.agent && <b className="font-semibold">{e.agent} </b>}{e.text}</span>
                    {e.pnl != null && <span className={cx("num shrink-0", e.pnl >= 0 ? "text-up" : "text-down")}>{e.pnl >= 0 ? "+" : ""}{usd(e.pnl, 0)}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, tone, sub, children }: { label: string; value: string; tone?: "up" | "down"; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel/60 px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cx("num text-[17px] font-semibold", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}{sub && <span className="ml-1.5 text-[11px] font-normal">{sub}</span>}</div>
      {children}
    </div>
  );
}

export function MerodAvatar() {
  return (
    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-panel">
      <svg viewBox="0 0 24 24" className="size-4 text-accent-2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 17V8.5c0-2 2.6-2.8 3.8-1.2L12 13l4.2-5.7c1.2-1.6 3.8-.8 3.8 1.2V17" /></svg>
    </span>
  );
}
