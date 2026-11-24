"use client";
import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Input, Select, Pills, PaperBadge, SourceBadge, cx, useToast } from "@/components/ui";
import { price, usd, qty } from "@/lib/format";

type OType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";

/** Manual order ticket: preview (all engine checks) → confirm → place (idempotent). */
export function OrderTicket({ asset, position, onPlaced }: { asset: any; position: { quantity: number } | null; onPlaced: () => void }) {
  const toast = useToast();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<OType>("market");
  const [sizeMode, setSizeMode] = useState<"usd" | "qty" | "pct">("usd");
  const [amount, setAmount] = useState("100");
  const [limit, setLimit] = useState("");
  const [stop, setStop] = useState("");
  const [trail, setTrail] = useState("5");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [slip, setSlip] = useState("100");
  const [tif, setTif] = useState<"gtc" | "day" | "ioc">("gtc");
  const [plan, setPlan] = useState<any>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "place" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function intent() {
    const n = Number(amount);
    const i: any = { asset: { assetId: asset.id }, side, orderType: type, timeInForce: tif, maxSlippageBps: Number(slip) || undefined };
    if (sizeMode === "usd") i.notionalUsd = n; else if (sizeMode === "qty") i.quantity = n; else i.percentOfPosition = n;
    if (type === "limit" || type === "stop_limit") i.limitPrice = Number(limit);
    if (type === "stop" || type === "stop_limit") i.stopPrice = Number(stop);
    if (type === "trailing_stop") i.trailPercent = Number(trail);
    if (side === "buy" && tp) i.takeProfit = Number(tp);
    if (side === "buy" && sl) i.stopLoss = Number(sl);
    return i;
  }
  async function preview() {
    setBusy("preview"); setError(null); setPlan(null);
    try { const r = await api("/api/orders", { method: "POST", json: { intent: intent(), mode: "preview" } }); setPlan(r.plan); setKey(crypto.randomUUID()); }
    catch (e: any) { setError(e.body?.issues?.[0]?.message ?? e.message); } finally { setBusy(null); }
  }
  async function place() {
    setBusy("place"); setError(null);
    try {
      const r = await api("/api/orders", { method: "POST", json: { intent: intent(), mode: "place", idempotencyKey: key } });
      const o = r.order;
      toast(`${o.status === "filled" ? "Filled" : o.status === "submitted" ? "Order working" : `Order ${o.status}`}${o.status_reason ? ` — ${o.status_reason}` : ""}`, ["filled", "submitted"].includes(o.status) ? "up" : "down");
      setPlan(null); onPlaced();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }
  const reset = () => setPlan(null);
  const disabled = !asset || asset.tradability === "view_only";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg-2/60 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); reset(); if (s === "sell" && sizeMode === "usd" && position?.quantity) setSizeMode("pct"); }}
            className={cx("rounded-lg py-2 text-sm font-semibold transition-colors", side === s ? (s === "buy" ? "bg-up text-[#04130d]" : "bg-down text-white") : "text-muted hover:text-text")}>{s === "buy" ? "Buy" : "Sell"}</button>
        ))}
      </div>
      <Select label="Order type" value={type} onChange={(e) => { setType(e.target.value as OType); reset(); }}>
        <option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option><option value="stop_limit">Stop-limit</option>
        <option value="trailing_stop" disabled={side === "buy"}>Trailing stop (sell)</option>
      </Select>
      <div>
        <div className="mb-1 flex items-center justify-between"><span className="text-xs font-medium text-muted">Amount</span>
          <Pills size="sm" value={sizeMode} onChange={(v) => { setSizeMode(v); reset(); setAmount(v === "pct" ? "25" : v === "usd" ? "100" : "1"); }}
            options={[{ value: "usd", label: "USD" }, { value: "qty", label: asset?.symbol ?? "Qty" }, ...(side === "sell" ? [{ value: "pct" as const, label: "% pos" }] : [])]} /></div>
        <Input type="number" min="0" step="any" value={amount} onChange={(e) => { setAmount(e.target.value); reset(); }} />
        {sizeMode === "pct" && <div className="mt-1.5 flex gap-1">{[25, 50, 75, 100].map((p) => <button key={p} onClick={() => { setAmount(String(p)); reset(); }} className="flex-1 rounded-lg border border-line py-1 text-xs text-muted hover:border-accent/50 hover:text-text">{p}%</button>)}</div>}
        {side === "sell" && <div className="mt-1 text-[11px] text-faint">Position: {qty(position?.quantity ?? 0)} {asset?.symbol}</div>}
      </div>
      {(type === "limit" || type === "stop_limit") && <Input label="Limit price" type="number" step="any" value={limit} onChange={(e) => { setLimit(e.target.value); reset(); }} placeholder={String(asset?.last_price ?? "")} />}
      {(type === "stop" || type === "stop_limit") && <Input label="Stop price" type="number" step="any" value={stop} onChange={(e) => { setStop(e.target.value); reset(); }} />}
      {type === "trailing_stop" && <Input label="Trail (%)" type="number" step="any" value={trail} onChange={(e) => { setTrail(e.target.value); reset(); }} />}
      {side === "buy" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Take-profit price" type="number" step="any" value={tp} onChange={(e) => { setTp(e.target.value); reset(); }} placeholder="optional" />
          <Input label="Stop-loss price" type="number" step="any" value={sl} onChange={(e) => { setSl(e.target.value); reset(); }} placeholder="optional" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Input label="Max slippage (bps)" type="number" min="1" value={slip} onChange={(e) => { setSlip(e.target.value); reset(); }} />
        <Select label="Time in force" value={tif} onChange={(e) => { setTif(e.target.value as any); reset(); }}><option value="gtc">GTC</option><option value="day">Day</option><option value="ioc">IOC</option></Select>
      </div>

      {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">{error}</p>}

      {!plan ? (
        <Button variant={side === "buy" ? "success" : "danger"} size="lg" className="w-full" loading={busy === "preview"} disabled={disabled || !Number(amount)} onClick={preview}>
          Review {side} {asset?.symbol}
        </Button>
      ) : (
        <div className="fade-up space-y-2 rounded-xl border border-line bg-bg-2/70 p-3 text-xs">
          <div className="flex items-center justify-between"><span className="text-sm font-semibold">{side === "buy" ? "Buy" : "Sell"} {qty(plan.quantity)} {asset.symbol}</span><span className="flex gap-1"><PaperBadge paper={plan.isPaper} /><SourceBadge source={plan.price?.source} /></span></div>
          <Row k="Est. price" v={price(plan.quote?.price ?? plan.price?.value)} />
          <Row k="Notional" v={usd(plan.notionalUsd)} />
          <Row k="Est. fees" v={usd(plan.quote?.feeUsd ?? 0)} />
          <Row k="Est. slippage" v={`${plan.quote?.slippageBps ?? "—"} bps`} />
          <Row k="Route" v={plan.quote?.route ?? plan.providerId} />
          <Row k="Account" v={plan.account.label} />
          {plan.risks?.map((r: string) => <div key={r} className="flex gap-1 text-warn"><AlertTriangle className="mt-px size-3 shrink-0" />{r}</div>)}
          <details><summary className="cursor-pointer text-muted">{plan.checks.filter((c: any) => c.ok).length}/{plan.checks.length} risk checks passed</summary>
            <ul className="mt-1 space-y-0.5">{plan.checks.map((c: any) => <li key={c.name} className={cx("flex gap-1", c.ok ? "text-muted" : c.severity === "warn" ? "text-warn" : "text-down")}>{c.ok ? <CheckCircle2 className="size-3 shrink-0 text-up" /> : <XCircle className="size-3 shrink-0" />}{c.message}</li>)}</ul>
          </details>
          {plan.decision === "rejected" ? (
            <div className="rounded-lg bg-down-soft p-2 text-down">Blocked: {plan.decisionReason}</div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Button variant={side === "buy" ? "success" : "danger"} className="flex-1" loading={busy === "place"} onClick={place}>Confirm {side}</Button>
              <Button variant="ghost" onClick={reset}>Edit</Button>
            </div>
          )}
        </div>
      )}
      {disabled && <p className="text-[11px] text-faint">This asset is view-only: no supported execution route.</p>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><span className="text-faint">{k}</span><span className="num truncate text-right text-text">{v}</span></div>;
}
