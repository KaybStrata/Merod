"use client";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { price } from "@/lib/format";
import { Button, Input, Select } from "@/components/ui";

/** Asset search + direction + price → POST /api/alerts. */
export function ManualAlertForm({ onCreated, toast }: { onCreated: () => void; toast: (t: string, tone?: any) => void }) {
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
    try { await api("/api/alerts", { method: "POST", json: { assetId: asset.id, direction, price: Number(target) } }); setAsset(null); setQ(""); setTarget(""); toast("Alert created", "up"); onCreated(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
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
  );
}
