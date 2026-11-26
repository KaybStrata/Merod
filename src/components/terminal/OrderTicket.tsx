"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { price, usd, qty } from "@/lib/format";
import { AccountPicker, type TradeMode } from "@/components/wallet/AccountPicker";
import { signOrderWithWallet } from "@/components/wallet/SolanaWallets";
import { ReviewOrder, type ReviewResult } from "./ReviewOrder";

type OType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";

/**
 * Manual order ticket: live pre-trade checks (engine preview, no side effects) → Review order (step 2) →
 * confirm & route (idempotent; real-money orders can carry a 2-step verification code).
 */
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
  const [adv, setAdv] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [acct, setAcct] = useState("");
  const [mode, setMode] = useState<TradeMode>("paper");
  const accts = useApi<any>("/api/wallet/accounts");
  const key = useRef<string>("");
  const seq = useRef(0);

  const last = asset?.last_price != null ? Number(asset.last_price) : null;
  const account = (accts.data?.accounts ?? []).find((a: any) => a.id === acct);
  const cash = account && (account.kind === "paper" || account.cash_balance != null) ? Number(account.cash_balance ?? 0) : null;

  function intent() {
    const n = Number(amount);
    const i: any = { asset: { assetId: asset.id }, side, orderType: type, timeInForce: tif, maxSlippageBps: Number(slip) || undefined, ...(acct ? { accountId: acct } : {}) };
    if (sizeMode === "usd") i.notionalUsd = n; else if (sizeMode === "qty") i.quantity = n; else i.percentOfPosition = Math.min(100, n);
    if (type === "limit" || type === "stop_limit") i.limitPrice = Number(limit);
    if (type === "stop" || type === "stop_limit") i.stopPrice = Number(stop);
    if (type === "trailing_stop") i.trailPercent = Number(trail);
    if (side === "buy" && tp) i.takeProfit = Number(tp);
    if (side === "buy" && sl) i.stopLoss = Number(sl);
    return i;
  }
  const ready = !!asset && asset.tradability !== "view_only" && Number(amount) > 0
    && (!["limit", "stop_limit"].includes(type) || Number(limit) > 0) && (!["stop", "stop_limit"].includes(type) || Number(stop) > 0);

  // Live pre-trade checks: re-run the engine preview (no side effects) shortly after the ticket changes.
  useEffect(() => {
    setPlan(null); setError(null);
    if (!ready || !acct) return;
    const my = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try { const r = await api("/api/orders", { method: "POST", json: { intent: intent(), mode: "preview" } }); if (my === seq.current) setPlan(r.plan); }
      catch (e: any) { if (my === seq.current) setError(e.body?.issues?.[0]?.message ?? e.message); }
      finally { if (my === seq.current) setChecking(false); }
    }, 650);
    return () => clearTimeout(t);
  }, [side, type, sizeMode, amount, limit, stop, trail, tp, sl, slip, tif, acct, asset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function openReview() { if (!plan) return; key.current = crypto.randomUUID(); setReview(true); }
  async function confirm(code?: string): Promise<ReviewResult | null> {
    try {
      const r = await api("/api/orders", { method: "POST", json: { intent: intent(), mode: "place", idempotencyKey: key.current, ...(code ? { code } : {}) } });
      let o = r.order;
      if (o.status === "pending_approval" && o.unsigned_tx?.tx) { toast("Approve the swap in your wallet…", "neutral"); o = (await signOrderWithWallet(o) as any).order ?? o; }
      toast(`${o.status === "filled" ? "Filled" : o.status === "submitted" ? "Order working" : `Order ${o.status}`}${o.status_reason ? `: ${o.status_reason}` : ""}`, ["filled", "submitted"].includes(o.status) ? "up" : "down");
      onPlaced();
      return { status: o.status, reason: o.status_reason, orderId: o.id };
    } catch (e: any) { toast(e.message, "down"); return null; }
  }

  // Quick sizes: % of buying power for buys (when the account's cash is known), % of the position for sells.
  function quick(p: number) {
    if (side === "sell") { setSizeMode("pct"); setAmount(String(p)); return; }
    if (cash != null && cash > 0) { setSizeMode("usd"); setAmount(String(Math.floor(cash * p) / 100)); }
  }
  const estQty = plan?.quantity ?? (sizeMode === "usd" && last ? Number(amount) / last : sizeMode === "qty" ? Number(amount) : null);
  const checks: any[] = plan?.checks ?? [];
  const failing = checks.filter((c) => !c.ok);
  const shown = [...failing, ...checks.filter((c) => c.ok)].slice(0, 6);
  const live = mode === "live";
  const priceLabel = type === "market" ? "Market" : type === "limit" ? `Limit ${limit || "—"}` : type === "stop" ? `Stop ${stop || "—"}` : type === "stop_limit" ? `Stop-limit ${limit || "—"}` : `Trail ${trail}%`;
  const disabled = !asset || asset.tradability === "view_only";

  return (
    <div className="space-y-3">
      <AccountPicker asset={asset} value={acct} onChange={(i, m) => { setAcct(i); setMode(m); }} compact />
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg-2/60 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); if (s === "sell" && sizeMode === "usd" && position?.quantity) { setSizeMode("pct"); setAmount("100"); } if (s === "buy" && sizeMode === "pct") { setSizeMode("usd"); setAmount("100"); } if (s === "buy" && type === "trailing_stop") setType("market"); }}
            className={cx("rounded-lg py-2 text-[13px] font-semibold transition-colors", side === s ? (s === "buy" ? "bg-up text-[#04130d]" : "bg-down text-white") : "text-muted hover:text-text")}>{s === "buy" ? "Buy" : "Sell"}</button>
        ))}
      </div>
      <div className="flex items-center gap-0.5 border-b border-line text-[12.5px]">
        {(["market", "limit", "stop"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={cx("-mb-px border-b-2 px-2.5 pb-1.5 capitalize", type === t ? "border-accent-2 text-text" : "border-transparent text-muted hover:text-text")}>{t}</button>
        ))}
        <select value={["stop_limit", "trailing_stop"].includes(type) ? type : ""} onChange={(e) => e.target.value && setType(e.target.value as OType)} className="ml-auto bg-transparent pb-1.5 text-[12px] text-muted outline-none" aria-label="More order types">
          <option value="">More…</option><option value="stop_limit">Stop-limit</option><option value="trailing_stop" disabled={side === "buy"}>Trailing stop (sell)</option>
        </select>
      </div>

      {(type === "limit" || type === "stop_limit") && <Field label="Limit price" value={limit} onChange={setLimit} suffix={last != null ? <button onClick={() => setLimit(String(last))} className="text-[11px] text-accent-2">Last</button> : null} placeholder={last != null ? String(last) : ""} />}
      {(type === "stop" || type === "stop_limit") && <Field label="Stop price" value={stop} onChange={setStop} suffix={last != null ? <button onClick={() => setStop(String(last))} className="text-[11px] text-accent-2">Last</button> : null} />}
      {type === "trailing_stop" && <Field label="Trail (%)" value={trail} onChange={setTrail} />}

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
          <span>{side === "buy" ? "Amount" : "Size"}</span>
          <span className="flex gap-0.5 rounded-md border border-line p-0.5">
            {([["usd", "USD"], ["qty", asset?.symbol ?? "Qty"], ...(side === "sell" ? [["pct", "% pos"]] : [])] as [typeof sizeMode, string][]).map(([v, l]) => (
              <button key={v} onClick={() => { setSizeMode(v); setAmount(v === "pct" ? "25" : v === "usd" ? "100" : "1"); }} className={cx("rounded px-1.5 py-px", sizeMode === v ? "bg-accent-soft text-accent-2" : "text-muted")}>{l}</button>
            ))}
          </span>
        </div>
        <div className="flex h-10 items-center rounded-lg border border-line bg-panel-2/70 px-3 focus-within:border-accent/60">
          {sizeMode === "usd" && <span className="mr-1 text-muted">$</span>}
          <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="num min-w-0 flex-1 bg-transparent text-[15px] outline-none" aria-label="Amount" />
          <span className="text-[11px] text-faint">{sizeMode === "usd" ? "USD" : sizeMode === "qty" ? asset?.symbol : "%"}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {[25, 50, 75, 100].map((p) => (
            <button key={p} onClick={() => quick(p)} disabled={side === "buy" && !(cash && cash > 0)} title={side === "buy" ? (cash ? `${p}% of ${usd(cash)} buying power` : "Buying power unknown for this account") : `${p}% of your position`}
              className="rounded-md border border-line py-1 text-[11.5px] text-muted hover:border-accent/50 hover:text-text disabled:opacity-40">{p === 100 ? "Max" : `${p}%`}</button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-faint">
          <span>{side === "buy" ? <>Buying power {cash != null ? <b className="num font-medium text-muted">{usd(cash)}</b> : "—"}</> : <>Position <b className="num font-medium text-muted">{qty(position?.quantity ?? 0)}</b> {asset?.symbol}</>}</span>
          {estQty != null && Number.isFinite(estQty) && <span>≈ <b className="num font-medium text-muted">{qty(estQty)}</b> {asset?.symbol}</span>}
        </div>
      </div>

      {side === "buy" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Take-profit" value={tp} onChange={setTp} placeholder="optional" />
          <Field label="Stop-loss" value={sl} onChange={setSl} placeholder="optional" />
        </div>
      )}
      <button onClick={() => setAdv(!adv)} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-text"><ChevronDown className={cx("size-3.5 transition-transform", adv && "rotate-180")} />Slippage & time in force</button>
      {adv && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Max slippage (bps)" value={slip} onChange={setSlip} />
          <label className="text-[11px] text-faint">Time in force
            <select value={tif} onChange={(e) => setTif(e.target.value as any)} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel-2/70 px-2 text-[13px] text-text"><option value="gtc">GTC</option><option value="day">Day</option><option value="ioc">IOC</option></select>
          </label>
        </div>
      )}

      {/* Pre-trade risk checks (live engine preview) */}
      <div className="rounded-xl border border-line bg-bg-2/50 p-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-muted"><ShieldCheck className="size-3.5 text-accent-2" />Pre-trade checks</span>
          {checking ? <Loader2 className="size-3.5 animate-spin text-faint" /> : plan ? <span className={failing.length ? "text-warn" : "text-up"}>{checks.length - failing.length}/{checks.length} passed</span> : null}
        </div>
        {error ? <p className="mt-1.5 text-[11.5px] text-down">{error}</p> : plan ? (
          <ul className="mt-1.5 space-y-1">
            {shown.map((c) => (
              <li key={c.name} className={cx("flex gap-1.5 text-[11.5px] leading-snug", c.ok ? "text-muted" : c.severity === "warn" ? "text-warn" : "text-down")}>
                {c.ok ? <CheckCircle2 className="mt-px size-3 shrink-0 text-up" /> : c.severity === "warn" ? <AlertTriangle className="mt-px size-3 shrink-0" /> : <XCircle className="mt-px size-3 shrink-0" />}<span className="line-clamp-2">{c.message}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-line/60 pt-1 text-[11.5px]"><span className="text-faint">Est. {side === "buy" ? "cost" : "proceeds"}</span><span className="num text-text">{usd(plan.notionalUsd)}{plan.quote?.feeUsd ? ` + ${usd(plan.quote.feeUsd)} fees` : ""}</span></li>
          </ul>
        ) : <p className="mt-1.5 text-[11.5px] text-faint">{!acct ? "Choose an account to run the checks." : ready ? "Checking…" : "Enter an amount to run the checks."}</p>}
      </div>

      <button onClick={openReview} disabled={disabled || !plan || checking || plan.decision === "rejected"}
        className={cx("flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold transition-opacity disabled:opacity-50", side === "buy" ? "bg-up text-[#04130d]" : "bg-down text-white", live && "ring-2 ring-down/40")}>
        {side === "buy" ? "Buy" : "Sell"} {estQty != null && Number.isFinite(estQty) ? qty(estQty) : ""} {asset?.symbol} · {priceLabel}{live ? " · real money" : ""}
      </button>
      {plan?.decision === "rejected" && <p className="text-center text-[11.5px] text-down">Blocked: {plan.decisionReason}</p>}
      {plan?.decision === "pending_approval" && <p className="text-center text-[11px] text-warn">{plan.decisionReason}</p>}
      {disabled && <p className="text-[11px] text-faint">This asset is view-only: no supported execution route.</p>}
      {last != null && <p className="text-center text-[10.5px] text-faint">Last {price(last)} · {plan?.isPaper === false ? "real account" : "paper fills at the live price"}</p>}

      <ReviewOrder open={review} asset={asset} side={side} plan={plan} live={live && plan?.isPaper === false} onClose={() => setReview(false)} onConfirm={confirm} />
    </div>
  );
}

function Field({ label, value, onChange, placeholder, suffix }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; suffix?: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-faint">{label}
      <span className="mt-1 flex h-9 items-center rounded-lg border border-line bg-panel-2/70 px-2.5 focus-within:border-accent/60">
        <input type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="num min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none" />
        {suffix}
      </span>
    </label>
  );
}
