"use client";
import { useState } from "react";
import Link from "next/link";
import { Layers, Play, Pause, Square, Archive, Copy, Sparkles, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronRight, Loader2, Pencil } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { MimicTabs } from "@/components/MimicTabs";
import { Badge, Button, Empty, Input, cx, useToast } from "@/components/ui";
import { ago, usd } from "@/lib/format";

const STATE_TONE: Record<string, any> = { RUNNING: "up", PAUSED: "warn", PAUSING: "warn", DRAFT: "neutral", READY: "info", VALIDATING: "info", BLOCKED: "down", ERROR: "down", DEGRADED: "warn", STOPPED: "neutral", STOPPING: "warn", ARCHIVED: "neutral", AWAITING_APPROVAL: "warn" };

/** Merod Multi: build strategies from a prompt (Strategy Lab) and run several sessions at once, each with its own budget. */
export default function SessionsPage() {
  const { data, refresh } = useApi<any>("/api/sessions", { refreshMs: 10_000 });
  const strategies = useApi<any>("/api/strategies");
  useRealtime((e: any) => { if (["session", "order", "fill", "bot_log"].includes(e.type)) refresh(); });
  const toast = useToast();
  const sessions: any[] = data?.sessions ?? [];
  const running = sessions.filter((s) => s.state === "RUNNING").length;
  const allocated = sessions.filter((s) => ["READY", "RUNNING", "PAUSED", "PAUSING", "DEGRADED", "AWAITING_APPROVAL"].includes(s.state)).reduce((t, s) => t + Number(s.allocation_usd), 0);
  async function all(action: "start_all" | "pause_all") {
    try { const r = await api("/api/sessions", { method: "POST", json: { action } }); const errs = r.results.filter((x: any) => x.error || x.state === "BLOCKED").length; toast(`${action === "start_all" ? "Started" : "Paused"} ${r.results.length - errs} session(s)${errs ? `, ${errs} blocked` : ""}`, errs ? "down" : "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <div className="space-y-4">
      <MimicTabs />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title"><Layers className="size-6 text-accent-2" /> Sessions</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Run several strategies at once, each with its own budget. Sessions keep running on Merod&apos;s servers when you close the browser. Every order goes through the risk checks, and cash is reserved per order so two sessions can never spend the same money.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => all("start_all")}><Play className="size-4" /> Start all</Button>
          <Button onClick={() => all("pause_all")}><Pause className="size-4" /> Pause all</Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-2xl border border-line bg-panel/80 p-3"><div className="text-xs text-muted">Sessions</div><div className="num text-lg font-semibold">{sessions.length}</div></div>
        <div className="rounded-2xl border border-line bg-panel/80 p-3"><div className="text-xs text-muted">Running</div><div className="num text-lg font-semibold text-up">{running}</div></div>
        <div className="rounded-2xl border border-line bg-panel/80 p-3"><div className="text-xs text-muted">Capital allocated</div><div className="num text-lg font-semibold">{usd(allocated)}</div></div>
      </div>

      <StrategyLab strategies={strategies.data?.strategies ?? []} onSaved={() => { strategies.refresh(); refresh(); }} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Your sessions</h2>
        {!data ? <div className="text-xs text-muted">Loading…</div> : sessions.length === 0
          ? <Empty icon={<Layers className="size-6" />} title="No sessions yet">Describe a strategy above, save it, then start a session with a budget.</Empty>
          : sessions.map((s) => <SessionCard key={s.id} s={s} onChange={refresh} />)}
      </section>
    </div>
  );
}

function StrategyLab({ strategies, onSaved }: { strategies: any[]; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [alloc, setAlloc] = useState("500");
  const [title, setTitle] = useState("");
  async function doCompile() {
    setBusy(true);
    try { setRes(await api("/api/strategies/compile", { method: "POST", json: { text } })); } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  async function saveAndCreate() {
    if (!res?.draft) return;
    setBusy(true);
    try {
      const st = await api("/api/strategies", { method: "POST", json: { rules: res.draft, sourcePrompt: text } });
      await api("/api/sessions", { method: "POST", json: { title: title || res.draft.name, strategyVersionId: st.version.id, allocationUsd: Number(alloc) } });
      toast("Strategy saved and session created (draft). Press Start to run it.", "up");
      setRes(null); setText(""); setTitle(""); onSaved();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-3">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-accent-2" /> Strategy Lab</h2>
      <p className="mb-2 text-xs text-muted">Describe a strategy. Merod turns it into exact rules you can check before anything runs; it never places an order from here.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) doCompile(); }} className="flex flex-wrap gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. buy $50 of SOL after a 5% dip and sell at 8% profit, repeat" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg-2 px-3 text-sm outline-none focus:border-accent" />
        <Button variant="primary" loading={busy && !res} disabled={!text.trim()}>Build rules</Button>
      </form>
      <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
        {["buy $50 of SOL after a 5% dip and sell at 8% profit, repeat", "buy $25 of BTC every week", "buy $100 of NVDA when it drops below 150", "monitor the top meme coins on solana"].map((x) => (
          <button key={x} onClick={() => setText(x)} className="rounded-full border border-line px-2 py-0.5 text-muted hover:text-text">{x}</button>
        ))}
      </div>
      {res && (
        <div className="mt-3 space-y-2 rounded-xl border border-line bg-bg/40 p-3 text-sm">
          {res.summary && <p className="font-medium">{res.summary}</p>}
          {res.errors.map((e: string, i: number) => <p key={i} className="flex gap-1.5 text-xs text-down"><XCircle className="mt-px size-3.5 shrink-0" />{e}</p>)}
          {res.missing.map((e: string, i: number) => <p key={i} className="flex gap-1.5 text-xs text-warn"><AlertTriangle className="mt-px size-3.5 shrink-0" />Missing: {e}</p>)}
          {res.warnings.map((e: string, i: number) => <p key={i} className="flex gap-1.5 text-xs text-muted"><AlertTriangle className="mt-px size-3.5 shrink-0" />{e}</p>)}
          {res.ok && !res.missing.length && <p className="flex gap-1.5 text-xs text-up"><CheckCircle2 className="mt-px size-3.5 shrink-0" />Rules are complete. Schema v{res.schemaVersion}, {res.draft.environment} environment, {res.draft.approvalPolicy} mode.</p>}
          {res.draft && <details className="text-[11px] text-muted"><summary className="cursor-pointer">Exact rules (JSON)</summary><pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-bg-2 p-2">{JSON.stringify(res.draft, null, 2)}</pre></details>}
          {res.ok && !res.missing.length && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <Input label="Session name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={res.draft.name} />
              <Input label="Budget for this session ($)" type="number" min={1} value={alloc} onChange={(e) => setAlloc(e.target.value)} />
              <Button variant="primary" loading={busy} onClick={saveAndCreate}>Save & create session</Button>
            </div>
          )}
          {res.missing.length > 0 && <p className="text-[11px] text-faint">Add the missing details to your description (e.g. “$50”) and build again.</p>}
        </div>
      )}
      {strategies.length > 0 && <p className="mt-2 text-[11px] text-faint">{strategies.length} saved strateg{strategies.length === 1 ? "y" : "ies"} · editing a strategy creates a new version; running sessions keep theirs.</p>}
    </section>
  );
}

function SessionCard({ s, onChange }: { s: any; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const detail = useApi<any>(open ? `/api/sessions/${s.id}` : null, { refreshMs: open ? 10_000 : 0 });
  async function act(action: string, extra: any = {}) {
    if (action === "stop" && !confirm(`Stop “${s.title}”? Its open orders are cancelled; positions it bought stay in your account.`)) return;
    setBusy(action);
    try { const r = await api(`/api/sessions/${s.id}/actions`, { method: "POST", json: { action, expectedRevision: s.revision, ...extra } }); const st = r.session?.state; toast(st === "BLOCKED" ? `Blocked: ${r.session.last_error}` : `${s.title}: ${action}${st ? ` → ${st.toLowerCase()}` : ""}`, st === "BLOCKED" || st === "ERROR" ? "down" : "up"); onChange(); }
    catch (e: any) { toast(e.message, "down"); onChange(); } finally { setBusy(null); }
  }
  const btn = (a: string, label: string, Icon: any, show: boolean, danger = false) => show && (
    <Button key={a} size="sm" variant={danger ? "ghost" : "secondary"} className={danger ? "text-down" : ""} loading={busy === a} disabled={!!busy} onClick={() => act(a)}><Icon className="size-3.5" /> {label}</Button>
  );
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 items-start gap-2 text-left">
          {open ? <ChevronDown className="mt-0.5 size-4 text-muted" /> : <ChevronRight className="mt-0.5 size-4 text-muted" />}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 font-semibold">{s.title} <Badge tone={STATE_TONE[s.state]}>{s.state.toLowerCase().replace("_", " ")}</Badge><Badge tone={s.environment === "live" ? "down" : "warn"}>{s.environment}</Badge><Badge>{s.mode}</Badge></span>
            <span className="block text-xs text-muted">{s.summary}</span>
            <span className="block text-[11px] text-faint">{s.strategy_name} · v{s.version} · #{s.hash} · budget {usd(Number(s.allocation_usd))}{s.pnl_usd != null ? ` · P&L ${usd(Number(s.pnl_usd), { sign: true })}` : ""}{s.trades_today != null ? ` · ${s.trades_today} trades today` : ""}{s.open_orders ? ` · ${s.open_orders} open order(s)` : ""} · rev {s.revision}</span>
          </span>
        </button>
        <div className="flex flex-wrap gap-1.5">
          {btn("start", "Start", Play, ["DRAFT", "READY", "STOPPED", "BLOCKED", "ERROR"].includes(s.state))}
          {btn("resume", "Resume", Play, ["PAUSED", "DEGRADED"].includes(s.state))}
          {btn("pause", "Pause", Pause, ["RUNNING", "AWAITING_APPROVAL"].includes(s.state))}
          {btn("stop", "Stop", Square, ["RUNNING", "PAUSED", "BLOCKED", "DEGRADED", "ERROR", "READY"].includes(s.state), true)}
          {btn("clone", "Clone", Copy, true)}
          {btn("archive", "Archive", Archive, ["STOPPED", "DRAFT", "BLOCKED", "ERROR"].includes(s.state))}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { const t = prompt("Rename session", s.title); if (t && t.trim()) act("rename", { title: t.trim() }); }}><Pencil className="size-3.5" /></Button>
        </div>
      </div>
      {s.last_error && ["BLOCKED", "ERROR"].includes(s.state) && <p className="mt-2 flex gap-1.5 rounded-lg bg-down-soft px-2 py-1.5 text-xs text-down"><XCircle className="mt-px size-3.5 shrink-0" />{s.last_error}</p>}
      {open && (
        <div className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-3">
          {!detail.data ? <Loader2 className="size-4 animate-spin text-faint" /> : <>
            <div><h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">History</h4>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-[11px]">{detail.data.events.map((e: any, i: number) => <li key={i}><b className="text-text">{e.action}</b> <span className="text-muted">{e.from_state ? `${e.from_state.toLowerCase()} → ` : ""}{e.to_state?.toLowerCase()}</span>{e.reason ? <span className="text-faint"> · {e.reason}</span> : null} <span className="text-faint">{ago(e.created_at)}</span></li>)}</ul></div>
            <div><h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Orders</h4>
              {detail.data.orders.length === 0 ? <p className="text-[11px] text-faint">No orders yet.</p> : <ul className="max-h-56 space-y-1 overflow-y-auto text-[11px]">{detail.data.orders.map((o: any) => <li key={o.id}><Link href={`/portfolio?order=${o.id}`} className="hover:text-accent-2"><b className={o.side === "buy" ? "text-up" : "text-down"}>{o.side.toUpperCase()}</b> {o.symbol} <span className="text-muted">{o.status}</span>{o.status_reason && o.status === "rejected" ? <span className="text-faint"> · {String(o.status_reason).slice(0, 80)}</span> : null}</Link></li>)}</ul>}</div>
            <div><h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Live activity</h4>
              {detail.data.logs.length === 0 ? <p className="text-[11px] text-faint">{s.mode === "observation" ? "Watch-only session: no orders are placed." : "Waiting for the first decision…"}</p> : <ul className="max-h-56 space-y-1 overflow-y-auto text-[11px]">{detail.data.logs.map((l: any, i: number) => <li key={i} className={cx(l.level === "error" ? "text-down" : l.level === "order" ? "text-up" : "text-muted")}>{l.message} <span className="text-faint">{ago(l.created_at)}</span></li>)}</ul>}</div>
          </>}
        </div>
      )}
    </div>
  );
}
