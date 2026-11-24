"use client";
import { useEffect, useState } from "react";
import { Percent, ShieldCheck } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Card, Input, Pills, Skeleton, Stat, useToast } from "@/components/ui";
import { usd, ago } from "@/lib/format";

export default function FeesPage() {
  const { data, refresh } = useApi<any>("/api/admin/fees");
  const toast = useToast();
  const [f, setF] = useState({ mode: "performance", pct: "7", reason: "", code: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF((x) => ({ ...x, mode: data.config.mode, pct: String(data.config.pct) })); }, [data]);
  if (!data) return <Skeleton className="h-64" />;
  const pct = Number(f.pct);
  const example = f.mode === "performance" ? `A trade closed with $1,000 profit pays $${(1000 * pct / 100).toFixed(2)}; losing trades pay $0.` : `A $1,000 trade pays $${(1000 * pct / 100).toFixed(2)}, buy or sell.`;

  async function save() {
    setBusy(true);
    try { await api("/api/admin/fees", { method: "PATCH", json: { mode: f.mode, pct, reason: f.reason, code: f.code } }); toast("Fee updated", "up"); setF({ ...f, code: "", reason: "" }); refresh(); }
    catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Percent className="size-6 text-accent-2" /> Platform fees</h1>
        <p className="mt-1 text-sm text-muted">Current: <b className="text-text">{data.description}</b>. Shown to users on every order preview.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><Stat label="Collected (paper, virtual)" value={usd(data.stats?.paper_total ?? 0)} /></Card>
        <Card><Stat label="Charged (live)" value={usd(data.stats?.live_total ?? 0)} sub={<span className="text-muted">billing pending</span>} /></Card>
        <Card><Stat label="Last 30 days" value={usd(data.stats?.last_30d ?? 0)} /></Card>
        <Card><Stat label="Orders charged" value={data.stats?.charged_orders ?? 0} /></Card>
      </div>
      <Card title="Adjust fee" icon={<ShieldCheck className="size-4 text-up" />} action={!data.canEdit && <Badge tone="warn">Super admin only</Badge>}>
        <div className="space-y-4">
          <Pills value={f.mode as any} onChange={(v: any) => setF({ ...f, mode: v })} options={[{ value: "performance", label: "Performance fee (on profit)" }, { value: "commission", label: "Commission (on trade value)" }]} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label={`Fee % (0–${data.maxPct})`} type="number" step="0.1" min="0" max={data.maxPct} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} disabled={!data.canEdit} />
            <Input label="Reason (recorded)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} disabled={!data.canEdit} />
            <Input label="2FA code" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} disabled={!data.canEdit} />
          </div>
          <p className="text-xs text-muted">{example}</p>
          <Button variant="primary" loading={busy} disabled={!data.canEdit || !(pct >= 0 && pct <= data.maxPct) || f.reason.length < 3 || f.code.length !== 6} onClick={save}>Save fee</Button>
          <p className="text-[11px] text-faint">Charging real customers requires fee disclosures in your terms and applicable regulatory approval before live trading is enabled.</p>
        </div>
      </Card>
      <Card title="Change history">
        {data.history.length === 0 ? <p className="text-sm text-muted">Default 7% performance fee — no changes yet.</p> : (
          <div className="divide-y divide-line text-sm">{data.history.map((h: any, i: number) => (
            <div key={i} className="flex flex-wrap justify-between gap-2 py-2"><span>{h.details.before.pct}% {h.details.before.mode} → <b>{h.details.after.pct}% {h.details.after.mode}</b> · {h.reason}</span><span className="text-xs text-faint">@{h.handle} · {ago(h.created_at)}</span></div>
          ))}</div>
        )}
      </Card>
    </div>
  );
}
