"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, Zap, CheckCircle2, Bot, Users, Settings2, AlertTriangle, Trash2, ExternalLink, LayoutGrid, Sparkles, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago, price } from "@/lib/format";
import { Empty, Pills, Skeleton, SourceBadge, cx, useToast } from "@/components/ui";
import { usePageTitle, useRealtime } from "@/components/shell/context";
import { ManualAlertForm } from "@/components/alerts/ManualAlertForm";

const KINDS: { id: string; label: string; icon: any }[] = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "fill", label: "Fills", icon: CheckCircle2 },
  { id: "approval", label: "Approvals", icon: AlertTriangle },
  { id: "alert", label: "Price", icon: Zap },
  { id: "bot", label: "Bots", icon: Bot },
  { id: "social", label: "Social", icon: Users },
  { id: "system", label: "System", icon: Settings2 },
];
const ICON: Record<string, any> = Object.fromEntries(KINDS.map((k) => [k.id, k.icon]));
const EXAMPLES = ["Tell me if NVDA drops 5% in a day", "Alert me when SOL goes above 200", "Notify me when TSLA drops below 380"];
const isToday = (t?: string | null) => !!t && new Date(t).toDateString() === new Date().toDateString();

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "warn" }) {
  return (
    <div className="surface rounded-2xl px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className={cx("num mt-1 text-[26px] font-semibold leading-none", tone === "up" && "text-up", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export default function AlertsPage() {
  usePageTitle({ section: "Account · Alerts", title: "Alerts center", accent: "center" });
  const toast = useToast();
  const [kind, setKind] = useState("all");
  const [rules, setRules] = useState<"all" | "active" | "triggered">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const n = useApi<any>("/api/notifications?limit=300");
  const alerts = useApi<any>("/api/alerts");
  useRealtime((e) => { if (e.type === "notification") { n.refresh(); alerts.refresh(); } });

  const all: any[] = alerts.data?.alerts ?? [];
  const notes: any[] = n.data?.notifications ?? [];
  const counts = useMemo(() => {
    const m: Record<string, { n: number; unread: number }> = { all: { n: 0, unread: 0 } };
    for (const c of n.data?.counts ?? []) { m[c.kind] = c; m.all.n += c.n; m.all.unread += c.unread; }
    return m;
  }, [n.data]);
  const active = all.filter((a) => !a.triggered_at);
  const triggeredToday = all.filter((a) => isToday(a.triggered_at));
  const firedToday = notes.filter((x) => x.kind === "alert" && isToday(x.created_at));
  const shownRules = all.filter((a) => rules === "all" || (rules === "active" ? !a.triggered_at : !!a.triggered_at));
  const feed = notes.filter((x) => (kind === "all" || x.kind === kind) && (!unreadOnly || !x.read_at));

  async function markAll() { await api("/api/notifications", { method: "POST", json: { all: true } }); n.refresh(); }
  async function markOne(id: number) { await api("/api/notifications", { method: "POST", json: { ids: [id] } }); n.refresh(); }
  async function remove(id: string) { await api(`/api/alerts?id=${id}`, { method: "DELETE" }); alerts.refresh(); }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active rules" value={active.length} sub={`${all.length} total price alerts`} />
        <Stat label="Fired today" value={Math.max(triggeredToday.length, firedToday.length)} sub="price alerts triggered" tone={triggeredToday.length ? "warn" : undefined} />
        <Stat label="Unread" value={counts.all?.unread ?? 0} sub={`${counts.all?.n ?? 0} notifications`} />
        <Stat label="Fills & approvals" value={(counts.fill?.n ?? 0) + (counts.approval?.n ?? 0)} sub={`${counts.approval?.unread ?? 0} approvals waiting`} tone={(counts.approval?.unread ?? 0) > 0 ? "warn" : "up"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="surface rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="text-[14px] font-semibold">Alert rules <span className="ml-1 text-[12px] font-normal text-muted">{shownRules.length}</span></div>
              <Pills size="sm" value={rules} onChange={setRules} options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "triggered", label: "Triggered" }]} />
            </div>
            {alerts.loading && !alerts.data ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              : shownRules.length ? (
                <div>
                  <div className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_90px_60px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                    <span>Rule</span><span>Trigger</span><span>Last price</span><span>Status</span><span />
                  </div>
                  {shownRules.map((a) => {
                    const dist = a.last_price && a.price ? ((Number(a.price) / Number(a.last_price) - 1) * 100) : null;
                    return (
                      <div key={a.id} className="grid grid-cols-[minmax(0,1.6fr)_1fr_1fr_90px_60px] items-center gap-3 border-t border-line/70 px-4 py-2.5 text-[12.5px]">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-panel-2"><Zap className="size-3.5 text-warn" /></span>
                          <span className="min-w-0"><span className="block truncate font-semibold">{a.symbol} {a.direction === "above" ? "rises above" : "drops below"} {price(a.price)}</span>
                            <span className="block truncate text-[11px] text-faint">{a.name} · created {ago(a.created_at)}</span></span>
                        </span>
                        <span className="num text-muted">{a.direction} {price(a.price)}{dist != null && !a.triggered_at && <span className="block text-[10.5px] text-faint">{dist >= 0 ? "+" : ""}{dist.toFixed(1)}% away</span>}</span>
                        <span className="num flex items-center gap-1.5">{price(a.last_price)} <SourceBadge source={a.price_source} /></span>
                        <span>{a.triggered_at
                          ? <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-medium text-warn">Fired {ago(a.triggered_at)}</span>
                          : <span className="flex items-center gap-1.5 text-[11px] text-up"><span className="size-1.5 rounded-full bg-up pulse-dot" />Watching</span>}</span>
                        <span className="text-right"><button className="rounded p-1 text-faint hover:text-down" aria-label="Delete alert" onClick={() => remove(a.id)}><Trash2 className="size-3.5" /></button></span>
                      </div>
                    );
                  })}
                </div>
              ) : <div className="p-4"><Empty icon={<Zap className="size-5" />} title="No alert rules">Create one on the right, or just type it in plain English.</Empty></div>}
          </section>

          <section className="surface rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="text-[14px] font-semibold">Notifications <span className="ml-1 text-[12px] font-normal text-muted">{feed.length}</span></div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" className="accent-[var(--accent)]" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
                <button onClick={markAll} className="text-[12px] text-accent-2 hover:underline">Mark all read</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
              {KINDS.map((k) => (
                <button key={k.id} onClick={() => setKind(k.id)} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px]", kind === k.id ? "nav-active" : "text-muted hover:text-text")}>
                  <k.icon className="size-3.5" />{k.label}<span className="num text-[10.5px] text-faint">{counts[k.id]?.n ?? 0}</span>
                  {(counts[k.id]?.unread ?? 0) > 0 && <span className="size-1.5 rounded-full bg-accent-2" />}
                </button>
              ))}
            </div>
            {n.loading && !n.data ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              : feed.length ? feed.slice(0, 150).map((x: any) => {
                const Icon = ICON[x.kind] ?? Bell;
                return (
                  <div key={x.id} className={cx("flex items-start gap-3 border-t border-line/60 px-4 py-2.5 first:border-0", !x.read_at && "bg-accent-soft/30")}>
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-panel-2"><Icon className="size-3.5 text-accent-2" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium">{x.title}</span><span className="text-[10.5px] text-faint">{ago(x.created_at)}</span></div>
                      {x.body && <p className="mt-0.5 break-words text-[12px] text-muted">{x.body}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {x.link && <Link href={x.link} onClick={() => !x.read_at && markOne(x.id)} className="rounded p-1 text-muted hover:text-text" aria-label="Open"><ExternalLink className="size-3.5" /></Link>}
                      {!x.read_at && <button onClick={() => markOne(x.id)} className="rounded p-1 text-muted hover:text-text" title="Mark read"><CheckCircle2 className="size-3.5" /></button>}
                    </div>
                  </div>
                );
              }) : <div className="p-4"><Empty icon={<Bell className="size-5" />} title="Nothing here yet">Trades, bots and alerts show up as they happen.</Empty></div>}
          </section>
        </div>

        <aside className="space-y-4">
          <NewAlert onCreated={() => { alerts.refresh(); n.refresh(); }} toast={toast} />
          <section className="surface rounded-2xl p-4">
            <div className="flex items-center justify-between"><div className="text-[14px] font-semibold">Triggered today</div><span className="text-[11px] text-muted">{triggeredToday.length}</span></div>
            <ol className="mt-3 space-y-0">
              {!triggeredToday.length && !firedToday.length && <p className="text-[12px] text-faint">Nothing fired today.</p>}
              {triggeredToday.map((a) => (
                <li key={a.id} className="relative border-l border-line-2 pb-3 pl-4 last:pb-0">
                  <span className="absolute -left-[4px] top-1 size-2 rounded-full bg-warn" />
                  <div className="text-[11px] text-faint">{new Date(a.triggered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="text-[12.5px] font-medium">{a.symbol} {a.direction === "above" ? "rose above" : "dropped below"} {price(a.price)}</div>
                  <div className="text-[11px] text-muted">now {price(a.last_price)}</div>
                </li>
              ))}
              {!triggeredToday.length && firedToday.map((x) => (
                <li key={x.id} className="relative border-l border-line-2 pb-3 pl-4 last:pb-0">
                  <span className="absolute -left-[4px] top-1 size-2 rounded-full bg-warn" />
                  <div className="text-[11px] text-faint">{new Date(x.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="text-[12.5px] font-medium">{x.title}</div>
                  {x.body && <div className="text-[11px] text-muted">{x.body}</div>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** "New alert": plain-English rule (handled by Merod's prompt engine, which creates the alert) or the manual form. */
function NewAlert({ onCreated, toast }: { onCreated: () => void; toast: (t: string, tone?: any) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ text: string; ok: boolean } | null>(null);
  async function submit(t = text) {
    const v = t.trim();
    if (!v || busy) return;
    setBusy(true); setReply(null);
    try {
      const r = await api("/api/ai/prompt", { method: "POST", json: { text: v } });
      const msgs = Array.isArray(r.messages) && r.messages.length ? r.messages : [r.message];
      const created = msgs.some((m: any) => m?.plan?.type === "alert");
      setReply({ text: msgs.map((m: any) => m?.content).filter(Boolean).join("\n"), ok: created });
      if (created) { setText(""); toast("Alert created", "up"); onCreated(); }
    } catch (e: any) { setReply({ text: e.message, ok: false }); } finally { setBusy(false); }
  }
  return (
    <section className="surface rounded-2xl p-4">
      <div className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles className="size-4 text-accent-2" /> New alert</div>
      <div className="gold-ring mt-3 rounded-xl border border-line-2 bg-bg-2/70 p-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Tell me if NVDA drops 5% in a day…" className="w-full resize-none bg-transparent px-1 text-[13px] outline-none placeholder:text-faint" />
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] text-faint">Merod reads it and creates the rule</span>
          <button onClick={() => submit()} disabled={!text.trim() || busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-grad px-3 text-[12px] font-semibold text-bg disabled:opacity-50">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />} Create</button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">{EXAMPLES.map((e) => <button key={e} onClick={() => setText(e)} className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:border-accent/50 hover:text-text">{e}</button>)}</div>
      {reply && <div className={cx("mt-3 whitespace-pre-wrap rounded-lg px-3 py-2 text-[12px]", reply.ok ? "bg-up-soft text-up" : "bg-panel-2 text-muted")}>{reply.text}</div>}
      <div className="my-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint"><span className="h-px flex-1 bg-line" />or set it manually<span className="h-px flex-1 bg-line" /></div>
      <ManualAlertForm onCreated={onCreated} toast={toast} />
    </section>
  );
}
