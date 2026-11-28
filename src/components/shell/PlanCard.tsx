"use client";
import { useEffect, useRef, useState } from "react";
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
  const [editing, setEditing] = useState(false);
  const [botEdits, setBotEdits] = useState<any>({});
  const [orderEdits, setOrderEdits] = useState<any>({});
  // Settings card you approved by typing "approve": apply it once, as soon as it arrives.
  const autoRan = useRef(false);
  useEffect(() => {
    if (card?.type !== "app_action" || !card.autoApply || message.status !== "needs_approval" || autoRan.current) return;
    autoRan.current = true;
    (async () => {
      setBusy("approve");
      try { await applyActions(card.steps); await api(`/api/ai/plans/${message.id}`, { method: "POST" }).catch(() => {}); setStatus("approved"); toast("Changes applied", "up"); onDone?.(); }
      catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!card) return null;

  async function approve() {
    setBusy("approve");
    try {
      const r = await api(`/api/ai/plans/${message.id}`, { method: "POST", ...(card.type === "mimic" ? { json: { mimic } } : card.type === "bot" && Object.keys(botEdits).length ? { json: { config: botEdits } } : card.type === "order" && Object.keys(orderEdits).length ? { json: { intent: orderEdits } } : {}) });
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

  if (card.type === "app_action") {
    if (card.link && !card.steps?.length)
      return <Link href={card.link.href} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-grad px-3 py-1.5 text-xs font-semibold text-bg">Open {card.link.label} →</Link>;
    const applyAll = async () => {
      setBusy("approve");
      try {
        await applyActions(card.steps);
        await api(`/api/ai/plans/${message.id}`, { method: "POST" }).catch(() => {});
        setStatus("approved"); toast("Changes applied", "up"); onDone?.();
      } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
    };
    return (
      <div className="mt-2 rounded-xl border border-line bg-panel-2/60 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-2"><ShieldCheck className="size-3.5" /> Settings change · needs you</div>
        <ul className="space-y-1 text-xs">{card.steps.map((s: any, i: number) => <li key={i} className="flex gap-1.5"><span className="text-accent-2">•</span>{s.label}</li>)}</ul>
        <p className="mt-2 text-[10.5px] text-faint">Applied by you, through your own settings. Merod&apos;s AI can propose changes but never makes them on its own.</p>
        {actionable ? (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" loading={busy === "approve"} onClick={applyAll}>Approve</Button>
            <Button size="sm" variant="ghost" loading={busy === "dismiss"} onClick={dismiss}>Dismiss</Button>
          </div>
        ) : <div className="mt-2 text-xs text-muted">{status === "approved" ? "✓ Applied" : status === "dismissed" ? "Dismissed" : status}</div>}
      </div>
    );
  }

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
          <div className="flex items-center gap-1.5">
            {actionable && !editing && <button onClick={() => setEditing(true)} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-text">Edit</button>}
            <PaperBadge paper={p.isPaper} /><SourceBadge source={p.price?.source} />
          </div>
        </div>
        {actionable && editing && (
          <OrderEditor intent={{ ...p.intent, ...orderEdits }} onCancel={() => setEditing(false)}
            onSave={(e) => { setOrderEdits(e); setEditing(false); toast("Edits will be used when you approve (every check runs again)", "neutral"); }} />
        )}
        {Object.keys(orderEdits).length > 0 && actionable && (
          <div className="mt-1 text-[11px] text-accent-2">Edited: {orderEdits.notionalUsd ? `$${orderEdits.notionalUsd}` : ""}{orderEdits.quantity ? `${orderEdits.quantity} units` : ""}{orderEdits.limitPrice ? ` · limit ${orderEdits.limitPrice}` : ""}{orderEdits.takeProfit ? ` · TP ${orderEdits.takeProfit}` : ""}{orderEdits.stopLoss ? ` · SL ${orderEdits.stopLoss}` : ""}</div>
        )}
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
    const c = { ...card.config, ...botEdits, params: { ...(card.config.params ?? {}), ...(botEdits.params ?? {}) } };
    const botId = result?.botId;
    return (
      <div className="mt-2 rounded-xl border border-line bg-bg-2/70 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold"><Bot className="size-4 text-accent-2" /> {c.name}</div>
          <div className="flex items-center gap-2">
            {(actionable || botId) && !editing && <button onClick={() => setEditing(true)} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-text">Edit</button>}
            <PaperBadge paper={c.isPaper} />
          </div>
        </div>
        <div className="mt-1 text-xs text-muted">{card.strategyName} · {card.assetLabel}</div>
        {editing && (
          <BotEditor config={c} busy={busy === "approve"} after={!!botId}
            onCancel={() => setEditing(false)}
            onSave={async (patch) => {
              if (!botId) { setBotEdits((e: any) => ({ ...e, ...patch, params: { ...(e.params ?? {}), ...(patch.params ?? {}) } })); setEditing(false); toast("Edits will be used when you approve", "neutral"); return; }
              setBusy("approve");
              try {
                const cur: any = await api(`/api/bots/${botId}`);
                const wasRunning = cur.bot?.status === "running";
                if (wasRunning) await api(`/api/bots/${botId}`, { method: "POST", json: { action: "pause" } });
                await api(`/api/bots/${botId}`, { method: "PATCH", json: patch });
                if (wasRunning) await api(`/api/bots/${botId}`, { method: "POST", json: { action: "resume" } });
                setBotEdits((e: any) => ({ ...e, ...patch, params: { ...(e.params ?? {}), ...(patch.params ?? {}) } })); setEditing(false); toast("Bot updated", "up");
              } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
            }} />
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {Object.entries(c.params ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => <Field key={k} k={k.replace(/_/g, " ")} v={String(v)} />)}
          <Field k="Per coin buy" v={Number(c.maxPositionUsd) > 0 ? usd(c.maxPositionUsd) : "No limit"} />
          <Field k="Checks every" v={c.schedule.replace("every_", "")} />
          <Field k="Approval per trade" v={c.approvalRequired ? "Yes" : "No"} />
        </div>
        {(actionable || botId) && (
          <div className={cx("mt-2 flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2", c.allowRisky ? "border-down/40 bg-down-soft/30" : "border-line bg-bg/40")}>
            <div className="min-w-0 text-[11.5px]">
              <div className="font-semibold">Risk flagging {c.allowRisky ? <span className="text-down">OFF</span> : <span className="text-up">ON</span>}</div>
              <div className="text-faint">{c.allowRisky ? "Won't reject new, unverified or low-liquidity coins, or high slippage." : "Rejects buys of new, unverified or low-liquidity coins, and high slippage."}</div>
            </div>
            <button role="switch" aria-checked={!c.allowRisky} aria-label="Risk flagging" disabled={busy === "approve"}
              onClick={async () => {
                const next = !c.allowRisky;
                if (!botId) { setBotEdits((e: any) => ({ ...e, allowRisky: next })); return; }
                setBusy("approve");
                try { await api(`/api/bots/${botId}`, { method: "PATCH", json: { allowRisky: next } }); setBotEdits((e: any) => ({ ...e, allowRisky: next })); toast(next ? "Risk flagging off for this bot" : "Risk flagging on for this bot", next ? "neutral" : "up"); }
                catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
              }}
              className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50", !c.allowRisky ? "bg-up" : "bg-panel-2")}>
              <span className={cx("absolute top-0.5 size-5 rounded-full bg-white transition-all", !c.allowRisky ? "left-[22px]" : "left-0.5")} />
            </button>
          </div>
        )}
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

/**
 * Apply an approved app-action card from the browser, through the same authenticated endpoints the Settings, Auto trading
 * and Bot screens use (settings sections are merged with your current values, so nothing else changes).
 */
async function applyActions(steps: any[]) {
  let current: any = null;
  for (const s of steps) {
    if (s.op === "settings") {
      current ??= await api("/api/settings");
      const base = s.section === "risk" ? current.risk : s.section === "automation" ? current.permissions : { theme: current.profile?.theme };
      const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
      const keys = s.section === "risk" ? ["max_order_usd", "max_daily_spend_usd", "max_daily_loss_usd", "max_slippage_bps", "min_liquidity_usd", "max_price_age_sec", "block_risky_tokens", "trading_halted"]
        : s.section === "automation" ? ["mode", "auto_max_order_usd", "auto_daily_cap_usd", "allow_ai_prompts", "allow_bots", "allow_shortcuts", "allowed_asset_classes"] : ["theme"];
      const values: any = { ...pick(base, keys), ...s.values };
      for (const k of Object.keys(values)) if (typeof values[k] === "string" && values[k] !== "" && !isNaN(Number(values[k])) && !["mode", "theme"].includes(k)) values[k] = Number(values[k]);
      await api("/api/settings", { method: "PATCH", json: { section: s.section, values } });
      if (s.section === "risk") current.risk = { ...current.risk, ...values };
      if (s.section === "automation") current.permissions = { ...current.permissions, ...values };
      if (s.section === "theme") { document.documentElement.dataset.theme = values.theme; try { localStorage.setItem("merod-theme", values.theme); } catch { /* ignore */ } }
    } else if (s.op === "auto") {
      await api("/api/auto", { method: "PATCH", json: s.body });
    } else if (s.op === "bots_approval") {
      // Approval is a config field, so a running bot is paused for a moment, updated and resumed.
      const r: any = await api("/api/bots");
      for (const b of r.bots ?? []) {
        if (!!b.approval_required === s.value) continue;
        const running = b.status === "running";
        if (running) await api(`/api/bots/${b.id}`, { method: "POST", json: { action: "pause" } });
        await api(`/api/bots/${b.id}`, { method: "PATCH", json: { approvalRequired: s.value } });
        if (running) await api(`/api/bots/${b.id}`, { method: "POST", json: { action: "resume" } });
      }
    } else if (s.op === "bots_allow_risky") {
      const r: any = await api("/api/bots");
      for (const b of r.bots ?? []) if (!!b.allow_risky !== s.value) await api(`/api/bots/${b.id}`, { method: "PATCH", json: { allowRisky: s.value } });
    }
  }
}

const numIn = "h-7 w-full rounded-md border border-line bg-panel-2 px-2 text-[12px] outline-none focus:border-accent/60";

/** Edit a bot's numbers from its card: strategy values (amounts, %, levels), budget and caps (0 = no limit), approval. */
function BotEditor({ config, busy, after, onSave, onCancel }: { config: any; busy: boolean; after: boolean; onSave: (patch: any) => void; onCancel: () => void }) {
  const numericParams = Object.entries(config.params ?? {}).filter(([, v]) => typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v))));
  const [params, setParams] = useState<Record<string, string>>(Object.fromEntries(numericParams.map(([k, v]) => [k, String(v)])));
  const [lim, setLim] = useState({ budgetUsd: String(config.budgetUsd ?? 0), maxPositionUsd: String(config.maxPositionUsd ?? 0), maxDailySpendUsd: String(config.maxDailySpendUsd ?? 0), maxDailyLossUsd: String(config.maxDailyLossUsd ?? 0) });
  const [approval, setApproval] = useState(!!config.approvalRequired);
  const save = () => {
    const p = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && !isNaN(Number(v))).map(([k, v]) => [k, Number(v)]));
    const l = Object.fromEntries(Object.entries(lim).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]));
    onSave({ params: p, ...l, approvalRequired: approval });
  };
  return (
    <div className="mt-2 rounded-lg border border-accent/40 bg-bg/50 p-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {numericParams.map(([k]) => (
          <label key={k} className="text-[10.5px] text-faint">{k.replace(/_/g, " ")}<input inputMode="decimal" value={params[k]} onChange={(e) => setParams({ ...params, [k]: e.target.value })} className={numIn} /></label>
        ))}
        {([["maxPositionUsd", "Per coin buy $"]] as const).map(([k, l]) => (
          <label key={k} className="text-[10.5px] text-faint">{l} <span className="text-faint/70">(0 = no limit)</span><input inputMode="decimal" value={lim[k]} onChange={(e) => setLim({ ...lim, [k]: e.target.value })} className={numIn} /></label>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-[11.5px] text-muted"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Ask me before each trade</label>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={save}>{after ? "Save to bot" : "Use these values"}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {after && <p className="mt-1 text-[10.5px] text-faint">The bot is paused for a moment, updated and resumed. Past trades aren&apos;t changed.</p>}
    </div>
  );
}

/** Edit an order before approving it: amount (or quantity), limit price, take-profit and stop-loss. The engine re-checks everything. */
function OrderEditor({ intent, onSave, onCancel }: { intent: any; onSave: (e: any) => void; onCancel: () => void }) {
  const byQty = intent.quantity != null && intent.notionalUsd == null;
  const [amount, setAmount] = useState(String(byQty ? intent.quantity : intent.notionalUsd ?? ""));
  const [limit, setLimit] = useState(String(intent.limitPrice ?? ""));
  const [tp, setTp] = useState(String(intent.takeProfit ?? ""));
  const [sl, setSl] = useState(String(intent.stopLoss ?? ""));
  const n = (s: string) => (s.trim() === "" ? undefined : Number(s));
  return (
    <div className="mt-2 rounded-lg border border-accent/40 bg-bg/50 p-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[10.5px] text-faint">{byQty ? "Quantity" : "Amount $"}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={numIn} /></label>
        {intent.orderType === "limit" && <label className="text-[10.5px] text-faint">Limit price<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className={numIn} /></label>}
        <label className="text-[10.5px] text-faint">Take-profit price<input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="optional" className={numIn} /></label>
        <label className="text-[10.5px] text-faint">Stop-loss price<input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="optional" className={numIn} /></label>
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" onClick={() => {
          const e: any = byQty ? { quantity: n(amount) } : { notionalUsd: n(amount) };
          if (intent.orderType === "limit" && n(limit)) e.limitPrice = n(limit);
          if (n(tp)) e.takeProfit = n(tp); if (n(sl)) e.stopLoss = n(sl);
          for (const k of Object.keys(e)) if (!(Number(e[k]) > 0)) delete e[k];
          onSave(e);
        }}>Use these values</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
