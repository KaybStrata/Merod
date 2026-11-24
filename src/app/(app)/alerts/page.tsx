"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bell, Zap, CheckCircle2, Bot, Users, Settings2, AlertTriangle, Filter, Trash2, Plus, ExternalLink, LayoutGrid } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago, price } from "@/lib/format";
import { Badge, Button, Card, Empty, Input, Pills, Select, Skeleton, SourceBadge, cx, useToast } from "@/components/ui";
import { useRealtime } from "@/components/shell/context";

const KINDS: { id: string; label: string; icon: any }[] = [
  { id: "all", label: "All activity", icon: LayoutGrid },
  { id: "fill", label: "Fills", icon: CheckCircle2 },
  { id: "approval", label: "Approvals", icon: AlertTriangle },
  { id: "alert", label: "Price alerts", icon: Zap },
  { id: "bot", label: "Bots", icon: Bot },
  { id: "social", label: "Social", icon: Users },
  { id: "system", label: "System", icon: Settings2 },
];
const ICON: Record<string, any> = Object.fromEntries(KINDS.map((k) => [k.id, k.icon]));

export default function AlertsPage() {
  const toast = useToast();
  const [kind, setKind] = useState("all");
  const [range, setRange] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const n = useApi<any>("/api/notifications?limit=300");
  const alerts = useApi<any>("/api/alerts");
  useRealtime((e) => { if (e.type === "notification") n.refresh(); });

  const counts = useMemo(() => {
    const m: Record<string, { n: number; unread: number }> = { all: { n: 0, unread: 0 } };
    for (const c of n.data?.counts ?? []) { m[c.kind] = c; m.all.n += c.n; m.all.unread += c.unread; }
    return m;
  }, [n.data]);
  const cutoff = range === "24h" ? 864e5 : range === "7d" ? 7 * 864e5 : range === "30d" ? 30 * 864e5 : Infinity;
  const items = (n.data?.notifications ?? []).filter((x: any) => (kind === "all" || x.kind === kind) && (!unreadOnly || !x.read_at) && Date.now() - new Date(x.created_at).getTime() <= cutoff);

  async function markAll() { await api("/api/notifications", { method: "POST", json: { all: true } }); n.refresh(); }
  async function markOne(id: number) { await api("/api/notifications", { method: "POST", json: { ids: [id] } }); n.refresh(); }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Notifications & Activity</h1>
        <p className="text-sm text-muted">Fills, approvals, price alerts, bot activity and social updates in one place.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} className={cx("rounded-xl border px-3 py-3 text-left transition-colors", kind === k.id ? "border-accent/60 bg-accent-soft" : "border-line bg-panel/70 hover:border-line-2")}>
            <k.icon className={cx("size-4", kind === k.id ? "text-accent-2" : "text-muted")} />
            <div className="mt-1.5 text-xs text-muted">{k.label}</div>
            <div className="num text-lg font-semibold">{counts[k.id]?.n ?? 0}{(counts[k.id]?.unread ?? 0) > 0 && <span className="ml-1.5 text-xs font-normal text-accent-2">{counts[k.id].unread} new</span>}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title={<>Activity feed <span className="text-sm font-normal text-muted">{items.length} updates</span></>} action={<Button size="sm" variant="ghost" onClick={markAll}>Mark all read</Button>} pad={false}>
          {n.loading && !n.data ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            : items.length ? items.map((x: any) => {
              const Icon = ICON[x.kind] ?? Bell;
              return (
                <div key={x.id} className={cx("flex items-start gap-3 border-t border-line px-4 py-3", !x.read_at && "bg-accent-soft/40")}>
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-panel-2"><Icon className="size-4 text-accent-2" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{x.title}</span><Badge>{x.kind}</Badge><span className="text-xs text-faint">{ago(x.created_at)}</span></div>
                    {x.body && <p className="mt-0.5 break-words text-sm text-muted">{x.body}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {x.link && <Link href={x.link} onClick={() => !x.read_at && markOne(x.id)} className="rounded p-1.5 text-muted hover:text-text" aria-label="Open"><ExternalLink className="size-4" /></Link>}
                    {!x.read_at && <button onClick={() => markOne(x.id)} className="rounded p-1.5 text-muted hover:text-text" title="Mark read"><CheckCircle2 className="size-4" /></button>}
                  </div>
                </div>
              );
            }) : <div className="p-4"><Empty icon={<Bell className="size-5" />} title="Nothing here yet">Trades, bots and alerts will show up as they happen.</Empty></div>}
        </Card>

        <aside className="space-y-4">
          <Card title="Filter activity" icon={<Filter className="size-4 text-accent-2" />} action={<button className="text-xs text-accent-2" onClick={() => { setKind("all"); setRange("all"); setUnreadOnly(false); }}>Clear</button>}>
            <Pills size="sm" value={range} onChange={setRange} options={[{ value: "all", label: "All time" }, { value: "24h", label: "24H" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }]} />
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
          </Card>
          <PriceAlerts data={alerts.data?.alerts ?? []} refresh={alerts.refresh} toast={toast} />
        </aside>
      </div>
    </div>
  );
}

