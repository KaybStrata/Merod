"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { TrendingUp, Flame, Rocket, Star, History, Bot, Sparkles, Users, PieChart, ArrowRight, AlertTriangle, Wallet } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Card, Badge, Pills, Sparkline, Skeleton, Empty, ChangeText, AssetIcon, StatusPill, SourceBadge, PaperBadge, cx } from "@/components/ui";
import { usd, price, pct, qty, ago, compact, tone } from "@/lib/format";
import { ShortcutBar } from "@/components/ShortcutBar";
import { LiveSuggestions } from "@/components/LiveSuggestions";

const ValueChart = dynamic(() => import("@/components/terminal/charts").then((m) => m.ValueChart), { ssr: false, loading: () => <Skeleton className="h-[180px]" /> });

export default function Dashboard() {
  const { user, openPrompt } = useShell();
  const d = useApi<any>("/api/dashboard", { refreshMs: 15000 });
  const [range, setRange] = useState<"1D" | "1W" | "1M" | "3M" | "1Y">("1M");
  const hist = useApi<any>(`/api/portfolio/history?range=${range}`);
  const [trendClass, setTrendClass] = useState<"stocks" | "crypto">("crypto");
  const trending = useApi<any>(`/api/assets?class=${trendClass}&sort=gainers&limit=6`, { refreshMs: 20000 });
  const movers = useApi<any>("/api/assets?sort=volume&limit=6", { refreshMs: 20000 });
  const launches = useApi<any>("/api/assets?new=1&sort=new&limit=6", { refreshMs: 30000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") d.refresh(); }, undefined);

  const s = d.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {user.displayName.split(" ")[0]}</h1>
          <p className="text-sm text-muted">Your unified overview across stocks and crypto.</p>
        </div>
        {s?.pendingApprovals > 0 && (
          <Link href="/portfolio?tab=orders" className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
            <AlertTriangle className="size-4" /> {s.pendingApprovals} order{s.pendingApprovals > 1 ? "s" : ""} awaiting your approval
          </Link>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8" pad={false}>
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted">Total portfolio value <PaperBadge /></div>
              {s ? <div className="num mt-1 text-4xl font-semibold tracking-tight">{usd(s.total)}</div> : <Skeleton className="mt-2 h-10 w-56" />}
              {s && <div className={cx("num mt-1 text-sm", tone(s.dayChange))}>{usd(s.dayChange, { sign: true })} ({pct(s.dayChangePct)}) today</div>}
            </div>
            <Pills size="sm" value={range} onChange={setRange} options={(["1D", "1W", "1M", "3M", "1Y"] as const).map((v) => ({ value: v, label: v }))} />
          </div>
          <div className="px-2">{hist.data ? <ValueChart points={hist.data.points} /> : <Skeleton className="mx-3 h-[180px]" />}</div>
          {hist.data?.estimated && <p className="px-5 text-[11px] text-faint">Chart estimated from current holdings × historical prices until enough snapshots are recorded.</p>}
          <div className="grid grid-cols-2 gap-4 border-t border-line px-5 py-4 sm:grid-cols-4">
            <Mini label="Cash (virtual)" value={usd(s?.cash)} />
            <Mini label="Invested" value={usd(s?.invested)} />
            <Mini label="Unrealized P&L" value={usd(s?.unrealized, { sign: true })} cls={tone(s?.unrealized)} />
            <Mini label="Lifetime P&L" value={`${usd(s?.lifetimePnl, { sign: true })} (${pct(s?.lifetimePct)})`} cls={tone(s?.lifetimePnl)} />
          </div>
        </Card>

        <Card className="xl:col-span-4" title="Allocation" icon={<PieChart className="size-4 text-accent-2" />}>
          {s ? <Allocation a={s.allocation} total={s.total} /> : <Skeleton className="h-40" />}
        </Card>
      </div>

      <Card title="Shortcuts" icon={<Sparkles className="size-4 text-accent-2" />} action={<Link href="/shortcuts" className="text-xs text-accent-2 hover:underline">Manage</Link>}>
        <ShortcutBar placement="dashboard" />
        <div className="mt-4"><LiveSuggestions title="Suggested for you right now" /></div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Holdings" icon={<Wallet className="size-4 text-accent-2" />} action={<Link href="/portfolio" className="flex items-center gap-1 text-xs text-accent-2 hover:underline">View all <ArrowRight className="size-3" /></Link>}>
          {!s ? <Skeleton className="h-40" /> : s.holdings.length === 0 ? (
            <Empty title="No positions yet" action={<button onClick={() => openPrompt("Buy $100 of SOL")} className="text-xs text-accent-2 hover:underline">Try “Buy $100 of SOL”</button>}>Place a paper trade from the terminal, a shortcut, or the prompt bar.</Empty>
          ) : (
            <div className="space-y-1">
              {s.holdings.slice(0, 6).map((h: any) => (
                <Link key={h.asset_id} href={`/terminal/${h.asset_id}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-panel-2">
                  <AssetIcon symbol={h.symbol} logo={h.logo_url} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{h.symbol}</div><div className="num text-xs text-muted">{qty(h.quantity)} @ {price(h.avg_cost)}</div></div>
                  <Sparkline data={(h.spark ?? []).map(Number)} width={64} height={24} />
                  <div className="text-right"><div className="num text-sm">{usd(h.value)}</div><div className={cx("num text-xs", tone(h.unrealized))}>{usd(h.unrealized, { sign: true })}</div></div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Trending" icon={<TrendingUp className="size-4 text-up" />} action={<Pills size="sm" value={trendClass} onChange={setTrendClass} options={[{ value: "crypto", label: "Crypto" }, { value: "stocks", label: "Stocks" }]} />}>
          <AssetRows rows={trending.data?.assets} />
        </Card>

        <Card title="Market movers" icon={<Flame className="size-4 text-warn" />} action={<Link href="/discover?tab=volume" className="text-xs text-accent-2 hover:underline">Discover</Link>}>
          <AssetRows rows={movers.data?.assets} showVolume />
        </Card>

        <Card title="New launches" icon={<Rocket className="size-4 text-accent-2" />} action={<Link href="/discover?tab=new" className="text-xs text-accent-2 hover:underline">All new tokens</Link>}>
          {!launches.data ? <Skeleton className="h-40" /> : launches.data.assets.length === 0 ? (
            <Empty title="No launch data">Connect Helius and DEX Screener in the Integration Center to stream newly launched tokens.</Empty>
          ) : (
            <div className="space-y-1">
              {launches.data.assets.map((a: any) => (
                <Link key={a.id} href={`/terminal/${a.id}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-panel-2">
                  <AssetIcon symbol={a.symbol} logo={a.logo_url} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">{a.symbol}{a.risk_flags?.includes("demo_data") && <Badge tone="warn">DEMO</Badge>}{a.lifecycle === "bonding_curve" && <Badge tone="accent">Curve</Badge>}</div>
                    <div className="text-xs text-muted">{a.venue} · liq {usd(a.liquidity_usd, { compact: true })} · {ago(a.launched_at)}</div>
                  </div>
                  <div className="text-right"><div className="num text-sm">{price(a.last_price)}</div><ChangeText value={a.change_24h} className="text-xs" /></div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Watchlist" icon={<Star className="size-4 text-warn" />} action={<Link href="/discover" className="text-xs text-accent-2 hover:underline">Add assets</Link>}>
          {!s ? <Skeleton className="h-40" /> : s.watchlist.length === 0 ? <Empty title="Watchlist is empty">Star assets in Discover or the terminal.</Empty> : (
            <div className="space-y-1">
              {s.watchlist.map((w: any) => (
                <Link key={w.id} href={`/terminal/${w.id}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-panel-2">
                  <AssetIcon symbol={w.symbol} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{w.symbol}</div><div className="truncate text-xs text-muted">{w.name}</div></div>
                  <Sparkline data={(w.spark ?? []).map(Number)} width={64} height={24} />
                  <div className="text-right"><div className="num text-sm">{price(w.last_price)}</div><ChangeText value={w.change_24h} className="text-xs" /></div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent trades" icon={<History className="size-4 text-accent-2" />} action={<Link href="/portfolio?tab=history" className="text-xs text-accent-2 hover:underline">History</Link>}>
          {!s ? <Skeleton className="h-40" /> : s.recentOrders.length === 0 ? <Empty title="No trades yet" /> : (
            <div className="space-y-1.5">
              {s.recentOrders.map((o: any) => (
                <Link key={o.id} href={`/terminal/${o.asset_id}`} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-panel-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge tone={o.side === "buy" ? "up" : "down"}>{o.side.toUpperCase()}</Badge>
                    <span className="font-semibold">{o.symbol}</span>
                    <span className="truncate text-xs text-faint">{o.source}</span>
                  </span>
                  <span className="flex items-center gap-2"><span className="num text-xs text-muted">{o.filled_quantity > 0 ? `${qty(o.filled_quantity)} @ ${price(o.avg_fill_price)}` : usd(o.notional_usd)}</span><StatusPill status={o.status} /></span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Active bots" icon={<Bot className="size-4 text-accent-2" />} action={<Link href="/bots" className="text-xs text-accent-2 hover:underline">Agents & Bots</Link>}>
          {!s ? <Skeleton className="h-32" /> : s.bots.length === 0 ? (
            <Empty title="No active bots" action={<button onClick={() => openPrompt("Buy at a 3% dip and sell at 5% increase, then rinse and repeat")} className="text-xs text-accent-2 hover:underline">Create one with a prompt</button>} />
          ) : (
            <div className="space-y-1.5">
              {s.bots.map((b: any) => (
                <Link key={b.id} href={`/bots/${b.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 hover:bg-panel-2">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold">{b.name}</span><span className="text-xs text-muted">{b.trades_today} trades today · tick {ago(b.last_tick_at)}</span></span>
                  <span className="flex items-center gap-2"><span className={cx("num text-sm", tone(b.pnl_usd))}>{usd(b.pnl_usd, { sign: true })}</span><StatusPill status={b.status} /></span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <AISummary s={s} trending={movers.data?.assets} onAsk={openPrompt} />

        <Card title="Social activity" icon={<Users className="size-4 text-accent-2" />} action={<Link href="/social" className="text-xs text-accent-2 hover:underline">Feed</Link>}>
          {!s ? <Skeleton className="h-32" /> : s.posts.length === 0 ? <Empty title="No public posts yet">Share a trade from your portfolio or follow traders in Social.</Empty> : (
            <div className="space-y-2.5">
              {s.posts.map((p: any) => (
                <Link key={p.id} href={`/social/${p.handle}`} className="block rounded-lg px-1.5 py-1 hover:bg-panel-2">
                  <div className="flex items-center gap-2 text-xs"><span className="font-semibold text-text">@{p.handle}</span><span className="text-faint">{ago(p.created_at)}</span>
                    {p.verification === "verified_live" ? <Badge tone="up">Verified</Badge> : p.verification === "simulated" ? <Badge tone="warn">Simulated</Badge> : <Badge>{p.kind}</Badge>}</div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.body}</p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Mini({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return <div className="min-w-0"><div className="text-xs text-muted">{label}</div><div className={cx("num mt-0.5 truncate text-sm font-semibold", cls)}>{value}</div></div>;
}

function Allocation({ a, total }: { a: { stocks: number; crypto: number; cash: number }; total: number }) {
  const parts = [{ k: "Stocks", v: a.stocks, c: "var(--up)" }, { k: "Crypto", v: a.crypto, c: "var(--accent)" }, { k: "Cash", v: a.cash, c: "var(--line-2)" }];
  let acc = 0;
  const R = 54, C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-5">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0 -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--panel-2)" strokeWidth="16" />
        {parts.map((p) => { const frac = total ? p.v / total : 0; const el = <circle key={p.k} cx="70" cy="70" r={R} fill="none" stroke={p.c} strokeWidth="16" strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} />; acc += frac; return el; })}
      </svg>
      <div className="flex-1 space-y-2.5">
        {parts.map((p) => (
          <div key={p.k} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: p.c }} />{p.k}</span>
            <span className="num text-muted">{total ? ((p.v / total) * 100).toFixed(1) : "0.0"}%</span>
          </div>
        ))}
        <div className="num border-t border-line pt-2 text-xs text-faint">{usd(total)} total</div>
      </div>
    </div>
  );
}

function AssetRows({ rows, showVolume }: { rows?: any[]; showVolume?: boolean }) {
  if (!rows) return <Skeleton className="h-40" />;
  if (!rows.length) return <Empty title="No assets" />;
  return (
    <div className="space-y-1">
      {rows.map((a, i) => (
        <Link key={a.id} href={`/terminal/${a.id}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-panel-2">
          <span className="w-4 text-xs text-faint">{i + 1}</span>
          <AssetIcon symbol={a.symbol} logo={a.logo_url} size={26} />
          <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-sm font-semibold">{a.symbol}{a.price_source === "simulated" && <span className="size-1.5 rounded-full bg-warn" title="Simulated price" />}</div><div className="truncate text-xs text-muted">{showVolume ? `Vol ${compact(a.volume_24h)}` : a.name}</div></div>
          <Sparkline data={(a.spark ?? []).map(Number)} width={60} height={22} />
          <div className="w-24 text-right"><div className="num text-sm">{price(a.last_price)}</div><ChangeText value={a.change_24h} className="text-xs" /></div>
        </Link>
      ))}
    </div>
  );
}

function AISummary({ s, trending, onAsk }: { s: any; trending?: any[]; onAsk: (t?: string) => void }) {
  const lines: string[] = [];
  if (s) {
    lines.push(`Your paper portfolio is ${s.dayChange >= 0 ? "up" : "down"} ${usd(Math.abs(s.dayChange))} (${pct(s.dayChangePct)}) today across ${s.holdings.length} position${s.holdings.length === 1 ? "" : "s"}.`);
    const best = [...s.holdings].sort((a: any, b: any) => (b.change_24h ?? 0) - (a.change_24h ?? 0))[0];
    if (best) lines.push(`Best performer today: ${best.symbol} (${pct(best.change_24h)}).`);
    if (s.bots.length) lines.push(`${s.bots.filter((b: any) => b.status === "running").length} bot(s) running; bot P&L ${usd(s.bots.reduce((a: number, b: any) => a + Number(b.pnl_usd), 0), { sign: true })}.`);
  }
  if (trending?.length) lines.push(`Highest volume: ${trending.slice(0, 3).map((a) => `${a.symbol} ${pct(a.change_24h)}`).join(", ")}.`);
  const simulated = trending?.some((a) => a.price_source === "simulated");
  return (
    <Card title="Market summary" icon={<Sparkles className="size-4 text-accent-2" />} action={<button onClick={() => onAsk("Summarize today's market and my portfolio")} className="text-xs text-accent-2 hover:underline">Ask AI</button>}>
      {!s ? <Skeleton className="h-28" /> : (
        <div className="space-y-2 text-sm text-muted">
          {lines.map((l) => <p key={l}>{l}</p>)}
          {simulated && <div className="flex items-center gap-2 pt-1 text-[11px] text-faint"><SourceBadge source="simulated" /> Some prices come from the simulated feed until market-data providers are connected.</div>}
        </div>
      )}
    </Card>
  );
}
