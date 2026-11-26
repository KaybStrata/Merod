"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Route, X, Lock, ArrowLeft, Loader2 } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { CodeInput } from "@/components/settings/AccountSecurity";
import { AssetIcon, cx } from "@/components/ui";
import { price, usd, qty } from "@/lib/format";

export type ReviewResult = { status: string; reason?: string | null; orderId?: string };

/**
 * Review order (step 2 of 3): what will happen, every engine check, price impact, costs and routing.
 * Real-money orders add a 2-step verification code (checked by the server) before "Confirm & route".
 */
export function ReviewOrder({ open, asset, side, plan, live, onClose, onConfirm }: {
  open: boolean; asset: any; side: "buy" | "sell"; plan: any; live: boolean;
  onClose: () => void; onConfirm: (code?: string) => Promise<ReviewResult | null>;
}) {
  const { user } = useShell();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  useEffect(() => { if (open) { setCode(""); setResult(null); setBusy(false); } }, [open, plan]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open, busy, onClose]);
  if (!open || !plan) return null;

  const needCode = live && user.totpEnabled;
  const checks: any[] = plan.checks ?? [];
  const passed = checks.filter((c) => c.ok).length;
  const blocked = plan.decision === "rejected";
  const px = Number(plan.quote?.price ?? plan.price?.value ?? 0);
  const fee = Number(plan.quote?.feeUsd ?? 0);
  const slipBps = Number(plan.quote?.slippageBps ?? 0);
  const maxSlip = Number(plan.maxSlippageBps ?? plan.intent?.maxSlippageBps ?? 100) || 100;
  const slipCost = Number(plan.notionalUsd ?? 0) * slipBps / 10_000;
  const total = side === "buy" ? Number(plan.notionalUsd ?? 0) + fee : Number(plan.notionalUsd ?? 0) - fee;
  const step = result ? 3 : 2;

  async function confirm() {
    setBusy(true);
    try { const r = await onConfirm(needCode ? code : undefined); if (r) setResult(r); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[6vh] backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="fade-up w-full max-w-4xl rounded-2xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Step {step} of 3 · {step === 2 ? "Safety review" : "Routed"}</div>
            <h2 className="mt-0.5 flex items-center gap-2 text-[22px] font-semibold tracking-tight">
              <AssetIcon symbol={asset.symbol} logo={asset.logo_url} size={26} />{asset.symbol} <span className="serif-accent text-[26px] text-accent-2">Review</span> order
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 sm:flex">{["Plan", "Review", "Routed"].map((s, i) => <span key={s} className={cx("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", i + 1 < step ? "bg-up-soft text-up" : i + 1 === step ? "bg-accent-soft text-accent-2" : "text-faint")}>{i + 1} {s}</span>)}</div>
            <span className={cx("rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider", plan.isPaper ? "bg-warn-soft text-warn" : "bg-down-soft text-down")}>{plan.isPaper ? "PAPER" : "REAL MONEY"}</span>
            <button onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text" aria-label="Close"><X className="size-4" /></button>
          </div>
        </header>

        {result ? (
          <div className="space-y-4 p-6 text-center">
            {["filled", "submitted", "partially_filled", "pending_approval"].includes(result.status) ? <CheckCircle2 className="mx-auto size-10 text-up" /> : <XCircle className="mx-auto size-10 text-down" />}
            <div className="text-[18px] font-semibold capitalize">{result.status.replace(/_/g, " ")}</div>
            {result.reason && <p className="text-[13px] text-muted">{result.reason}</p>}
            <p className="text-[12px] text-faint">Routed via {plan.quote?.route ?? plan.providerId} · {plan.account?.label}{result.orderId ? ` · order ${result.orderId.slice(0, 8)}` : ""}</p>
            <button onClick={onClose} className="h-10 rounded-xl bg-grad px-6 text-[13.5px] font-semibold text-bg">Done</button>
          </div>
        ) : (
          <div className="grid gap-0 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4 p-5">
              <div>
                <div className={cx("text-[12px] font-semibold uppercase tracking-wide", side === "buy" ? "text-up" : "text-down")}>{side === "buy" ? "Buy" : "Sell"} · {(plan.intent?.orderType ?? "market").replace(/_/g, " ")}</div>
                <div className="num mt-0.5 text-[34px] font-semibold leading-none tracking-tight">{qty(plan.quantity)} <span className="text-muted">{asset.symbol}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat k="Est. price" v={price(px)} />
                <Stat k="Notional" v={usd(plan.notionalUsd)} />
                <Stat k="Est. fees" v={usd(fee)} />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-muted"><span>Price impact / slippage</span><span className="num">{slipBps} bps of {maxSlip} bps max</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel-2"><div className={cx("h-full rounded-full", slipBps > maxSlip ? "bg-down" : slipBps > maxSlip * 0.6 ? "bg-warn" : "bg-up")} style={{ width: `${Math.min(100, (slipBps / maxSlip) * 100)}%` }} /></div>
              </div>
              <dl className="divide-y divide-line/60 rounded-xl border border-line text-[12.5px]">
                <Line k="Notional" v={usd(plan.notionalUsd)} />
                <Line k="Commission & network fees" v={usd(fee)} />
                <Line k="Est. slippage cost" v={usd(slipCost)} />
                <Line k={side === "buy" ? "Total you pay" : "Total you receive"} v={usd(total)} strong />
              </dl>
              <div className="flex items-start gap-2 rounded-xl border border-line bg-bg-2/50 p-3 text-[12px]">
                <Route className="mt-0.5 size-4 shrink-0 text-accent-2" />
                <div><div className="font-medium">Routed via {plan.quote?.route ?? plan.providerId}</div><div className="text-muted">{plan.account?.label}{plan.price?.source ? ` · price from ${plan.price.source}` : ""}</div></div>
              </div>
              {(plan.risks ?? []).map((r: string) => <div key={r} className="flex gap-1.5 text-[12px] text-warn"><AlertTriangle className="mt-px size-3.5 shrink-0" />{r}</div>)}
            </div>

            <aside className="border-t border-line p-5 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><ShieldCheck className="size-4 text-accent-2" /> Engine checklist</h3><span className={cx("rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", passed === checks.length ? "bg-up-soft text-up" : "bg-warn-soft text-warn")}>{passed}/{checks.length} passed</span></div>
              <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {checks.map((c) => (
                  <li key={c.name} className="flex gap-2 text-[12px]">
                    {c.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-up" /> : c.severity === "warn" ? <AlertTriangle className="mt-px size-3.5 shrink-0 text-warn" /> : <XCircle className="mt-px size-3.5 shrink-0 text-down" />}
                    <span className={c.ok ? "text-muted" : c.severity === "warn" ? "text-warn" : "text-down"}>{c.message}</span>
                  </li>
                ))}
              </ul>
            </aside>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 lg:col-span-2">
              {blocked ? <div className="rounded-lg bg-down-soft px-3 py-2 text-[12.5px] text-down">Blocked by the engine: {plan.decisionReason}</div>
                : needCode ? (
                  <div className="flex items-center gap-3"><Lock className="size-4 text-accent-2" /><div><div className="text-[12px] font-medium">2-step verification</div><div className="text-[11px] text-muted">Code from your authenticator app</div></div><CodeInput value={code} onChange={setCode} autoFocus /></div>
                ) : live ? <p className="flex items-center gap-1.5 text-[11.5px] text-warn"><Lock className="size-3.5" />Real money. Turn on 2FA in Settings → Security to add a verification step.</p>
                  : <p className="text-[11.5px] text-muted">Paper order: no real money moves.</p>}
              <div className="ml-auto flex gap-2">
                <button onClick={onClose} disabled={busy} className="flex h-10 items-center gap-1.5 rounded-xl border border-line-2 px-4 text-[13px] hover:border-accent/50"><ArrowLeft className="size-4" />Back to plan</button>
                {!blocked && <button onClick={confirm} disabled={busy || (needCode && code.length < 6)} className={cx("flex h-10 items-center gap-1.5 rounded-xl px-5 text-[13.5px] font-semibold disabled:opacity-50", live ? "bg-down text-white" : "bg-grad text-bg")}>{busy && <Loader2 className="size-4 animate-spin" />}Confirm & route</button>}
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl border border-line bg-bg-2/50 px-3 py-2"><div className="text-[10.5px] uppercase tracking-wide text-faint">{k}</div><div className="num mt-0.5 truncate text-[15px] font-semibold">{v}</div></div>;
}
function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className="flex justify-between px-3 py-2"><dt className={strong ? "font-medium" : "text-muted"}>{k}</dt><dd className={cx("num", strong && "font-semibold")}>{v}</dd></div>;
}
