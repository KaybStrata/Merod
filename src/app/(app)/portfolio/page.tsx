"use client";
import { SectionTabs } from "@/components/SectionTabs";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PieChart as PieIcon, Layers, ArrowLeftRight, Bot, RotateCcw, ListChecks, Activity, Wallet, PieChart } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usd, price, qty, pct, ago, tone } from "@/lib/format";
import { AssetIcon, Badge, Button, Card, ChangeText, Empty, Input, Modal, PaperBadge, Pills, Skeleton, SourceBadge, Sparkline, Stat, StatusPill, cx, useToast } from "@/components/ui";
import { useRealtime } from "@/components/shell/context";
import { ValueHistory } from "@/components/ValueHistory";

type Tab = "overview" | "holdings" | "transactions" | "orders" | "performance";

function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + Math.max(p.value, 0), 0) || 1;
  let acc = 0;
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <svg width="140" height="140" viewBox="0 0 140 140" aria-label="Allocation">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--line)" strokeWidth="16" />
        {parts.map((p) => {
          const frac = Math.max(p.value, 0) / total;
          const el = <circle key={p.label} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${frac * c} ${c}`} strokeDashoffset={-acc * c} transform="rotate(-90 70 70)" />;
          acc += frac;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" className="fill-[var(--muted)] text-[10px]">Total</text>
        <text x="70" y="82" textAnchor="middle" className="fill-[var(--text)] text-[12px] font-semibold">{usd(total, { compact: true })}</text>
      </svg>
      <ul className="space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: p.color }} /><span className="w-14 text-muted">{p.label}</span><span className="num">{((Math.max(p.value, 0) / total) * 100).toFixed(1)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

function History() {
  return <ValueHistory initial="1M" />;
}

function PortfolioInner() {
  const toast = useToast();
  const highlight = useSearchParams().get("order");
  const { data, error, loading, refresh } = useApi<any>("/api/portfolio", { refreshMs: 15000 });
  const [tab, setTab] = useState<Tab>(highlight ? "orders" : "overview");
  const [cls, setCls] = useState<"all" | "stocks" | "crypto">("all");
  const [book, setBook] = useState<"paper" | "live">("paper");
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useRealtime((e) => { if (["fill", "order"].includes(e.type)) refresh(); });
  useEffect(() => { if (highlight) setTimeout(() => document.getElementById(`order-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 400); }, [highlight, data]);

  const positions = useMemo(() => (data?.positions ?? []).filter((p: any) => Number(p.quantity) > 0 && p.is_paper === (book === "paper")
    && (cls === "all" || (cls === "stocks" ? ["stock", "etf", "option"].includes(p.asset_class) : p.asset_class === "crypto"))), [data, cls, book]);

  if (loading && !data) return <div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><Skeleton className="h-40 lg:col-span-2" /><Skeleton className="h-40" /><Skeleton className="h-72 lg:col-span-3" /></div>;
  if (error) return <Empty title="Couldn't load portfolio">{error}</Empty>;
  const s = data[book];

  async function orderAction(id: string, action: "approve" | "cancel") {
    setBusy(id + action);
    try { const r = await api(`/api/orders/${id}`, { method: "POST", json: { action } }); toast(action === "approve" ? `Order ${r.order?.status ?? "approved"}` : "Order cancelled", "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function reset() {
    setBusy("reset");
    try { const r = await api("/api/portfolio/reset", { method: "POST", json: { confirm: confirmText } }); toast(`Paper portfolio reset to ${usd(r.cash)}`, "up"); setResetOpen(false); setConfirmText(""); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  const holdingsTable = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-xs text-faint"><tr className="border-b border-line">
          <th className="py-2 text-left font-medium">Asset</th><th className="text-left font-medium">Type</th><th className="text-right font-medium">Quantity</th><th className="text-right font-medium">Avg cost</th>
          <th className="text-right font-medium">Price</th><th className="text-right font-medium">Market value</th><th className="text-right font-medium">Unrealized P&L</th><th className="text-right font-medium">24h</th><th className="text-left pl-3 font-medium">Account</th>
        </tr></thead>
        <tbody>
          {positions.map((p: any) => {
            const upct = Number(p.avg_cost) ? ((Number(p.last_price) - Number(p.avg_cost)) / Number(p.avg_cost)) * 100 : null;
            return (
              <tr key={p.account_id + p.asset_id} className="border-b border-line/60 hover:bg-panel-2/50">
                <td className="py-2.5"><Link href={`/terminal/${p.asset_id}`} className="flex items-center gap-2.5"><AssetIcon symbol={p.symbol} logo={p.logo_url} /><span><span className="font-semibold">{p.symbol}</span><span className="block text-xs text-muted">{p.name}</span></span></Link></td>
                <td><Badge tone={p.asset_class === "crypto" ? "accent" : "up"}>{p.asset_class === "crypto" ? "Crypto" : "Stock"}</Badge></td>
                <td className="num text-right">{qty(p.quantity)}</td>
                <td className="num text-right">{price(p.avg_cost)}</td>
                <td className="num text-right">{price(p.last_price)} <SourceBadge source={p.price_source} /></td>
                <td className="num text-right">{usd(p.market_value)}</td>
                <td className={cx("num text-right", tone(p.unrealized_pnl))}>{usd(p.unrealized_pnl, { sign: true })}<span className="block text-xs">{pct(upct)}</span></td>
                <td className="text-right"><ChangeText value={p.change_24h} /></td>
                <td className="pl-3 text-xs text-muted">{p.account_label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!positions.length && <div className="py-6"><Empty icon={<Layers className="size-5" />} title={`No ${book} ${cls === "all" ? "" : cls} holdings`}>Place a trade from the terminal or the prompt bar.</Empty></div>}
    </div>
  );

  const perfTable = (rows: any[], keyName: string, label: string) => (
    <table className="w-full text-sm">
      <thead className="text-xs text-faint"><tr className="border-b border-line"><th className="py-2 text-left font-medium">{label}</th><th className="text-right font-medium">Trades</th><th className="text-right font-medium">Volume</th><th className="text-right font-medium">Realized P&L</th></tr></thead>
      <tbody>{rows.filter((r) => r.is_paper === (book === "paper")).map((r) => (
        <tr key={r[keyName] + String(r.is_paper)} className="border-b border-line/60"><td className="py-2 capitalize">{String(r[keyName]).replace(/_/g, " ")}</td><td className="num text-right">{r.trades}</td><td className="num text-right">{usd(r.volume, { compact: true })}</td><td className={cx("num text-right", tone(r.realized_pnl))}>{usd(r.realized_pnl, { sign: true })}</td></tr>
      ))}</tbody>
    </table>
  );

  return (
    <div className="space-y-4">
      <SectionTabs tabs={[{ href: "/portfolio", label: "Portfolio", icon: PieChart }, { href: "/wallet", label: "Wallet & funding", icon: Wallet }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h1 className="text-xl font-semibold">Portfolio</h1><PaperBadge paper={book === "paper"} /></div>
        <div className="flex flex-wrap gap-2">
          <Pills size="sm" value={book} onChange={setBook} options={[{ value: "paper", label: "Paper (simulated)" }, { value: "live", label: "Live accounts" }]} />
          {book === "paper" && <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}><RotateCcw className="size-4" /> Reset paper</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="My portfolio" icon={<Activity className="size-4 text-accent-2" />}>
          <div className="num text-3xl font-semibold tracking-tight">{usd(s.total)}</div>
          <div className={cx("num mt-1 text-sm", tone(s.lifetimePnl))}>{usd(s.lifetimePnl, { sign: true })} lifetime{s.starting ? ` (${pct((s.lifetimePnl / s.starting) * 100)})` : ""}</div>
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-5">
            <Stat label="Cash" value={usd(s.cash)} />
            <Stat label="Invested" value={usd(s.invested)} />
            <Stat label="Today's P&L (est.)" value={<span className={tone(s.dailyPnl)}>{usd(s.dailyPnl, { sign: true })}</span>} />
            <Stat label="Unrealized" value={<span className={tone(s.unrealized)}>{usd(s.unrealized, { sign: true })}</span>} />
            <Stat label="Realized" value={<span className={tone(s.realized)}>{usd(s.realized, { sign: true })}</span>} />
          </div>
          <div className="mt-4"><History /></div>
        </Card>
        <Card title="Asset allocation" icon={<PieIcon className="size-4 text-accent-2" />}>
          <Donut parts={[{ label: "Stocks", value: s.allocation.stocks, color: "var(--up)" }, { label: "Crypto", value: s.allocation.crypto, color: "var(--accent)" }, { label: "Cash", value: s.allocation.cash, color: "var(--muted)" }]} />
          <div className="mt-4 space-y-2 border-t border-line pt-3">
            <div className="text-xs font-medium text-muted">Accounts</div>
            {data.accounts.filter((a: any) => (a.kind === "paper" || a.environment === "sandbox") === (book === "paper")).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="flex min-w-0 items-center gap-2"><Wallet className="size-3.5 text-faint" /><span className="truncate">{a.label}</span><Badge>{a.provider_id}</Badge></span>
                <span className="num">{a.kind === "wallet" && !a.cash_balance ? <span className="text-xs text-faint">watch-only</span> : usd(a.cash_balance)}</span>
              </div>
            ))}
            {book === "live" && !data.accounts.some((a: any) => a.kind !== "paper" && a.environment !== "sandbox") && <p className="text-xs text-muted">No live accounts. <Link className="text-accent-2" href="/wallet">Connect a wallet or brokerage</Link>. Real-money trading stays disabled until approved.</p>}
          </div>
        </Card>
      </div>

      <Pills<Tab> value={tab} onChange={setTab} options={[
        { value: "overview", label: "Overview" }, { value: "holdings", label: "Holdings" }, { value: "transactions", label: "Transactions" },
        { value: "orders", label: `Open orders${data.openOrders.length ? ` (${data.openOrders.length})` : ""}` }, { value: "performance", label: "Performance" },
      ]} />

      {(tab === "overview" || tab === "holdings") && (
        <Card title="Holdings" icon={<Layers className="size-4 text-accent-2" />} action={<Pills size="sm" value={cls} onChange={setCls} options={[{ value: "all", label: "All" }, { value: "stocks", label: "Stocks" }, { value: "crypto", label: "Crypto" }]} />}>{holdingsTable}</Card>
      )}

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Active automated strategies" icon={<Bot className="size-4 text-accent-2" />} action={<Link href="/bots" className="text-xs text-accent-2">Manage →</Link>}>
            {data.bots.length ? data.bots.map((b: any) => (
              <Link key={b.id} href={`/bots/${b.id}`} className="flex items-center justify-between border-b border-line/60 py-2 text-sm last:border-0">
                <span className="min-w-0"><span className="font-medium">{b.name}</span><span className="block text-xs text-muted">{b.strategy_name}</span></span>
                <span className="flex items-center gap-2"><span className={cx("num", tone(b.pnl_usd))}>{usd(b.pnl_usd, { sign: true })}</span><StatusPill status={b.status} />{b.is_paper && <Badge tone="warn">Paper</Badge>}</span>
              </Link>
            )) : <Empty icon={<Bot className="size-5" />} title="No active bots" />}
          </Card>
          <Card title="Recent transactions" icon={<ArrowLeftRight className="size-4 text-accent-2" />} action={<button onClick={() => setTab("transactions")} className="text-xs text-accent-2">View all →</button>}>
            <TxTable rows={data.transactions.slice(0, 6)} />
          </Card>
        </div>
      )}

      {tab === "transactions" && <Card title="Transaction history" icon={<ArrowLeftRight className="size-4 text-accent-2" />}><TxTable rows={data.transactions} /></Card>}

      {tab === "orders" && (
        <Card title="Open positions & pending orders" icon={<ListChecks className="size-4 text-accent-2" />}>
          {data.openOrders.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-xs text-faint"><tr className="border-b border-line"><th className="py-2 text-left font-medium">Asset</th><th className="text-left font-medium">Side</th><th className="text-left font-medium">Type</th><th className="text-right font-medium">Size</th><th className="text-right font-medium">Limit / Stop</th><th className="text-left pl-3 font-medium">Status</th><th className="text-left font-medium">Source</th><th /></tr></thead>
                <tbody>{data.openOrders.map((o: any) => (
                  <tr key={o.id} id={`order-${o.id}`} className={cx("border-b border-line/60", highlight === o.id && "bg-accent-soft")}>
                    <td className="py-2.5 font-semibold">{o.symbol} <span className="text-xs font-normal text-muted">{o.venue}</span></td>
                    <td className={o.side === "buy" ? "text-up" : "text-down"}>{o.side.toUpperCase()}</td>
                    <td className="capitalize">{o.order_type.replace("_", " ")}</td>
                    <td className="num text-right">{o.quantity ? qty(o.quantity) : usd(o.notional_usd)}</td>
                    <td className="num text-right">{o.limit_price ? price(o.limit_price) : o.stop_price ? price(o.stop_price) : "—"}</td>
                    <td className="pl-3"><StatusPill status={o.status} />{o.status_reason && <span className="block max-w-56 truncate text-[11px] text-muted" title={o.status_reason}>{o.status_reason}</span>}</td>
                    <td className="text-xs capitalize text-muted">{o.source}{o.is_paper && " · paper"}</td>
                    <td className="space-x-1 text-right">
                      {o.status === "pending_approval" && !o.unsigned_tx && <Button size="sm" variant="primary" loading={busy === o.id + "approve"} onClick={() => orderAction(o.id, "approve")}>Approve</Button>}
                      <Button size="sm" variant="ghost" loading={busy === o.id + "cancel"} onClick={() => orderAction(o.id, "cancel")}>Cancel</Button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty icon={<ListChecks className="size-5" />} title="No open orders" />}
          <div className="mt-4 border-t border-line pt-3 text-xs font-medium text-muted">Open positions</div>
          {holdingsTable}
        </Card>
      )}

      {tab === "performance" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="By asset">{perfTable(data.performance.byAsset, "symbol", "Asset")}</Card>
          <Card title="By provider">{perfTable(data.performance.byProvider, "provider_id", "Provider")}</Card>
          <Card title="By trading method">{perfTable(data.performance.bySource, "source", "Method")}</Card>
          <p className="text-xs text-muted lg:col-span-3">{book === "paper" ? "Paper results are simulated and are never represented as live trades." : "Live figures come from provider-confirmed fills."}</p>
        </div>
      )}

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset paper portfolio">
        <p className="text-sm text-muted">This cancels open paper orders, stops paper bots, clears all paper positions and restores your virtual cash to the starting balance. Live accounts are not affected.</p>
        <Input className="mt-4" label='Type "RESET" to confirm' value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button><Button variant="danger" disabled={confirmText !== "RESET"} loading={busy === "reset"} onClick={reset}>Reset paper portfolio</Button></div>
      </Modal>
    </div>
  );
}

function TxTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty icon={<ArrowLeftRight className="size-5" />} title="No transactions yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-xs text-faint"><tr className="border-b border-line"><th className="py-2 text-left font-medium">Date</th><th className="text-left font-medium">Type</th><th className="text-left font-medium">Asset</th><th className="text-right font-medium">Amount</th><th className="text-right font-medium">USD</th><th className="text-left pl-3 font-medium">Account</th></tr></thead>
        <tbody>{rows.map((t) => {
          const kindLabel = t.kind === "trade" ? (Number(t.amount) >= 0 ? "BUY" : "SELL") : t.kind.toUpperCase();
          return (
            <tr key={t.id} className="border-b border-line/60">
              <td className="py-2 text-muted" title={new Date(t.created_at).toLocaleString()}>{ago(t.created_at)}</td>
              <td><Badge tone={kindLabel === "BUY" ? "up" : kindLabel === "SELL" ? "down" : "neutral"}>{kindLabel}</Badge>{t.receipt?.simulated && <Badge tone="warn" className="ml-1">sim</Badge>}</td>
              <td className="font-medium">{t.symbol ?? "—"}</td>
              <td className="num text-right">{t.symbol ? qty(Math.abs(Number(t.amount))) : usd(t.amount)}</td>
              <td className="num text-right">{t.amount_usd != null ? usd(Math.abs(Number(t.amount_usd))) : "—"}</td>
              <td className="pl-3 text-xs text-muted">{t.account_label}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export default function PortfolioPage() { return <Suspense><PortfolioInner /></Suspense>; }
