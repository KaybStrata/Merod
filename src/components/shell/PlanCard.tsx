"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Maximize2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { TimeRangePicker, range, barsQuery, type Range } from "@/components/TimeRange";
import { CheckCircle2, XCircle, AlertTriangle, Bot, ShieldCheck, Repeat } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, PaperBadge, SourceBadge, cx, useToast } from "@/components/ui";
import { price, usd, qty } from "@/lib/format";

const CandleChart = dynamic(() => import("@/components/terminal/charts").then((m) => m.CandleChart), { ssr: false, loading: () => <div className="h-[190px] animate-pulse rounded-lg bg-panel-2" /> });

/**
 * Mini chart of the coin/stock with exactly where this trade happened: an arrow on the candle at the fill
 * (or the planned entry for an unapproved order), a line at the trade price, and the take-profit / stop-loss levels.
 */
function TradeChart({ assetId, symbol, side, price: px, at, filled, takeProfit, stopLoss, limitPrice }: {
  assetId: string; symbol: string; side: "buy" | "sell"; price: number | null; at: string | null; filled: boolean; takeProfit?: number | null; stopLoss?: number | null; limitPrice?: number | null;
}) {
  const [rng, setRng] = useState<Range>(range("12h"));
  const bars = useApi<any>(`/api/assets/${assetId}/bars?${barsQuery(rng.seconds)}`);
  const list = (bars.data?.bars ?? []).map((b: any) => ({ time: Number(b.time), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume }));
  const t = Math.floor(new Date(at ?? Date.now()).getTime() / 1000);
  const entry = limitPrice ?? px;
  const lines = [
    entry ? { price: entry, color: side === "buy" ? "#22c55e" : "#f0506e", title: `${filled ? (side === "buy" ? "Bought" : "Sold") : limitPrice ? "Limit" : "Entry"} ${price(entry)}` } : null,
    takeProfit ? { price: takeProfit, color: "#38bdf8", title: `Take profit ${price(takeProfit)}${entry ? ` (${((takeProfit / entry - 1) * 100).toFixed(1)}%)` : ""}`, dashed: true } : null,
    stopLoss ? { price: stopLoss, color: "#f5b84a", title: `Stop loss ${price(stopLoss)}`, dashed: true } : null,
  ].filter(Boolean) as any[];
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line bg-bg/60">
      <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted">
        <span>{symbol} · {filled ? "where your trade filled" : "where this trade would happen"}</span>
        <span className="flex items-center gap-1">
          <Link href={`/terminal/${assetId}`} className="ml-1 rounded p-0.5 hover:text-text" title="Open full chart"><Maximize2 className="size-3" /></Link>
        </span>
      </div>
      <div className="px-2 pb-1"><TimeRangePicker value={rng} onChange={setRng} size="sm" /></div>
      {list.length > 1
        ? <CandleChart bars={list} indicators={[]} height={190} compact priceLines={lines}
            markers={[{ time: Math.max(t, list[0].time), side, kind: "mine", label: `${side === "buy" ? "BUY" : "SELL"} ${entry ? price(entry) : ""}` }]} />
        : <div className="flex h-[120px] items-center justify-center text-xs text-faint">{bars.loading ? "Loading chart…" : "No price history for this asset yet."}</div>}
    </div>
  );
}