function PriceAlerts({ data, refresh, toast }: { data: any[]; refresh: () => void; toast: (t: string, tone?: any) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [asset, setAsset] = useState<any>(null);
  const [direction, setDirection] = useState("below");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q || asset) { setResults([]); return; }
    const t = setTimeout(() => api(`/api/assets?q=${encodeURIComponent(q)}&limit=5`).then((r) => setResults(r.assets)).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q, asset]);
  async function create() {
    setBusy(true);
    try { await api("/api/alerts", { method: "POST", json: { assetId: asset.id, direction, price: Number(target) } }); setAsset(null); setQ(""); setTarget(""); toast("Alert created", "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <Card title="Price alerts" icon={<Zap className="size-4 text-warn" />}>
      <div className="space-y-2">
        <div className="relative">
          <Input placeholder="Asset (e.g. TSLA)" value={asset ? `${asset.symbol} · ${asset.venue}` : q} onChange={(e) => { setAsset(null); setQ(e.target.value); }} />
          {results.length > 0 && <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-xl">{results.map((a) => <button key={a.id} onClick={() => { setAsset(a); setTarget(String(Number(a.last_price).toPrecision(6))); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-panel-2">{a.symbol} <span className="text-muted">{a.venue} · {price(a.last_price)}</span></button>)}</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="below">Drops below</option><option value="above">Rises above</option></Select>
          <Input type="number" min="0" step="any" placeholder="Price" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <Button size="sm" variant="primary" className="w-full" disabled={!asset || !Number(target)} loading={busy} onClick={create}><Plus className="size-4" /> Create alert</Button>
      </div>
      <div className="mt-3 space-y-1.5">
        {data.length ? data.map((a) => (
          <div key={a.id} className={cx("flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm", a.triggered_at && "opacity-60")}>
            <span className="min-w-0"><span className="font-medium">{a.symbol}</span> <span className="text-muted">{a.direction} {price(a.price)}</span>
              <span className="block text-[11px] text-faint">now {price(a.last_price)} {a.triggered_at ? `· triggered ${ago(a.triggered_at)}` : ""}</span></span>
            <span className="flex items-center gap-1"><SourceBadge source={a.price_source} />
              <button className="rounded p-1 text-faint hover:text-down" aria-label="Delete alert" onClick={async () => { await api(`/api/alerts?id=${a.id}`, { method: "DELETE" }); refresh(); }}><Trash2 className="size-3.5" /></button></span>
          </div>
        )) : <p className="text-xs text-faint">No alerts. You can also say “Notify me when TSLA drops below 380” in the prompt bar.</p>}
      </div>
    </Card>
  );
}
