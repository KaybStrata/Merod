"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Sparkles, ArrowUp, ArrowRight, Bot, Star, AlertTriangle, ChevronDown, LayoutDashboard, Plus } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime, useShell, usePageTitle } from "@/components/shell/context";
import { AssetIcon, Sparkline, cx } from "@/components/ui";
import { usd, price, pct, qty, tone, ago } from "@/lib/format";
import { EquityChart, RangePills, rangeSeconds, toPoints } from "@/components/analytics/charts";
import { AgentAvatar, StatusDot } from "@/components/agents/common";
import { WalletFundsPanel } from "@/components/wallet/WalletFundsPanel";
import HomeDashboard from "@/components/HomeDashboard";

const CHIPS = ["Buy $500 of NVDA", "Alert me if SOL drops 5%", "Summarize my portfolio risk", "Mimic the top 10 Solana gainers this week"];
const MEME = (h: any) => (h.categories ?? []).some((c: string) => /meme/i.test(c)) || (h.asset_class === "crypto" && h.venue === "solana" && !["SOL", "USDC", "USDT", "JUP"].includes(h.symbol));

function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }

/** Home (screen 01): equity hero + chart, Ask Merod bar, holdings; right column with active agents, watchlist and recent fills. */
export function HomeView() {
  usePageTitle(null);
  const { user } = useShell();
  const d = useApi<any>("/api/dashboard", { refreshMs: 15_000 });
  const [rng, setRng] = useState("1M");
  const hist = useApi<any>(`/api/portfolio/history?seconds=${rangeSeconds(rng)}`, { refreshMs: rng === "1D" ? 30_000 : 120_000 });
  const agents = useApi<any>("/api/agents", { refreshMs: 30_000 });
  const bots = useApi<any>("/api/bots", { refreshMs: 30_000 });
  const movers = useApi<any>("/api/assets?sort=gainers&limit=14", { refreshMs: 30_000 });
  useRealtime((e) => { if (e.type === "fill" || e.type === "order") d.refresh(); });
  const s = d.data;
  const pts = toPoints(hist.data?.points);
  const winChange = pts.length > 1 ? pts[pts.length - 1].value - pts[0].value : null;
  const winPct = winChange != null && pts[0].value ? (winChange / pts[0].value) * 100 : null;
  const [text, setText] = useState("");
  const send = (t = text) => { if (!t.trim()) return; window.dispatchEvent(new CustomEvent("merod-prompt", { detail: t })); setText(""); };
  const [hTab, setHTab] = useState<"all" | "stocks" | "crypto" | "meme">("all");
  const holdings = useMemo(() => (s?.holdings ?? []).filter((h: any) => hTab === "all" || (hTab === "stocks" ? h.asset_class !== "crypto" : hTab === "crypto" ? h.asset_class === "crypto" && !MEME(h) : MEME(h))), [s, hTab]);
  const [board, setBoard] = useState(false);
  const live = [...(agents.data?.agents ?? []).map((a: any) => ({ kind: "agent", id: a.id, href: `/agents/${a.id}`, name: a.name, sub: a.roleName ?? a.role, status: a.status, pnl: a.metrics?.pnl ?? null, agent: a })),
    ...(bots.data?.bots ?? []).map((b: any) => ({ kind: "bot", id: b.id, href: `/bots/${b.id}`, name: b.name, sub: `${b.strategy_name ?? "Bot"}${b.symbols?.length ? ` · ${b.symbols.slice(0, 3).join(", ")}${b.symbols.length > 3 ? "…" : ""}` : ""}`, status: b.status, pnl: Number(b.pnl_usd ?? 0), agent: null }))]
    .sort((a, b) => Number(b.status === "running") - Number(a.status === "running"));
  const running = live.filter((l) => l.status === "running").length;
  const tape = movers.data?.assets ?? [];

  return (
    <div className="space-y-3">
      {tape.length > 0 && (
        <div className="flex items-center gap-4 overflow-hidden rounded-lg border border-line bg-panel/50 px-3 py-1.5 text-[11.5px]">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Top movers</span>
          <div className="flex min-w-0 gap-5 overflow-x-auto [scrollbar-width:none]">
            {tape.map((a: any) => <Link key={a.id} href={`/terminal/${a.id}`} className="flex shrink-0 items-center gap-1.5 hover:text-text"><span className="font-semibold">{a.symbol}</span><span className="num text-muted">{price(a.last_price)}</span><span className={cx("num", tone(a.change_24h))}>{pct(a.change_24h)}</span></Link>)}
          </div>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <section className="surface rounded-xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] text-faint">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
                <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight">{greeting()}, <span className="serif-accent text-[26px] text-accent-2">{user.displayName.split(" ")[0]}</span></h1>
                <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Total {user.tradingMode === "live" ? "" : "paper "}equity</div>
                {s ? <div className="num mt-0.5 text-[34px] font-semibold leading-none tracking-tight">{usd(s.total)}</div> : <div className="mt-1 h-9 w-56 animate-pulse rounded bg-panel-2" />}
                {s && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={cx("num rounded-md px-1.5 py-0.5", (winChange ?? s.dayChange) >= 0 ? "bg-up-soft text-up" : "bg-down-soft text-down")}>{usd(winChange ?? s.dayChange, { sign: true })} ({pct(winChange != null ? winPct : s.dayChangePct)})</span>
                  <span className="text-faint">{winChange != null ? `past ${rng}` : "today"}</span>
                </div>}
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="grid grid-cols-3 gap-5 text-right">
                  {[["Buying power", usd(s?.cash), ""], ["Invested", usd(s?.invested), ""], ["Return · all", pct(s?.lifetimePct), tone(s?.lifetimePct)]].map(([k, v, c]) => (
                    <div key={k}><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{k}</div><div className={cx("num mt-0.5 text-[14px] font-semibold", c)}>{s ? v : "—"}</div></div>
                  ))}
                </div>
                <RangePills value={rng} onChange={setRng} />
              </div>
            </div>
            <EquityChart points={pts} height={210} className="mt-3" />
            {hist.data?.estimated && <p className="mt-1 text-[10.5px] text-faint">Estimated from current holdings × past prices until enough history is recorded.</p>}
          </section>

          <section className="rounded-xl border border-accent/35 bg-panel/80 p-2.5 shadow-[0_0_30px_-14px_rgba(214,179,122,0.5)]">
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2">
              <Sparkles className="ml-1 size-4 shrink-0 text-accent-2" />
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={8000} placeholder="Ask Merod to trade, research or automate anything…" className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
              <kbd className="hidden rounded border border-line-2 px-1 text-[10px] text-faint sm:block">↵</kbd>
              <button disabled={!text.trim()} className="flex size-8 items-center justify-center rounded-lg bg-grad text-bg disabled:opacity-50" aria-label="Send"><ArrowUp className="size-4" /></button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5 px-1">{CHIPS.map((c) => <button key={c} onClick={() => send(c)} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-text">{c}</button>)}</div>
          </section>

          {s?.pendingApprovals > 0 && (
            <Link href="/portfolio?tab=orders" className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn"><AlertTriangle className="size-4" /> {s.pendingApprovals} order{s.pendingApprovals > 1 ? "s" : ""} awaiting your approval <ArrowRight className="ml-auto size-3.5" /></Link>
          )}

          <section className="surface overflow-hidden rounded-xl">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Holdings</h2>
              <span className="text-[11px] text-faint">{(s?.holdings ?? []).length} positions · {user.tradingMode === "live" ? "live" : "paper"}</span>
              <div className="ml-auto flex gap-0.5 rounded-lg border border-line bg-bg-2/60 p-0.5">
                {(["all", "stocks", "crypto", "meme"] as const).map((k) => <button key={k} onClick={() => setHTab(k)} className={cx("rounded-md px-2 py-0.5 text-[11px] capitalize", hTab === k ? "bg-panel-2 text-text" : "text-faint hover:text-text")}>{k}</button>)}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12.5px]">
                <thead className="text-left text-[10px] uppercase tracking-[0.1em] text-faint"><tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Asset</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Price</th><th className="text-right font-medium">24h</th><th className="text-right font-medium">Value</th><th className="text-right font-medium">Unrealized</th><th className="px-4 font-medium">Allocation</th>
                </tr></thead>
                <tbody>
                  {holdings.map((h: any) => {
                    const alloc = s?.total ? (h.value / s.total) * 100 : 0;
                    return (
                      <tr key={h.asset_id} className="border-b border-line/50 last:border-0 hover:bg-panel-2/50">
                        <td className="px-4 py-2"><Link href={`/terminal/${h.asset_id}`} className="flex items-center gap-2"><AssetIcon symbol={h.symbol} logo={h.logo_url} size={22} /><span><span className="font-semibold">{h.symbol}</span> <span className="text-[11px] text-faint">{h.name}</span></span></Link></td>
                        <td className="num text-right">{qty(h.quantity)}</td>
                        <td className="num text-right">{price(h.last_price)}</td>
                        <td className={cx("num text-right", tone(h.change_24h))}>{pct(h.change_24h)}</td>
                        <td className="num text-right">{usd(h.value)}</td>
                        <td className={cx("num text-right", tone(h.unrealized))}>{usd(h.unrealized, { sign: true })}</td>
                        <td className="px-4"><div className="flex items-center gap-2"><span className="h-1 w-20 overflow-hidden rounded-full bg-panel-2"><span className="block h-full rounded-full bg-accent-2" style={{ width: `${Math.min(alloc, 100)}%` }} /></span><span className="num w-10 text-[11px] text-muted">{alloc.toFixed(1)}%</span></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {s && !holdings.length && <p className="px-4 py-6 text-center text-[12px] text-muted">No {hTab === "all" ? "" : hTab + " "}holdings yet. Ask Merod above or open <Link href="/trade" className="text-accent-2 hover:underline">Trade</Link>.</p>}
            </div>
          </section>

          <WalletFundsPanel />
        </div>

        <aside className="min-w-0 space-y-3">
          <section className="surface rounded-xl">
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <h2 className="text-[13px] font-semibold">Active agents</h2>
              <span className="flex items-center gap-1.5 text-[11px] text-muted"><span className={cx("size-1.5 rounded-full", running ? "bg-up pulse-dot" : "bg-faint")} />{running} live</span>
            </div>
            <ul className="max-h-[300px] overflow-y-auto">
              {live.slice(0, 8).map((l) => (
                <li key={l.kind + l.id}><Link href={l.href} className="flex items-center gap-2.5 border-b border-line/50 px-3.5 py-2 last:border-0 hover:bg-panel-2/50">
                  {l.agent ? <AgentAvatar agent={l.agent} size={26} /> : <span className="flex size-[26px] items-center justify-center rounded-full border border-line-2 bg-panel-2"><Bot className="size-3.5 text-accent-2" /></span>}
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-[12.5px] font-medium"><span className="truncate">{l.name}</span><StatusDot status={l.status} /></span><span className="block truncate text-[11px] text-faint">{l.sub}</span></span>
                  <span className={cx("num text-[12px] font-semibold", tone(l.pnl))}>{l.pnl == null ? "—" : usd(l.pnl, { sign: true })}</span>
                </Link></li>
              ))}
              {(agents.data || bots.data) && !live.length && <li className="px-3.5 py-5 text-center text-[12px] text-muted">No agents or bots yet.<br /><Link href="/agents" className="text-accent-2 hover:underline">Create an agent</Link></li>}
            </ul>
            <Link href="/agents" className="flex items-center justify-center gap-1 border-t border-line py-2 text-[11.5px] text-muted hover:text-text"><Plus className="size-3.5" /> New agent</Link>
          </section>

          <section className="surface rounded-xl">
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5"><h2 className="text-[13px] font-semibold">Watchlist</h2><Link href="/discover?tab=watchlist" className="text-[11px] text-muted hover:text-text">Edit</Link></div>
            <ul>
              {(s?.watchlist ?? []).slice(0, 8).map((w: any) => (
                <li key={w.id}><Link href={`/terminal/${w.id}`} className="flex items-center gap-2 border-b border-line/50 px-3.5 py-1.5 last:border-0 hover:bg-panel-2/50">
                  <span className="w-14 text-[12.5px] font-semibold">{w.symbol}</span>
                  <Sparkline data={(w.spark ?? []).map(Number)} width={70} height={20} />
                  <span className="ml-auto text-right"><span className="num block text-[12px]">{price(w.last_price)}</span><span className={cx("num block text-[10.5px]", tone(w.change_24h))}>{pct(w.change_24h)}</span></span>
                </Link></li>
              ))}
              {s && !(s.watchlist ?? []).length && <li className="flex items-center justify-center gap-1.5 px-3.5 py-5 text-[12px] text-muted"><Star className="size-3.5" /> Star assets on <Link href="/discover" className="text-accent-2 hover:underline">Markets</Link></li>}
            </ul>
          </section>

          <section className="surface rounded-xl">
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5"><h2 className="text-[13px] font-semibold">Recent fills</h2><Link href="/portfolio?tab=orders" className="text-[11px] text-muted hover:text-text">Audit log</Link></div>
            <ul>
              {(s?.recentOrders ?? []).slice(0, 7).map((o: any) => (
                <li key={o.id} className="flex items-center gap-2 border-b border-line/50 px-3.5 py-1.5 text-[12px] last:border-0">
                  <span className={cx("w-9 rounded px-1 py-px text-center text-[9.5px] font-bold uppercase", o.side === "buy" ? "bg-up-soft text-up" : "bg-down-soft text-down")}>{o.side}</span>
                  <Link href={`/terminal/${o.asset_id}`} className="font-semibold hover:underline">{o.symbol}</Link>
                  <span className="num truncate text-faint">{o.filled_quantity ? `${qty(o.filled_quantity)} @ ${price(o.avg_fill_price)}` : o.notional_usd ? usd(o.notional_usd) : qty(o.quantity)}</span>
                  <span className="ml-auto shrink-0 text-right text-[10.5px] text-faint">{o.status === "filled" ? o.source : o.status.replace(/_/g, " ")}<span className="block">{ago(o.created_at)}</span></span>
                </li>
              ))}
              {s && !(s.recentOrders ?? []).length && <li className="px-3.5 py-5 text-center text-[12px] text-muted">No trades yet.</li>}
            </ul>
          </section>
        </aside>
      </div>

      <div className="pt-2"><button onClick={() => setBoard(!board)} className="flex items-center gap-2 text-[12.5px] font-semibold text-muted hover:text-text"><LayoutDashboard className="size-4" /> Your board: shortcuts, progress, lists <ChevronDown className={cx("size-3.5 transition-transform", board && "rotate-180")} /></button></div>
      {board && <HomeDashboard />}
    </div>
  );
}
