"use client";
import Link from "next/link";
import { useRef } from "react";
import { Gauge, Bot, Sparkles, Zap, ArrowRightLeft, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, Card, PaperBadge, StatusPill, cx } from "@/components/ui";
import { ago, price, qty, usd, tone } from "@/lib/format";

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return <div className="h-1.5 overflow-hidden rounded-full bg-panel-2"><div className={cx("h-full rounded-full bg-grad transition-[width] duration-700", className)} style={{ width: `${pct}%` }} /></div>;
}

/** Three-part bar: done / waiting / failed out of the total. */
function Split({ done, mid, failed, total }: { done: number; mid: number; failed: number; total: number }) {
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-2">
      <div className="bg-up transition-[width] duration-700" style={{ width: w(done) }} />
      <div className="bg-warn transition-[width] duration-700" style={{ width: w(mid) }} />
      <div className="bg-down transition-[width] duration-700" style={{ width: w(failed) }} />
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, children, href }: { icon: any; label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; href: string }) {
  return (
    <Link href={href} className="block rounded-xl border border-line bg-panel-2/50 p-3 transition-colors hover:border-line-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted"><Icon className="size-3.5 text-accent-2" /> {label}</div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="mb-2 text-[11px] text-faint">{sub}</div>}
      {children}
    </Link>
  );
}

const statusIcon = (s: string) =>
  ["filled", "executed", "info", "approved"].includes(s) ? <CheckCircle2 className="size-3.5 shrink-0 text-up" />
  : ["rejected", "failed", "cancelled", "dismissed", "error"].includes(s) ? <XCircle className="size-3.5 shrink-0 text-down" />
  : <Clock className="size-3.5 shrink-0 text-warn" />;

/**
 * Live progress of the signed-in user's own bots, prompts, shortcut buttons and trades.
 * Refreshes on realtime events (throttled) with a polling fallback.
 */
