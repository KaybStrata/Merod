"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, Star, TrendingUp, Bot, Search, Zap, Shield, Repeat, Activity, Plus } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { AssetIcon, Sparkline, cx } from "@/components/ui";
import { ago } from "@/lib/format";
import { ROLE_ICON, fmtUsd, fmtPct, toneOf } from "./common";

/** Right panel: Live Activity (agents + fills), Portfolio and Watchlist, as in the Merod workspace concept. */
export function RailActivity() {
  const ev = useApi<any>("/api/agents/events?limit=12", { refreshMs: 20000 });
  const pf = useApi<any>("/api/portfolio", { refreshMs: 30000 });
  const hist = useApi<any>("/api/portfolio/history?range=1D", { refreshMs: 60000 });
  const wl = useApi<any>("/api/watchlists", { refreshMs: 30000 });
  const last = useRef(0);
  useRealtime((e) => { if (["agent", "fill", "order"].includes(e.type) && Date.now() - last.current > 2000) { last.current = Date.now(); ev.refresh(); if (e.type === "fill") pf.refresh(); } });
  const [hide, setHide] = useState(false);
  const events: any[] = (ev.data?.events ?? []).filter((e: any) => e.kind !== "thought").slice(0, 6);
  const p = pf.data?.paper;
  const points: number[] = (hist.data?.points ?? hist.data?.series ?? []).map((x: any) => Number(x.value ?? x.v ?? 0)).filter((n: number) => n > 0);
  const items: any[] = (wl.data?.watchlists ?? []).flatMap((w: any) => w.items).slice(0, 6);
  const icon = (e: any) => e.kind === "execution" ? TrendingUp : e.kind === "state" && /running|started/i.test(e.title) ? Bot : e.kind === "analysis" && e.agent_role === "market_scanner" ? Search : ROLE_ICON[e.agent_role] ?? Activity;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <section className="surface rounded-2xl p-3.5">
        <header className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Activity className="size-4 text-accent-2" /> Live Activity</h3>
          <Link href="/agents/workspace" className="flex items-center gap-1 text-[11px] text-muted hover:text-text">All Activity <ArrowRight className="size-3" /></Link>
        </header>
        {!events.length && <p className="py-4 text-center text-[11px] text-muted">Agent decisions, trades and runs will stream here.</p>}
        <ul className="space-y-0.5">
          {events.map((e) => { const I = icon(e); return (
            <li key={e.id}>
              <Link href={e.agent_id ? `/agents/${e.agent_id}` : "/agents"} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5 hover:bg-panel-2">
                <span className={cx("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel-2", e.kind === "execution" ? "text-up" : e.kind === "warning" ? "text-warn" : "text-accent-2")}><I className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[12.5px] font-semibold">{e.agent_name ?? "Fleet"}</span><span className="shrink-0 text-[10px] text-faint">{ago(e.created_at)}</span></span>
                  <span className="line-clamp-1 block text-[11.5px] text-muted">{e.title}</span>
                </span>
              </Link>
            </li>
          ); })}
        </ul>
      </section>

      <section className="surface rounded-2xl p-4">
        <header className="flex items-center justify-between"><h3 className="text-[15px] font-semibold">Portfolio</h3><button onClick={() => setHide(!hide)} className="text-muted hover:text-text" aria-label="Hide values">{hide ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></header>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <div className="num text-[1.7rem] font-semibold leading-none">{hide ? "••••••" : fmtUsd(p?.total)}</div>
            <div className={cx("num mt-1.5 text-xs font-medium", toneOf(p?.dailyPnl))}>{p ? `${p.dailyPnl >= 0 ? "▲" : "▼"} ${fmtUsd(Math.abs(p.dailyPnl))} (${fmtPct(p.total ? (p.dailyPnl / p.total) * 100 : 0)}) 24h` : "—"}</div>
          </div>
          {points.length > 1 && <Sparkline data={points} width={110} height={42} up={points[points.length - 1] >= points[0]} />}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11px]">
          <div><div className="text-muted">Total Return</div><div className={cx("num mt-0.5 font-semibold", toneOf(p?.lifetimePnl))}>{p?.starting ? fmtPct((p.lifetimePnl / p.starting) * 100) : "—"}</div></div>
          <div><div className="text-muted">Invested</div><div className="num mt-0.5 font-semibold">{hide ? "•••" : fmtUsd(p?.invested)}</div></div>
          <div><div className="text-muted">Available</div><div className="num mt-0.5 font-semibold">{hide ? "•••" : fmtUsd(p?.cash)}</div></div>
        </div>
        <div className="mt-2 text-[10px] text-faint">Paper account</div>
      </section>

      <section className="surface rounded-2xl p-4">
        <header className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-[15px] font-semibold"><Star className="size-4" /> Watchlist</h3><Link href="/discover" className="text-muted hover:text-text" aria-label="Add to watchlist"><Plus className="size-4" /></Link></header>
        {!items.length && <p className="py-3 text-center text-[11px] text-muted">Star assets on Markets to watch them here.</p>}
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={`${a.watchlist_id}${a.id}`}>
              <Link href={`/research/${a.id}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-panel-2">
                <AssetIcon symbol={a.symbol} size={26} />
                <span className="w-12 shrink-0 text-[12.5px] font-semibold">{a.symbol}</span>
                <span className="num flex-1 text-right text-[12px]">{a.last_price != null ? fmtUsd(Number(a.last_price)) : "—"}</span>
                {a.spark?.length > 1 && <Sparkline data={a.spark.map(Number)} width={44} height={18} up={Number(a.change_24h) >= 0} fill={false} />}
                <span className={cx("num w-14 shrink-0 rounded-md px-1 py-0.5 text-center text-[10.5px] font-medium", Number(a.change_24h) >= 0 ? "bg-up-soft text-up" : "bg-down-soft text-down")}>{fmtPct(Number(a.change_24h))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
