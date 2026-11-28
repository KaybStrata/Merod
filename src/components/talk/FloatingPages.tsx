"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart, PieChart, Sparkles, Bot, Settings, SlidersHorizontal, Lightbulb, Map as MapIcon, PiggyBank, Trash2, Cpu, ListChecks, Wand2, MessageSquare, X, Minus, ExternalLink, Maximize2, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { SkillsSection, AutonSection, TradesSection, PromptsSection } from "./EditAllSections";
import { cx, useToast } from "@/components/ui";

export type FloatTab = "map" | "ewallets" | "trade" | "portfolio" | "agents" | "bots" | "auton" | "edit" | "advisor" | "settings";
const TABS: { id: FloatTab; label: string; icon: any; href?: string }[] = [
  { id: "map", label: "Map", icon: MapIcon, href: "/map" },
  { id: "trade", label: "Trade", icon: CandlestickChart, href: "/trade" },
  { id: "portfolio", label: "Portfolio", icon: PieChart, href: "/analytics" },
  { id: "bots", label: "Bots & agents", icon: Bot, href: "/bots" },
  { id: "auton", label: "Auton", icon: Cpu },
  { id: "edit", label: "Edit all", icon: SlidersHorizontal },
  { id: "advisor", label: "Advisor", icon: Lightbulb, href: "/advisor" },
  { id: "ewallets", label: "E-wallets", icon: PiggyBank, href: "/e-wallets" },
  { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
];
/** Open the floating window on a tab from anywhere in Talk. */
export const openFloat = (tab: FloatTab) => { try { window.dispatchEvent(new CustomEvent("merod-float", { detail: tab })); } catch { /* ignore */ } };

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/**
 * Talk's floating window: Trade, Portfolio, Agents, Bots, Settings and "Edit all" (change every bot/agent at once) on top
 * of the conversation, without leaving Talk. Drag the title bar to move it, drag the corner to resize, "–" to tuck it away.
 * Classic pages load inside it without their sidebar; pages you've opened stay loaded while you switch tabs.
 */
export function FloatingPages() {
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(false);
  const [tab, setTab] = useState<FloatTab>("edit");
  const [seen, setSeen] = useState<Set<FloatTab>>(new Set());
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = (e: Event) => { let t = (e as CustomEvent).detail as FloatTab; if (t === "agents") t = "bots"; setTab(t); setOpen(true); setMin(false); setSeen((s) => new Set(s).add(t)); };
    window.addEventListener("merod-float", on);
    return () => window.removeEventListener("merod-float", on);
  }, []);
  useEffect(() => {
    if (pos || !open) return;
    const w = Math.min(860, window.innerWidth - 32), h = Math.min(Math.round(window.innerHeight * 0.78), 760);
    setPos(load("merod-float-pos", { x: Math.max(16, window.innerWidth - w - 24), y: 72, w, h }));
  }, [open, pos]);
  // Remember size after the user resizes with the corner handle.
  useEffect(() => {
    const el = box.current;
    if (!el || !open) return;
    const ro = new ResizeObserver(() => { if (pos) { const next = { ...pos, w: el.offsetWidth, h: el.offsetHeight }; save("merod-float-pos", next); } });
    ro.observe(el); return () => ro.disconnect();
  }, [open, pos]);

  if (!open || !pos) return null;
  const cur = TABS.find((t) => t.id === tab)!;
  if (min) return (
    <button onClick={() => setMin(false)} className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border border-accent/50 bg-panel px-3.5 py-2 text-[12.5px] font-semibold shadow-2xl hover:border-accent">
      <cur.icon className="size-4 text-accent-2" />{cur.label}<Maximize2 className="size-3.5 text-faint" />
    </button>
  );
  return (
    <div ref={box} className="fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-line-2 bg-bg-2 shadow-[0_20px_70px_rgba(0,0,0,.6)]"
      style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h, resize: "both", minWidth: 380, minHeight: 300, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)" }}>
      <div className="flex cursor-move select-none items-center gap-1 border-b border-line bg-panel/80 px-2 py-1.5"
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button,a")) return; drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drag.current) return; const x = Math.min(window.innerWidth - 120, Math.max(-pos.w + 160, e.clientX - drag.current.dx)), y = Math.min(window.innerHeight - 40, Math.max(0, e.clientY - drag.current.dy)); setPos({ ...pos, x, y }); }}
        onPointerUp={() => { if (drag.current) save("merod-float-pos", pos); drag.current = null; }}>
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setSeen((s) => new Set(s).add(t.id)); }}
              className={cx("flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px]", tab === t.id ? "bg-accent/15 text-text" : "text-muted hover:bg-panel-2 hover:text-text")}>
              <t.icon className="size-3.5" />{t.label}
            </button>
          ))}
        </div>
        {cur.href && <a href={cur.href} className="rounded-md p-1.5 text-faint hover:text-text" title="Open as a full page"><ExternalLink className="size-3.5" /></a>}
        <button onClick={() => setMin(true)} className="rounded-md p-1.5 text-faint hover:text-text" title="Tuck away (keeps your place)" aria-label="Minimize"><Minus className="size-3.5" /></button>
        <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-faint hover:text-text" title="Close" aria-label="Close"><X className="size-3.5" /></button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tab === "edit" && <EditAll />}
        {tab === "auton" && <div className="h-full overflow-y-auto"><AutonSection /></div>}
        {TABS.filter((t) => t.href && (seen.has(t.id) || tab === t.id)).map((t) => (
          <iframe key={t.id} src={`${t.href}?embed=1`} title={t.label} allow="microphone; clipboard-write"
            className={cx("absolute inset-0 h-full w-full border-0 bg-bg", tab === t.id ? "block" : "hidden")} />
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Edit all bots / agents at once ───────────────────────── */
type Row = { kind: "bot" | "agent"; id: string; name: string; status: string; detail: string; pnl: number | null; amountUsd: number | null; stopLossPct: number | null; takeProfitPct: number | null; dipPct: number | null; capitalUsd: number | null; supports: Record<string, boolean> };
const fmt$ = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const fmtP = (n: number | null) => (n == null || n === 0 ? "—" : `${n}%`);
const inp = "w-full rounded-md border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60";

export function BulkEditor() {
  const toast = useToast();
  const { data, refresh } = useApi<{ items: Row[] }>("/api/bots/bulk", { refreshMs: 20_000 });
  const [filter, setFilter] = useState<"all" | "bot" | "agent" | "running">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ amountMode: "set", amount: "", sl: "", tp: "", dip: "", capMode: "set", cap: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);
  const rows = useMemo(() => (data?.items ?? []).filter((r) => filter === "all" || (filter === "running" ? r.status === "running" : r.kind === filter)), [data, filter]);
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const chosen = (data?.items ?? []).filter((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function buildEdit() {
    const e: Record<string, number> = {};
    const n = (v: string) => (v.trim() === "" ? null : Number(v));
    const a = n(f.amount);
    if (a != null && Number.isFinite(a)) { if (f.amountMode === "set") e.amountUsd = a; else if (f.amountMode === "add") e.amountAdd = a; else e.amountMult = 1 + a / 100; }
    for (const [k, v] of [["stopLossPct", f.sl], ["takeProfitPct", f.tp], ["dipPct", f.dip]] as const) { const x = n(v); if (x != null && Number.isFinite(x)) e[k] = Math.abs(x); }
    const c = n(f.cap);
    if (c != null && Number.isFinite(c)) { if (f.capMode === "set") e.capitalUsd = c; else if (f.capMode === "add") e.capitalAdd = c; else e.capitalMult = 1 + c / 100; }
    return e;
  }
  async function run(kind: "edit" | "pause" | "resume" | "delete") {
    if (!chosen.length) return toast("Tick the bots and agents to change first (or the box at the top for all)", "down");
    const edit = kind === "edit" ? buildEdit() : {};
    if (kind === "edit" && !Object.keys(edit).length) return toast("Fill in at least one setting to change", "down");
    if (kind === "delete" && !confirm(`Delete ${chosen.length} bot${chosen.length === 1 ? "" : "s"}/agent${chosen.length === 1 ? "" : "s"}? Bots stop and are removed, agents are archived. Past trades stay in your history.`)) return;
    setBusy(kind); setResult(null);
    try {
      const r = await api("/api/bots/bulk", { method: "POST", json: { targets: chosen.map((x) => ({ kind: x.kind, id: x.id })), edit, ...(kind !== "edit" ? { status: kind } : {}) } });
      setResult(r.lines); toast(`Updated ${r.updated} bot${r.updated === 1 ? "" : "s"}/agent${r.updated === 1 ? "" : "s"}`, "up");
      if (kind === "edit") setF((x) => ({ ...x, amount: "", sl: "", tp: "", dip: "", cap: "" }));
      await refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-[12px]">
        <span className="font-semibold">Edit all bots & agents at once</span>
        <span className="text-faint">· {chosen.length} selected</span>
        <div className="ml-auto flex gap-0.5">
          {(["all", "bot", "agent", "running"] as const).map((k) => <button key={k} onClick={() => setFilter(k)} className={cx("rounded-md px-2 py-0.5", filter === k ? "bg-accent/20 text-accent-2" : "text-muted hover:text-text")}>{k === "all" ? "All" : k === "bot" ? "Bots" : k === "agent" ? "Agents" : "Running"}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!data ? <div className="flex items-center gap-2 p-4 text-[12px] text-muted"><Loader2 className="size-4 animate-spin" />Loading…</div> : !rows.length ? <div className="p-4 text-[12.5px] text-muted">No {filter === "all" ? "bots or agents" : filter === "running" ? "running bots or agents" : `${filter}s`} yet. Create one from the prompt box, e.g. “create a bot that buys SOL dips of 3%”.</div> : (
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-bg-2 text-[10.5px] uppercase tracking-wide text-faint">
              <tr>
                <th className="w-8 px-3 py-1.5"><input type="checkbox" checked={allOn} onChange={() => setSel((s) => { const n = new Set(s); rows.forEach((r) => (allOn ? n.delete(r.id) : n.add(r.id))); return n; })} aria-label="Select all" /></th>
                <th className="py-1.5">Name</th><th>Status</th><th className="text-right">$/trade</th><th className="text-right">Stop</th><th className="text-right">Target</th><th className="text-right">Dip</th><th className="text-right">Capital</th><th className="px-3 text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => toggle(r.id)} className={cx("cursor-pointer border-t border-line/60 hover:bg-panel-2/60", sel.has(r.id) && "bg-accent/5")}>
                  <td className="px-3 py-1.5"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="py-1.5"><div className="flex items-center gap-1.5"><span className={cx("rounded px-1 text-[9.5px] font-bold uppercase", r.kind === "bot" ? "bg-sky-400/15 text-sky-300" : "bg-violet-400/15 text-violet-300")}>{r.kind}</span><span className="font-medium">{r.name}</span></div><div className="pl-0.5 text-[10.5px] text-faint">{r.detail}</div></td>
                  <td><span className={cx("text-[11px]", r.status === "running" ? "text-up" : r.status === "error" || r.status === "risk_blocked" ? "text-down" : "text-muted")}>{r.status.replace("_", " ")}</span></td>
                  <td className="num text-right">{r.supports.amountUsd ? fmt$(r.amountUsd) : <span className="text-faint">n/a</span>}</td>
                  <td className="num text-right">{r.supports.stopLossPct ? fmtP(r.stopLossPct) : <span className="text-faint">n/a</span>}</td>
                  <td className="num text-right">{r.supports.takeProfitPct ? fmtP(r.takeProfitPct) : <span className="text-faint">n/a</span>}</td>
                  <td className="num text-right">{r.supports.dipPct ? fmtP(r.dipPct) : <span className="text-faint">n/a</span>}</td>
                  <td className="num text-right">{r.kind === "agent" ? fmt$(r.capitalUsd) : <span className="text-faint">—</span>}</td>
                  <td className={cx("num px-3 text-right", (r.pnl ?? 0) > 0 ? "text-up" : (r.pnl ?? 0) < 0 ? "text-down" : "text-muted")}>{r.pnl == null ? "—" : `${r.pnl >= 0 ? "+" : "-"}$${Math.abs(r.pnl).toFixed(2)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-line bg-panel/60 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <label className="text-[10.5px] text-muted">$ per trade
            <div className="mt-0.5 flex gap-1"><select value={f.amountMode} onChange={(e) => setF({ ...f, amountMode: e.target.value })} className="rounded-md border border-line bg-bg px-1 text-[11px]"><option value="set">set $</option><option value="add">+/− $</option><option value="pct">+/− %</option></select><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" placeholder={f.amountMode === "set" ? "35" : f.amountMode === "add" ? "5 or -5" : "20 or -20"} className={inp} /></div>
          </label>
          <label className="text-[10.5px] text-muted">Stop-loss %<input value={f.sl} onChange={(e) => setF({ ...f, sl: e.target.value })} inputMode="decimal" placeholder="8 (0 = none)" className={cx(inp, "mt-0.5")} /></label>
          <label className="text-[10.5px] text-muted">Take-profit %<input value={f.tp} onChange={(e) => setF({ ...f, tp: e.target.value })} inputMode="decimal" placeholder="12 (0 = none)" className={cx(inp, "mt-0.5")} /></label>
          <label className="text-[10.5px] text-muted">Buy on dip %<input value={f.dip} onChange={(e) => setF({ ...f, dip: e.target.value })} inputMode="decimal" placeholder="3" className={cx(inp, "mt-0.5")} /></label>
          <label className="text-[10.5px] text-muted">Agent capital
            <div className="mt-0.5 flex gap-1"><select value={f.capMode} onChange={(e) => setF({ ...f, capMode: e.target.value })} className="rounded-md border border-line bg-bg px-1 text-[11px]"><option value="set">set $</option><option value="add">+/− $</option><option value="pct">+/− %</option></select><input value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} inputMode="decimal" placeholder="5000" className={inp} /></div>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => run("edit")} disabled={!!busy} className="rounded-lg bg-grad px-3 py-1.5 text-[12.5px] font-semibold text-bg disabled:opacity-60">{busy === "edit" ? "Applying…" : `Apply to ${chosen.length || "selected"}`}</button>
          <button onClick={() => run("resume")} disabled={!!busy} className="rounded-lg border border-up/40 px-3 py-1.5 text-[12.5px] text-up hover:bg-up/10 disabled:opacity-60">{busy === "resume" ? "…" : "Turn on"}</button>
          <button onClick={() => run("pause")} disabled={!!busy} className="rounded-lg border border-down/40 px-3 py-1.5 text-[12.5px] text-down hover:bg-down/10 disabled:opacity-60">{busy === "pause" ? "…" : "Turn off"}</button>
          <button onClick={() => run("delete")} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg border border-down/60 bg-down/10 px-3 py-1.5 text-[12.5px] text-down hover:bg-down/20 disabled:opacity-60"><Trash2 className="size-3.5" />{busy === "delete" ? "…" : "Delete"}</button>
          <span className="text-[10.5px] text-faint">Empty boxes stay as they are. Settings a bot's strategy doesn't use are skipped and listed.</span>
        </div>
        {result && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2 font-sans text-[11.5px] leading-relaxed text-muted">{result.join("\n")}</pre>}
      </div>
    </div>
  );
}

/** Edit all: one place to change everything at once — bots & agents, skills & points, Auton, trades and prompts. */
function EditAll() {
  const [sec, setSec] = useState<"bots" | "skills" | "auton" | "trades" | "prompts">("bots");
  const SECS = [["bots", "Bots & agents", Bot], ["skills", "Skills & points", Wand2], ["auton", "Auton", Cpu], ["trades", "Trades", ListChecks], ["prompts", "Prompts", MessageSquare]] as const;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line bg-panel/40 px-2 py-1">
        {SECS.map(([k, l, I]) => (
          <button key={k} onClick={() => setSec(k)} className={cx("flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px]", sec === k ? "bg-accent/15 text-text" : "text-muted hover:text-text")}><I className="size-3.5" />{l}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sec === "bots" && <BulkEditor />}
        {sec === "skills" && <SkillsSection />}
        {sec === "auton" && <AutonSection />}
        {sec === "trades" && <TradesSection />}
        {sec === "prompts" && <PromptsSection />}
      </div>
    </div>
  );
}