export function ProgressPanel({ compact = false }: { compact?: boolean }) {
  const { connected } = useShell();
  const { data, refresh } = useApi<any>("/api/progress", { refreshMs: connected ? 20000 : 8000 });
  const last = useRef(0);
  useRealtime((e) => {
    if (!["fill", "order", "bot_log", "bot_status", "training"].includes(e.type)) return;
    const now = Date.now();
    if (now - last.current > 1500) { last.current = now; refresh(); }
  });

  const t = data?.today;
  const tr = t?.trades ?? {}, pr = t?.prompts ?? {}, sc = t?.shortcuts ?? {};
  const bots: any[] = data?.bots ?? [];
  const running = bots.filter((b) => b.status === "running").length;
  const decided = (tr.wins ?? 0) + (tr.losses ?? 0);

  const tiles = (
    <div className={cx("grid gap-3", compact ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 xl:grid-cols-4")}>
      <Tile icon={ArrowRightLeft} label="Trades" href="/portfolio" value={tr.filled ?? 0}
        sub={<>{tr.buys ?? 0} buys · {tr.sells ?? 0} sells · <span className={tone(tr.pnl)}>{usd(tr.pnl ?? 0, { sign: true })}</span></>}>
        <Bar value={tr.wins ?? 0} max={decided} className="bg-up" />
        <div className="mt-1 text-[10px] text-faint">{decided ? `${Math.round(((tr.wins ?? 0) / decided) * 100)}% winning sells` : "no closed trades yet"}</div>
      </Tile>
      <Tile icon={Bot} label="Bots" href="/bots" value={<>{running}<span className="text-xs font-normal text-faint"> / {bots.length} running</span></>}
        sub={<>{bots.reduce((n, b) => n + (b.trades_today ?? 0), 0)} trades today</>}>
        <Bar value={running} max={bots.length} />
      </Tile>
      <Tile icon={Sparkles} label="Prompts" href="/ai" value={pr.total ?? 0} sub={<>{pr.done ?? 0} done · {pr.waiting ?? 0} waiting · {pr.failed ?? 0} declined</>}>
        <Split done={pr.done ?? 0} mid={pr.waiting ?? 0} failed={pr.failed ?? 0} total={pr.total ?? 0} />
      </Tile>
      <Tile icon={Zap} label="Shortcuts" href="/shortcuts" value={sc.total ?? 0} sub={<>{sc.done ?? 0} done · {sc.partial ?? 0} partial · {sc.failed ?? 0} failed</>}>
        <Split done={sc.done ?? 0} mid={sc.partial ?? 0} failed={sc.failed ?? 0} total={sc.total ?? 0} />
      </Tile>
    </div>
  );

  const header = (
    <span className="flex items-center gap-2">Progress <span className="text-[11px] font-normal text-faint">last 24h</span>
      <span className={cx("flex items-center gap-1 text-[11px] font-normal", connected ? "text-up" : "text-faint")}><span className={cx("size-1.5 rounded-full", connected ? "bg-up pulse-dot" : "bg-faint")} />{connected ? "live" : "refreshing"}</span>
    </span>
  );

  if (compact) {
    return (
      <Card title={header} icon={<Gauge className="size-4 text-accent-2" />} action={<Link href="/progress" className="text-xs text-accent-2">Details</Link>}>
        {tiles}
        {(data?.openOrders ?? []).length > 0 && (
          <div className="mt-3 text-xs text-muted"><span className="text-warn">{data.openOrders.length} order{data.openOrders.length > 1 ? "s" : ""} in progress</span> — <Link href="/progress" className="text-accent-2">view</Link></div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title={header} icon={<Gauge className="size-4 text-accent-2" />}>{tiles}</Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Bots" icon={<Bot className="size-4 text-accent-2" />} action={<Link href="/bots" className="text-xs text-accent-2">All bots</Link>}>
          {bots.length === 0 ? <div className="text-xs text-muted">No bots yet. <Link href="/bots" className="text-accent-2">Create one</Link>.</div> : (
            <ul className="space-y-3">
              {bots.map((b) => (
                <li key={b.id}>
                  <Link href={`/bots/${b.id}`} className="block">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium">{b.name}</span><PaperBadge paper={b.paper} /></span>
                      <span className="flex shrink-0 items-center gap-2"><span className={cx("num text-xs", tone(b.pnl_usd))}>{usd(b.pnl_usd, { sign: true })}</span><StatusPill status={b.status} /></span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-3 text-[10px] text-faint">
                      <div><div className="mb-0.5 flex justify-between"><span>Trades today</span><span className="num">{b.trades_today}/{b.max_trades_per_day}</span></div><Bar value={b.trades_today} max={b.max_trades_per_day} /></div>
                      <div><div className="mb-0.5 flex justify-between"><span>Daily spend</span><span className="num">{usd(b.spent_today_usd, { compact: true })}/{usd(b.max_daily_spend_usd, { compact: true })}</span></div><Bar value={+b.spent_today_usd} max={+b.max_daily_spend_usd} /></div>
                    </div>
                    {b.last_message && <div className="mt-1 truncate text-[11px] text-muted">{b.last_message} <span className="text-faint">· {ago(b.last_tick_at)}</span></div>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Trades in progress" icon={<ArrowRightLeft className="size-4 text-accent-2" />}>
          {(data?.openOrders ?? []).length === 0 ? <div className="text-xs text-muted">Nothing waiting. Every order has finished.</div> : (
            <ul className="space-y-2.5">
              {data.openOrders.map((o: any) => {
                const target = o.quantity ? +o.quantity : 0;
                return (
                  <li key={o.id}>
                    <Link href={`/terminal/${o.asset_id}`} className="block">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5"><span className={cx("font-semibold", o.side === "buy" ? "text-up" : "text-down")}>{o.side.toUpperCase()}</span> {o.symbol} <span className="text-faint">{o.order_type}{o.limit_price ? ` @ ${price(o.limit_price)}` : ""} · via {o.source}</span></span>
                        <Badge tone="warn">{o.status.replace(/_/g, " ")}</Badge>
                      </div>
                      <div className="mt-1"><Bar value={+o.filled_quantity} max={target || 1} /></div>
                      <div className="mt-0.5 text-[10px] text-faint">{target ? `${qty(o.filled_quantity)} of ${qty(target)} filled` : o.notional_usd ? `${usd(o.notional_usd)} order` : ""} · {ago(o.created_at)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Latest trades</div>
          <ul className="mt-2 divide-y divide-line">
            {(data?.recent?.orders ?? []).map((o: any) => (
              <li key={o.id} className="flex items-center gap-2 py-1.5 text-xs">
                {statusIcon(o.status)}
                <span className="min-w-0 flex-1 truncate"><span className={o.side === "buy" ? "text-up" : "text-down"}>{o.side.toUpperCase()}</span> {o.symbol} {+o.filled_quantity > 0 && <span className="text-faint">{qty(o.filled_quantity)} @ {price(o.avg_fill_price)}</span>}</span>
                {o.side === "sell" && o.status === "filled" && <span className={cx("num", tone(o.realized_pnl))}>{usd(o.realized_pnl, { sign: true })}</span>}
                <span className="text-faint">{ago(o.updated_at)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Prompts" icon={<Sparkles className="size-4 text-accent-2" />} action={<Link href="/ai" className="text-xs text-accent-2">Open AI Trade</Link>}>
          {(data?.recent?.prompts ?? []).length === 0 ? <div className="text-xs text-muted">No prompts yet. Type one in the box at the bottom.</div> : (
            <ul className="divide-y divide-line">
              {data.recent.prompts.map((p: any) => (
                <li key={p.id}><Link href={`/ai?c=${p.conversation_id}`} className="flex items-start gap-2 py-1.5 text-xs">
                  <span className="mt-px">{statusIcon(p.status)}</span>
                  <span className="min-w-0 flex-1"><span className="line-clamp-2">{p.content}</span></span>
                  <span className="shrink-0 text-faint">{p.status.replace(/_/g, " ")} · {ago(p.created_at)}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Shortcut buttons" icon={<Zap className="size-4 text-accent-2" />} action={<Link href="/shortcuts" className="text-xs text-accent-2">Manage</Link>}>
          {(data?.recent?.shortcuts ?? []).length === 0 ? <div className="text-xs text-muted">No shortcut runs yet.</div> : (
            <ul className="divide-y divide-line">
              {data.recent.shortcuts.map((s: any) => (
                <li key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
                  {statusIcon(s.status)}
                  <span className="min-w-0 flex-1 truncate font-medium" style={s.color ? { color: s.color } : undefined}>{s.name}</span>
                  <span className="text-faint">{s.status} · {ago(s.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
