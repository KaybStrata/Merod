"use client";
import { useState } from "react";
import { Trash2, Loader2, Play } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { AutoModesBar } from "@/components/AutoModesBar";
import { SkillText } from "@/components/SkillText";

const inp = "rounded-md border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60";
const btn = "rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted hover:text-text disabled:opacity-50";
const del = "rounded-md p-1 text-faint hover:text-down";
const Sw = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={cx("relative h-4 w-7 shrink-0 rounded-full transition", on ? "bg-accent" : "bg-panel-2 ring-1 ring-line")}>
    <span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-3.5" : "left-0.5")} />
  </button>
);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="p-4 text-[12.5px] text-muted">{children}</p>;

/** Skills & points: on/off, delete, all on/off. */
export function SkillsSection() {
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/skills", { refreshMs: 20_000 });
  const rows: any[] = data?.skills ?? [];
  const act = async (fn: () => Promise<any>) => { try { await fn(); await refresh(); } catch (e: any) { toast(e.message, "down"); } };
  const setAll = (on: boolean) => act(() => Promise.all(rows.filter((r) => r.active !== on).map((r) => api("/api/skills", { method: "PATCH", json: { kind: "skill", id: r.id, active: on } }))));
  if (!data) return <Empty>Loading…</Empty>;
  return (
    <div className="space-y-1.5 p-3">
      <div className="rounded-lg border border-teal-400/25 bg-teal-400/5 p-2">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-teal-300">Auto skills (all bots)</div>
        <AutoModesBar />
      </div>
      <div className="flex items-center gap-2 text-[12px]"><span className="font-semibold">{rows.length} skills & points</span>
        <button onClick={() => setAll(true)} className={cx(btn, "ml-auto")}>All on</button><button onClick={() => setAll(false)} className={btn}>All off</button></div>
      {!rows.length && <Empty>No skills or points. Create them from the Skills button in the prompt box.</Empty>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-1.5">
          <Sw on={r.active} label={`${r.name} on/off`} onClick={() => act(() => api("/api/skills", { method: "PATCH", json: { kind: "skill", id: r.id, active: !r.active } }))} />
          <SkillText s={r} onSaved={refresh} title={<><span className={cx("mr-1.5 rounded px-1 text-[9.5px] font-bold uppercase", r.kind === "point" ? "bg-rose-400/15 text-rose-300" : r.kind === "rule" ? "bg-sky-400/15 text-sky-300" : "bg-amber-300/15 text-amber-200")}>{r.kind === "rule" ? `rule · ${r.scope === "bot" ? (r.scope_name ?? "one bot") : r.scope === "bots" ? "all bots" : r.scope === "prompts" ? "prompts" : "everything"}` : r.kind ?? "skill"}</span>{r.name}</>} />
          <button onClick={() => { if (confirm("Delete this for good?")) void act(() => api(`/api/skills?id=${r.id}`, { method: "DELETE" })); }} className={del} aria-label="Delete"><Trash2 className="size-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

/** Auton: on/off, limits, speed, trade size, goals, its bots (delete any), run now. */
export function AutonSection() {
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/auton", { refreshMs: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const s = data?.settings;
  const save = async (patch: any, key = "save") => { setBusy(key); try { const r = await api("/api/auton", { method: "POST", json: patch }); if (r.run) toast(r.run.actions.length ? `Auton: ${r.run.actions.length} action(s)` : "Auton: nothing needed changing", "up"); await refresh(); } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); } };
  if (!s) return <Empty>Loading…</Empty>;
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  return (
    <div className="space-y-3 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Sw on={s.active} label="Auton on/off" onClick={() => save({ active: !s.active })} />
        <span className="font-semibold">Auton is {s.active ? "on" : "off"}</span>
        <span className="text-faint">{s.last_run_at ? `last check ${ago(s.last_run_at)}` : "never ran"} · {s.real_money ? "real money" : "paper"}</span>
        <button onClick={() => save({ runNow: true }, "run")} disabled={!!busy} className={cx(btn, "ml-auto inline-flex items-center gap-1")}>{busy === "run" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}Run now</button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[10.5px] text-muted">Budget $ (0 = no limit)<input defaultValue={s.max_capital_usd} onBlur={(e) => num(e.target.value) !== s.max_capital_usd && save({ maxCapitalUsd: num(e.target.value) })} className={cx(inp, "mt-0.5 w-full")} inputMode="decimal" /></label>
        <label className="text-[10.5px] text-muted">Max bots (0 = no limit)<input defaultValue={s.max_bots} onBlur={(e) => num(e.target.value) !== s.max_bots && save({ maxBots: Math.round(num(e.target.value)) })} className={cx(inp, "mt-0.5 w-full")} inputMode="numeric" /></label>
        <label className="text-[10.5px] text-muted">Check every (seconds, min 5)<input defaultValue={s.every_sec} onBlur={(e) => num(e.target.value) >= 5 && num(e.target.value) !== s.every_sec && save({ everySec: Math.round(num(e.target.value)) })} className={cx(inp, "mt-0.5 w-full")} inputMode="numeric" /></label>
        <label className="text-[10.5px] text-muted">$ per trade (no budget)<input defaultValue={s.trade_usd} onBlur={(e) => num(e.target.value) >= 1 && num(e.target.value) !== s.trade_usd && save({ tradeUsd: num(e.target.value) })} className={cx(inp, "mt-0.5 w-full")} inputMode="decimal" /></label>
      </div>
      <label className="block text-[10.5px] text-muted">Goals (what Auton should focus on)
        <textarea defaultValue={s.goals} rows={2} onBlur={(e) => e.target.value !== s.goals && save({ goals: e.target.value })} placeholder="e.g. solana meme coins, safe large caps, NVDA and TSLA…" className={cx(inp, "mt-0.5 w-full resize-none")} />
      </label>
      <label className="flex items-center gap-2 text-[11.5px] text-muted"><input type="checkbox" checked={!!s.real_money} onChange={(e) => { if (e.target.checked && !confirm("Let Auton trade REAL money? The real-money switch, 2FA and the order engine's checks still apply.")) return; void save({ realMoney: e.target.checked }); }} />Allow real money</label>
      <div className="rounded-lg border border-teal-400/25 bg-teal-400/5 p-2">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-teal-300">Auto switches (Auton's bots follow these too)</div>
        <AutoModesBar />
      </div>
      <AutonFleet bots={data.bots} agents={data.agents ?? []} refresh={refresh} />
    </div>
  );
}

/** Every bot and agent Auton made (including ones it made from a prompt): on/off, $ per trade, stop-loss, take-profit, capital, delete — one at a time or all at once. */
function AutonFleet({ bots, agents, refresh }: { bots: any[]; agents: any[]; refresh: () => any }) {
  const toast = useToast();
  const [all, setAll] = useState<{ amountUsd?: string; stopLossPct?: string; takeProfitPct?: string }>({});
  const bulk = async (targets: { kind: "bot" | "agent"; id: string }[], body: any, msg?: string) => {
    if (!targets.length) return;
    try { const r = await api("/api/bots/bulk", { method: "POST", json: { targets, ...body } }); toast(msg ?? (r.lines?.[0] ?? "Done"), "up"); await refresh(); } catch (e: any) { toast(e.message, "down"); }
  };
  const everyone = [...bots.map((b) => ({ kind: "bot" as const, id: b.id })), ...agents.map((g) => ({ kind: "agent" as const, id: g.id }))];
  const numOrNull = (v?: string) => (v == null || v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const applyAll = () => {
    const edit: any = {}; const a = numOrNull(all.amountUsd), sl = numOrNull(all.stopLossPct), tp = numOrNull(all.takeProfitPct);
    if (a != null) edit.amountUsd = a;
    if (sl != null) edit.stopLossPct = sl;
    if (tp != null) edit.takeProfitPct = tp;
    if (!Object.keys(edit).length) return toast("Type at least one value", "down");
    void bulk(everyone, { edit }, `Updated ${everyone.length} of Auton's bots/agents`);
  };
  const field = (b: any, key: "amount_usd" | "stop_loss_pct" | "take_profit_pct", editKey: string, label: string) => (
    <label className="text-[10px] text-faint">{label}
      <input key={`${b.id}-${key}-${b.params?.[key]}`} defaultValue={b.params?.[key] ?? ""} inputMode="decimal"
        onBlur={(e) => { const v = numOrNull(e.target.value); if (v != null && v !== Number(b.params?.[key])) void bulk([{ kind: "bot", id: b.id }], { edit: { [editKey]: v } }, `${b.name}: ${label} → ${v}`); }}
        className={cx(inp, "mt-0.5 w-[70px]")} />
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-panel/40 p-2.5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">All of Auton's bots ({everyone.length})</span>
          <button onClick={() => bulk(everyone, { status: "resume" }, "All on")} disabled={!everyone.length} className={cx(btn, "ml-auto")}>All on</button>
          <button onClick={() => bulk(everyone, { status: "pause" }, "All off")} disabled={!everyone.length} className={btn}>All off</button>
          <button onClick={() => { if (confirm(`Delete all ${everyone.length} of Auton's bots and agents? Past trades stay in your history.`)) void bulk(everyone, { status: "delete" }, "Deleted"); }} disabled={!everyone.length} className={cx(btn, "text-down hover:text-down")}>Delete all</button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {([["amountUsd", "$ per trade"], ["stopLossPct", "Stop-loss %"], ["takeProfitPct", "Take-profit %"]] as const).map(([k, l]) => (
            <label key={k} className="text-[10px] text-faint">{l}<input value={all[k] ?? ""} onChange={(e) => setAll((x) => ({ ...x, [k]: e.target.value }))} inputMode="decimal" className={cx(inp, "mt-0.5 w-[80px]")} /></label>
          ))}
          <button onClick={applyAll} disabled={!everyone.length} className={cx(btn, "border-accent/50 text-accent-2")}>Apply to all</button>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Auton's bots ({bots.length})</div>
        {!bots.length && <p className="text-muted">None yet. Auton makes bots on its own while it's on, or when you ask it in the prompt box (e.g. “auton make a bot for SOL”).</p>}
        <div className="space-y-1">
          {bots.map((b: any) => (
            <div key={b.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-line px-2.5 py-1.5">
              <Sw on={b.status === "running"} label={`${b.name} on/off`} onClick={() => bulk([{ kind: "bot", id: b.id }], { status: b.status === "running" ? "pause" : "resume" }, `${b.name} turned ${b.status === "running" ? "off" : "on"}`)} />
              <div className="min-w-[120px] flex-1"><div className="truncate font-medium">{b.name}</div><div className="text-[10.5px] text-muted">{b.status}{b.pnl_usd != null ? ` · P&L ${Number(b.pnl_usd) >= 0 ? "+" : "−"}$${Math.abs(Number(b.pnl_usd)).toFixed(2)}` : ""}</div></div>
              {field(b, "amount_usd", "amountUsd", "$ per trade")}
              {field(b, "stop_loss_pct", "stopLossPct", "Stop-loss %")}
              {field(b, "take_profit_pct", "takeProfitPct", "Take-profit %")}
              <button onClick={() => { if (confirm(`Delete “${b.name}”?`)) void bulk([{ kind: "bot", id: b.id }], { status: "delete" }, "Deleted"); }} className={del} aria-label="Delete bot"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Auton's AI bots ({agents.length})</div>
        {!agents.length && <p className="text-muted">None yet.</p>}
        <div className="space-y-1">
          {agents.map((g: any) => (
            <div key={g.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-line px-2.5 py-1.5">
              <Sw on={g.status === "running"} label={`${g.name} on/off`} onClick={() => bulk([{ kind: "agent", id: g.id }], { status: g.status === "running" ? "pause" : "resume" }, `${g.name} turned ${g.status === "running" ? "off" : "on"}`)} />
              <div className="min-w-[120px] flex-1"><div className="truncate font-medium">{g.name}</div><div className="text-[10.5px] text-muted">{g.status} · AI bot</div></div>
              <label className="text-[10px] text-faint">Capital $<input key={`${g.id}-${g.capital_usd}`} defaultValue={Number(g.capital_usd ?? 0)} inputMode="decimal" onBlur={(e) => { const v = numOrNull(e.target.value); if (v != null && v !== Number(g.capital_usd)) void bulk([{ kind: "agent", id: g.id }], { edit: { capitalUsd: v } }, `${g.name}: capital → $${v}`); }} className={cx(inp, "mt-0.5 w-[80px]")} /></label>
              <button onClick={() => { if (confirm(`Delete “${g.name}”?`)) void bulk([{ kind: "agent", id: g.id }], { status: "delete" }, "Deleted"); }} className={del} aria-label="Delete agent"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Trades: open orders (cancel) and recent fills. */
export function TradesSection() {
  const toast = useToast();
  const open = useApi<any>("/api/orders?status=open&limit=200", { refreshMs: 10_000 });
  const recent = useApi<any>("/api/orders?limit=60", { refreshMs: 15_000 });
  const cancel = async (id: string) => { try { await api(`/api/orders/${id}`, { method: "POST", json: { action: "cancel" } }); await open.refresh(); await recent.refresh(); } catch (e: any) { toast(e.message, "down"); } };
  const o: any[] = open.data?.orders ?? [], r: any[] = (recent.data?.orders ?? []).filter((x: any) => ["filled", "partially_filled"].includes(x.status));
  return (
    <div className="space-y-3 p-3 text-[12px]">
      <div>
        <div className="mb-1 flex items-center text-[11px] font-semibold uppercase tracking-wide text-faint">Open orders ({o.length})
          {o.length > 0 && <button onClick={() => { if (confirm(`Cancel all ${o.length} open orders?`)) void Promise.all(o.map((x) => cancel(x.id))); }} className={cx(btn, "ml-auto normal-case tracking-normal")}>Cancel all</button>}</div>
        {!o.length && <p className="text-muted">No open orders.</p>}
        {o.map((x) => (
          <div key={x.id} className="flex items-center gap-2 border-b border-line/60 py-1">
            <span className={cx("w-9 text-[10.5px] font-bold uppercase", x.side === "buy" ? "text-up" : "text-down")}>{x.side}</span>
            <span className="font-medium">{x.symbol}</span><span className="text-muted">{x.order_type} · {String(x.status).replace("_", " ")} · {x.source}</span>
            <span className="num ml-auto text-muted">{x.notional_usd ? `$${Number(x.notional_usd).toFixed(2)}` : x.quantity}</span>
            <button onClick={() => cancel(x.id)} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-down">Cancel</button>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Recent trades</div>
        {!r.length && <p className="text-muted">No filled trades yet.</p>}
        {r.slice(0, 40).map((x) => (
          <div key={x.id} className="flex items-center gap-2 border-b border-line/60 py-1">
            <span className={cx("w-9 text-[10.5px] font-bold uppercase", x.side === "buy" ? "text-up" : "text-down")}>{x.side}</span>
            <span className="font-medium">{x.symbol}</span><span className="text-faint">{x.source} · {ago(x.updated_at)}</span>
            <span className="num ml-auto text-muted">{Number(x.filled_quantity).toPrecision(5)} @ ${Number(x.avg_fill_price).toPrecision(5)}</span>
            {x.side === "sell" && Number(x.realized_pnl) !== 0 && <span className={cx("num w-16 text-right", Number(x.realized_pnl) > 0 ? "text-up" : "text-down")}>{Number(x.realized_pnl) > 0 ? "+" : "−"}${Math.abs(Number(x.realized_pnl)).toFixed(2)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Prompts: schedules (on/off/delete) and saved prompts (delete). */
export function PromptsSection() {
  const toast = useToast();
  const sk = useApi<any>("/api/skills", { refreshMs: 20_000 });
  const saved = useApi<any>("/api/ai/saved-prompts");
  const act = async (fn: () => Promise<any>) => { try { await fn(); await sk.refresh(); await saved.refresh(); } catch (e: any) { toast(e.message, "down"); } };
  const sched: any[] = sk.data?.schedules ?? [], sp: any[] = saved.data?.prompts ?? [];
  return (
    <div className="space-y-3 p-3 text-[12px]">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Scheduled prompts ({sched.length})</div>
        {!sched.length && <p className="text-muted">None. Type e.g. “every day at 9am buy $20 of BTC”.</p>}
        {sched.map((x) => (
          <div key={x.id} className="flex items-start gap-2 border-b border-line/60 py-1.5">
            <Sw on={x.active} label="Schedule on/off" onClick={() => act(() => api("/api/skills", { method: "PATCH", json: { kind: "schedule", id: x.id, active: !x.active } }))} />
            <div className="min-w-0 flex-1"><div className="font-medium">{x.label}</div><div className="truncate text-[11px] text-muted">{x.prompt}</div><div className="text-[10.5px] text-faint">{x.runs ?? 0} runs{x.next_run_at ? ` · next ${new Date(x.next_run_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</div></div>
            <button onClick={() => { if (confirm("Delete this schedule?")) void act(() => api(`/api/skills?id=${x.id}&kind=schedule`, { method: "DELETE" })); }} className={del} aria-label="Delete schedule"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Saved prompts ({sp.length})</div>
        {!sp.length && <p className="text-muted">None. Save one with the bookmark button in Ask Merod.</p>}
        {sp.map((x) => (
          <div key={x.id} className="flex items-center gap-2 border-b border-line/60 py-1.5">
            <span className="min-w-0 flex-1 truncate">{x.title ?? x.text ?? x.prompt}</span>
            <button onClick={() => { if (confirm("Delete this saved prompt?")) void act(() => api("/api/ai/saved-prompts", { method: "DELETE", json: { id: x.id } })); }} className={del} aria-label="Delete saved prompt"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
