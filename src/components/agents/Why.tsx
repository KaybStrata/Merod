"use client";
import { useState } from "react";
import { ThumbsUp, ThumbsDown, HelpCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx } from "@/components/ui";

const REASONS: [string, string][] = [["good_call", "Good call"], ["too_risky", "Too risky"], ["bad_timing", "Bad timing"], ["wrong_asset", "Wrong asset"], ["too_big", "Too big"]];

/** Compact "Why?" + 👍/👎 for feeds; expands into the full Why card. */
export function WhyLine({ eventId, className }: { eventId: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("mt-1", className)} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <button onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-accent-2 hover:border-accent/50"><HelpCircle className="size-3" />{open ? "Hide why" : "Why?"}</button>
        {!open && <Vote eventId={eventId} compact />}
      </div>
      {open && <WhyCard eventId={eventId} className="mt-1.5" />}
    </div>
  );
}

/** Full Why card: plain-English explanation from recorded inputs, what triggered it, risk checks, result, and the rating. */
export function WhyCard({ eventId, className }: { eventId: number; className?: string }) {
  const { data, error, refresh } = useApi<any>(`/api/agents/events/${eventId}/explain`);
  if (error) return <div className={cx("rounded-lg border border-line p-2 text-[11.5px] text-down", className)}>{error}</div>;
  if (!data) return <div className={cx("flex items-center gap-1.5 rounded-lg border border-line p-2 text-[11.5px] text-faint", className)}><Loader2 className="size-3 animate-spin" /> Loading the explanation…</div>;
  const checks = data.checks ?? [];
  const passed = checks.filter((c: any) => c.ok).length;
  return (
    <div className={cx("rounded-xl border border-line bg-bg-2/70 p-3 text-[12px]", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("rounded px-1.5 text-[10px] font-bold uppercase", data.side === "sell" ? "bg-down/15 text-down" : "bg-up/15 text-up")}>{data.side}</span>
        <span className="font-semibold text-text">{data.symbol}</span>
        <span className="text-[10.5px] text-faint">{new Date(data.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · rule v{data.version ?? "?"}</span>
        {data.result && <span className={cx("num ml-auto font-semibold", data.result.pnl >= 0 ? "text-up" : "text-down")}>{data.result.label}</span>}
      </div>
      <p className="mt-1.5 leading-relaxed text-text">“{data.text}”</p>
      <p className="text-[10px] text-faint">{data.hasInputs ? "Written from the recorded inputs below. Nothing is invented." : "This decision didn't record its market inputs."}</p>
      {data.rows?.length > 0 && (
        <table className="mt-2 w-full text-[11px]">
          <thead className="text-left text-[9.5px] uppercase tracking-wide text-faint"><tr><th className="py-0.5 font-medium">What triggered it</th><th className="font-medium">Value</th><th className="font-medium">Rule</th><th /></tr></thead>
          <tbody>{data.rows.map((r: any, i: number) => (
            <tr key={i} className="border-t border-line/50"><td className="py-1 text-muted">{r.input}</td><td className="num">{r.value}</td><td className="text-muted">{r.rule}</td><td className="text-right">{r.rule === "context" ? "" : r.ok ? <CheckCircle2 className="inline size-3.5 text-up" /> : <XCircle className="inline size-3.5 text-down" />}</td></tr>
          ))}</tbody>
        </table>
      )}
      {checks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 text-[10.5px]">
          <span className={cx("font-semibold", passed === checks.length ? "text-up" : "text-warn")}>{passed}/{checks.length} risk checks passed</span>
          {checks.slice(0, 8).map((c: any) => <span key={c.name} title={c.message} className={cx("rounded border px-1", c.ok ? "border-line text-muted" : "border-down/40 text-down")}>{c.name.replace(/_/g, " ")} {c.ok ? "✓" : "✗"}</span>)}
        </div>
      )}
      <div className="mt-2.5 border-t border-line pt-2"><div className="mb-1 text-[11px] font-semibold">Would you have done this?</div><Vote eventId={eventId} initial={data.myVote} onVoted={refresh} /></div>
    </div>
  );
}

/** 👍/👎 with optional reason chips. Teaches the agent; never changes its rules by itself. */
function Vote({ eventId, initial, compact, onVoted }: { eventId: number; initial?: { vote: number; reasons: string[] } | null; compact?: boolean; onVoted?: () => void }) {
  const [vote, setVote] = useState<number | null>(initial?.vote ?? null);
  const [reasons, setReasons] = useState<string[]>(initial?.reasons ?? []);
  const [agree, setAgree] = useState<{ agreedPct: number | null; rated: number } | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(v: number, rs: string[]) {
    setBusy(true);
    try { const r: any = await api(`/api/agents/events/${eventId}/feedback`, { method: "POST", json: { vote: v, reasons: rs } }); setAgree(r.agreement); onVoted?.(); }
    catch { /* keep the local state */ } finally { setBusy(false); }
  }
  const pick = (v: number) => { setVote(v); const rs = v === 1 ? reasons.filter((r) => r === "good_call") : reasons.filter((r) => r !== "good_call"); setReasons(rs); send(v, rs); };
  const chip = (r: string) => { const next = reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r]; setReasons(next); if (vote) send(vote, next); };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button disabled={busy} onClick={(e) => { e.preventDefault(); pick(1); }} aria-pressed={vote === 1} className={cx("flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]", vote === 1 ? "border-up/50 bg-up/15 text-up" : "border-line text-muted hover:text-text")}><ThumbsUp className="size-3" />{!compact && " Yes"}</button>
        <button disabled={busy} onClick={(e) => { e.preventDefault(); pick(-1); }} aria-pressed={vote === -1} className={cx("flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]", vote === -1 ? "border-down/50 bg-down/15 text-down" : "border-line text-muted hover:text-text")}><ThumbsDown className="size-3" />{!compact && " No"}</button>
        {agree && agree.agreedPct != null && <span className="text-[10.5px] text-faint">You agree with {agree.agreedPct}% ({agree.rated} rated)</span>}
      </div>
      {vote != null && !compact && (
        <>
          <div className="flex flex-wrap gap-1">{REASONS.filter(([k]) => (vote === 1 ? k === "good_call" : k !== "good_call")).map(([k, l]) => (
            <button key={k} onClick={(e) => { e.preventDefault(); chip(k); }} className={cx("rounded-full border px-2 py-0.5 text-[10.5px]", reasons.includes(k) ? "border-accent/50 bg-accent-soft text-accent-2" : "border-line text-muted hover:text-text")}>{l}</button>
          ))}</div>
          <p className="text-[10px] text-faint">Your answer teaches the agent. It never changes its rules by itself; you approve any change.</p>
        </>
      )}
    </div>
  );
}

/** "You agreed with 82% of Vega's trades (34 rated)". */
export function AgreementBadge({ agentId, name }: { agentId: string; name?: string }) {
  const { data } = useApi<any>(`/api/agents/${agentId}/feedback`);
  if (!data || !data.rated) return null;
  return (
    <span title={(data.topReasons ?? []).map((r: any) => `${r.label}: ${r.count}`).join(" · ")} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
      You agreed with <b className="text-text">{data.agreedPct}%</b> of {name ? `${name}'s` : "its"} trades ({data.rated} rated)
    </span>
  );
}