/** Renders an assistant plan: order preview with every engine check, bot config, confirmations, clarifications. */
export function PlanCard({ message, onDone, onChip }: { message: any; onDone?: () => void; onChip?: (t: string) => void }) {
  const card = message.plan;
  const toast = useToast();
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [status, setStatus] = useState<string>(message.status);
  const [result, setResult] = useState<any>(card?.result ?? null);
  const [mimic, setMimic] = useState({ percent: card?.settings?.percent ?? 100, maxDailyUsd: card?.settings?.maxDailyUsd ?? 0 });
  if (!card) return null;

  async function approve() {
    setBusy("approve");
    try {
      const r = await api(`/api/ai/plans/${message.id}`, { method: "POST", ...(card.type === "mimic" ? { json: { mimic } } : {}) });
      setResult(r.result); setStatus("approved");
      toast(card.type === "bot" ? "Bot activated" : card.type === "mimic" ? `Mimicking @${card.handle}` : card.type === "order" ? `Order ${r.result.status}` : "Done", "up");
      onDone?.();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function dismiss() {
    setBusy("dismiss");
    try { await api(`/api/ai/plans/${message.id}`, { method: "DELETE" }); setStatus("dismissed"); } finally { setBusy(null); }
  }
  const actionable = status === "needs_approval";

  if (card.type === "clarify")
    return card.suggestions?.length ? <ClarifyChips suggestions={card.suggestions} onChip={onChip} /> : null;

  if (card.type === "executed")
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-up/30 bg-up-soft px-3 py-2 text-xs text-up">
        <CheckCircle2 className="size-4" /> {card.detail} {card.orderId && <Link className="underline" href="/portfolio">View</Link>}
      </div>
    );

  if (card.type === "order") {
    const p = card.plan;
    const failed = p.checks.filter((c: any) => !c.ok);
    return (
      <div className="mt-2 rounded-xl border border-line bg-bg-2/70 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">
            <span className={p.intent.side === "buy" ? "text-up" : "text-down"}>{p.intent.side.toUpperCase()}</span> {qty(p.quantity)} {p.asset.symbol}
            <span className="ml-1 text-xs font-normal text-muted">on {p.asset.venue}</span>
          </div>
          <div className="flex gap-1.5"><PaperBadge paper={p.isPaper} /><SourceBadge source={p.price?.source} /></div>
        </div>
        {p.asset?.id && (
          <TradeChart assetId={p.asset.id} symbol={p.asset.symbol} side={p.intent.side}
            price={result?.fillPrice ?? p.quote?.price ?? p.price?.value ?? null} at={result?.at ?? null} filled={!!result?.fillPrice}
            takeProfit={p.intent.takeProfit ?? null} stopLoss={p.intent.stopLoss ?? null}
            limitPrice={p.intent.orderType === "limit" ? p.intent.limitPrice ?? null : null} />
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <Field k="Est. price" v={price(p.quote?.price ?? p.price?.value)} />
          <Field k="Notional" v={usd(p.notionalUsd)} />
          <Field k="Est. fees" v={usd(p.quote?.feeUsd ?? 0)} />
          <Field k="Slippage" v={`${p.quote?.slippageBps ?? "—"} bps`} />
          <Field k="Route" v={p.quote?.route ?? p.providerId} />
          <Field k="Account" v={p.account.label} />
          <Field k="Order" v={p.intent.orderType} />
          <Field k="Price age" v={p.price ? `${p.price.ageSec}s` : "—"} />
        </div>
        {p.risks?.length > 0 && <ul className="mt-2 space-y-0.5 text-[11px] text-warn">{p.risks.map((r: string) => <li key={r} className="flex gap-1"><AlertTriangle className="mt-px size-3 shrink-0" />{r}</li>)}</ul>}
        <details className="mt-2 text-[11px] text-muted">
          <summary className="cursor-pointer select-none">{p.checks.length - failed.length}/{p.checks.length} engine checks passed</summary>
          <ul className="mt-1 space-y-0.5">{p.checks.map((c: any) => <li key={c.name} className={cx("flex gap-1", c.ok ? "text-muted" : c.severity === "warn" ? "text-warn" : "text-down")}>{c.ok ? <CheckCircle2 className="size-3 shrink-0 text-up" /> : <XCircle className="size-3 shrink-0" />}{c.message}</li>)}</ul>
        </details>
        <div className="mt-2 text-xs text-muted">{p.decisionReason}</div>
        <Actions status={status} actionable={actionable && p.decision !== "rejected"} busy={busy} onApprove={approve} onDismiss={dismiss} label="Approve order" result={result && `Order ${result.status}${result.reason ? ` — ${result.reason}` : ""}`} />
      </div>
    );
  }

  if (card.type === "bot") {
    const c = card.config;
    return (
      <div className="mt-2 rounded-xl border border-line bg-bg-2/70 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold"><Bot className="size-4 text-accent-2" /> {c.name}</div>
          <PaperBadge paper={c.isPaper} />
        </div>
        <div className="mt-1 text-xs text-muted">{card.strategyName} · {card.assetLabel}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {Object.entries(c.params ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => <Field key={k} k={k.replace(/_/g, " ")} v={String(v)} />)}
          <Field k="Budget" v={usd(c.budgetUsd)} />
          <Field k="Max daily spend" v={usd(c.maxDailySpendUsd)} />
          <Field k="Max daily loss" v={usd(c.maxDailyLossUsd)} />
          <Field k="Checks every" v={c.schedule.replace("every_", "")} />
          <Field k="Approval per trade" v={c.approvalRequired ? "Yes" : "No"} />
        </div>
        <p className="mt-2 flex gap-1 text-[11px] text-muted"><ShieldCheck className="size-3 shrink-0" /> Runs on Merod's servers (not your browser). Every order passes the trading engine's risk checks. Profit is not guaranteed.</p>
        <Actions status={status} actionable={actionable} busy={busy} onApprove={approve} onDismiss={dismiss} label="Activate bot"
          result={result?.botId && <Link className="underline" href={`/bots/${result.botId}`}>Bot {result.status} — open activity log</Link>} />
      </div>
    );
  }

  if (card.type === "mimic") {
    const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
    return (
      <div className="mt-2 rounded-xl border border-line bg-bg-2/70 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold"><Repeat className="size-4 text-accent-2" /> Mimic @{card.handle}</div>
          <Badge tone={card.roi >= 0 ? "up" : "down"}>{pct(card.roi)} ROI</Badge>
        </div>
        <div className="mt-1 text-xs text-muted">Top ROI earner · {card.scope.label} · {card.windowLabel}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <Field k="Profit" v={usd(card.pnl)} />
          <Field k="Put into buys" v={usd(card.invested)} />
          <Field k="Trades" v={String(card.trades)} />
          <Field k="Copies" v={card.scope.label === "all markets" ? "All their trades" : `Only ${card.scope.label}`} />
          <Field k="Sells" v="Mirrored" />
        </div>
        {actionable && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1"><span className="text-muted">Size vs their trades (%)</span>
              <input type="number" min={0.1} value={mimic.percent} onChange={(e) => setMimic((m) => ({ ...m, percent: Number(e.target.value) }))} className="w-full rounded-lg border border-line bg-panel px-2 py-1 text-text" /></label>
            <label className="space-y-1"><span className="text-muted">Max $ per day</span>
              <input type="number" min={1} value={mimic.maxDailyUsd} onChange={(e) => setMimic((m) => ({ ...m, maxDailyUsd: Number(e.target.value) }))} className="w-full rounded-lg border border-line bg-panel px-2 py-1 text-text" /></label>
          </div>
        )}
        {card.alternatives?.length > 0 && <div className="mt-2 text-[11px] text-muted">Next best: {card.alternatives.map((a: any) => `@${a.handle} ${pct(a.roi)}`).join(" · ")}</div>}
        <p className="mt-2 flex gap-1 text-[11px] text-muted"><ShieldCheck className="size-3 shrink-0" /> Only their new trades are mimicked, through the normal risk checks. Ranked from Merod traders who allow copying. Past ROI doesn't guarantee future results.</p>
        <Actions status={status} actionable={actionable} busy={busy} onApprove={approve} onDismiss={dismiss} label="Start mimic bot"
          result={result?.followId && <Link className="underline" href="/mimic">Mimic bot running — open Mimic Trading</Link>} />
      </div>
    );
  }

  if (card.type === "confirm_action")
    return (
      <div className="mt-2 rounded-xl border border-line bg-bg-2/70 p-3 text-sm">
        <div className="text-xs text-muted">{card.detail}</div>
        <Actions status={status} actionable={actionable} busy={busy} onApprove={approve} onDismiss={dismiss} label="Confirm" danger result={result && JSON.stringify(result)} />
      </div>
    );

  if (card.type === "alert") return <div className="mt-2"><Badge tone="accent">Alert: {card.created.symbol} {card.created.direction} {card.created.price}</Badge></div>;
  return null;
}

function Field({ k, v }: { k: string; v: string }) {
  return <div className="min-w-0"><span className="text-faint">{k}: </span><span className="num truncate text-text">{v}</span></div>;
}
function Actions({ status, actionable, busy, onApprove, onDismiss, label, danger, result }: any) {
  if (status === "approved") return <div className="mt-2 flex items-center gap-1 text-xs text-up"><CheckCircle2 className="size-3.5" /> Approved {result && <>· {result}</>}</div>;
  if (status === "dismissed") return <div className="mt-2 text-xs text-faint">Dismissed</div>;
  if (status === "rejected") return <div className="mt-2 text-xs text-down">Blocked by risk checks</div>;
  if (!actionable) return null;
  return (
    <div className="mt-3 flex gap-2">
      <Button size="sm" variant={danger ? "danger" : "primary"} loading={busy === "approve"} onClick={onApprove}>{label}</Button>
      <Button size="sm" variant="ghost" loading={busy === "dismiss"} onClick={onDismiss}>Dismiss</Button>
    </div>
  );
}

/** Quick answers, plus a "Custom" chip to type any amount when the question is about how much. */
function ClarifyChips({ suggestions, onChip }: { suggestions: string[]; onChip?: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const isUsd = suggestions.some((x) => x.startsWith("$"));
  const isPct = !isUsd && suggestions.some((x) => /%$/.test(x));
  const amountish = isUsd || isPct;
  const chip = "rounded-full border border-accent/40 px-3 py-1 text-xs text-accent-2 hover:bg-accent-soft";
  const num = Number(val.replace(/[$,%\s]/g, ""));
  function send() {
    if (!(num > 0)) return;
    onChip?.(isUsd ? `$${num}` : `${Math.min(num, 100)}%`);
    setOpen(false); setVal("");
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {suggestions.map((s) => <button key={s} onClick={() => onChip?.(s)} className={chip}>{s}</button>)}
      {amountish && (open ? (
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1 rounded-full border border-accent/60 bg-bg-2 py-0.5 pl-3 pr-1">
          {isUsd && <span className="text-xs text-muted">$</span>}
          <input autoFocus inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder={isUsd ? "Any amount" : "Any %"} aria-label="Custom amount"
            className="w-24 bg-transparent text-xs text-text outline-none placeholder:text-faint" />
          {isPct && <span className="text-xs text-muted">%</span>}
          <button type="submit" disabled={!(num > 0)} className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-black disabled:opacity-40">Use</button>
        </form>
      ) : <button onClick={() => setOpen(true)} className={chip}>Custom…</button>)}
    </div>
  );
}
