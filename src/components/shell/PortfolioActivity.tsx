"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Repeat, Cpu, Sparkles, Landmark, Info } from "lucide-react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";
import { usd } from "@/lib/format";
import { useRealtime } from "./context";

type Row = { id: string; at: string; icon: any; title: string; body?: string; amount?: number | null; tone?: "up" | "down" | null; link?: string; group: "trades" | "funds" | "auto" };
const when = (t: string) => {
  const d = new Date(t), s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;

/** Right-rail "Portfolio" tab: live value, where today's move came from, and every portfolio event as it happens. */
export function PortfolioActivity({ active }: { active: boolean }) {
  const [book, setBook] = useState<"paper" | "live">("paper");
  const [filter, setFilter] = useState<"all" | "trades" | "funds" | "auto">("all");
  const pf = useApi<any>(active ? "/api/portfolio" : null, { refreshMs: 10_000 });
  // Trades / Auto views ask the server for just those events (last 30 days), so bot status lines never crowd them out.
  const feed = useApi<any>(active ? (filter === "trades" ? "/api/live-stream?filter=trades&limit=300" : filter === "auto" ? "/api/live-stream?filter=automation&limit=300" : "/api/live-stream") : null, { refreshMs: 5_000 });
  useRealtime((e) => { if (active && ["fill", "order", "auto", "copy", "trade", "funding"].includes(e.type)) { pf.refresh(); feed.refresh(); } });
  const s = pf.data?.[book];
  const paper = book === "paper";
  const movers = useMemo(() => (pf.data?.positions ?? []).filter((p: any) => !!p.is_paper === paper && Math.abs(Number(p.pnl_24h ?? 0)) >= 0.01)
    .sort((a: any, b: any) => Math.abs(Number(b.pnl_24h)) - Math.abs(Number(a.pnl_24h))).slice(0, 6), [pf.data, paper]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const it of (feed.data?.items ?? []) as any[]) {
      if (!["order", "copy", "auto", "modo"].includes(it.source) || it.kind === "thought" || it.kind === "analysis") continue;
      const icon = it.source === "copy" ? Repeat : it.source === "modo" ? Sparkles : it.source === "auto" ? Cpu : ArrowLeftRight;
      out.push({ id: it.id, at: it.at, icon, title: it.title, body: it.body, link: it.link, group: it.source === "order" || it.source === "copy" ? "trades" : "auto" });
    }
    for (const t of (pf.data?.transactions ?? []) as any[]) {
      const amt = t.amount_usd != null ? Number(t.amount_usd) : !t.asset_id ? Number(t.amount ?? 0) : 0;
      const kind = String(t.kind ?? t.type ?? "transaction");
      const isFund = /deposit|withdraw|transfer|fund|reset/i.test(kind);
      if (!isFund) continue;
      out.push({ id: `tx${t.id}`, at: t.created_at, icon: /withdraw/i.test(kind) ? ArrowUpRight : /deposit|fund/i.test(kind) ? ArrowDownLeft : Landmark,
        title: `${kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}${t.symbol ? ` · ${t.symbol}` : ""}`, body: t.account_label, amount: amt || null,
        tone: /withdraw/i.test(kind) ? "down" : "up", group: "funds" });
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out.filter((r) => filter === "all" || r.group === filter).slice(0, 80);
  }, [feed.data, pf.data, filter]);

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg border border-line bg-bg/40 p-0.5 text-[11px]">
        {(["paper", "live"] as const).map((b) => (
          <button key={b} onClick={() => setBook(b)} className={cx("flex-1 rounded-md px-2 py-1 font-medium", book === b ? (b === "live" ? "bg-down/20 text-down" : "bg-warn-soft text-warn") : "text-muted hover:text-text")}>{b === "paper" ? "Paper" : "Real money"}</button>
        ))}
      </div>

      <section className="rounded-xl border border-line bg-panel/60 p-3">
        <div className="flex items-center justify-between text-[11px] text-faint"><span>Portfolio value</span><span className="flex items-center gap-1 text-up"><span className="size-1.5 rounded-full bg-up pulse-dot" />live</span></div>
        <div className="num mt-0.5 text-[22px] font-semibold">{s ? usd(s.total) : "—"}</div>
        {s && (
          <div className="mt-1 grid grid-cols-3 gap-1.5 text-[10.5px]">
            <div><div className="text-faint">24h</div><div className={cx("num font-semibold", s.dailyPnl >= 0 ? "text-up" : "text-down")}>{signed(s.dailyPnl)}</div></div>
            <div><div className="text-faint">All time</div><div className={cx("num font-semibold", s.lifetimePnl >= 0 ? "text-up" : "text-down")}>{signed(s.lifetimePnl)}</div></div>
            <div><div className="text-faint">Cash</div><div className="num font-semibold">{usd(s.cash, { compact: true })}</div></div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-panel/60 p-3">
        <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold">Where today&apos;s move came from <span title="Price move on what you already held 24h ago, plus value vs cost of anything bought in the last 24h, plus profit/loss from sells in the last 24h."><Info className="size-3 text-faint" /></span></div>
        {!movers.length && <p className="text-[11px] text-faint">No change from your holdings in the last 24 hours.</p>}
        {movers.map((p: any) => {
          const parts = p.pnl_24h_parts ?? {};
          const why = [Math.abs(parts.priceMoveOnHeld) >= 0.01 ? `price move ${signed(parts.priceMoveOnHeld)}` : null, Math.abs(parts.newBuys) >= 0.01 ? `bought today ${signed(parts.newBuys)}` : null,
            Math.abs(parts.realized) >= 0.01 ? `sold today ${signed(parts.realized)}` : null].filter(Boolean).join(" · ");
          return (
            <Link key={`${p.account_id}${p.asset_id}`} href={`/terminal/${p.asset_id}`} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 hover:bg-panel-2">
              <span className="min-w-0"><span className="text-[12px] font-semibold">{p.symbol}</span><span className="block truncate text-[10px] text-faint">{why || `${Number(p.change_24h ?? 0).toFixed(1)}% in 24h`}</span></span>
              <span className={cx("num shrink-0 text-[12px] font-semibold", Number(p.pnl_24h) >= 0 ? "text-up" : "text-down")}>{signed(Number(p.pnl_24h))}</span>
            </Link>
          );
        })}
      </section>

      <section className="rounded-xl border border-line bg-panel/60">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[11px] font-semibold">All activity</span>
          <div className="flex gap-0.5 text-[10px]">
            {(["all", "trades", "funds", "auto"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx("rounded px-1.5 py-0.5 capitalize", filter === f ? "bg-accent-soft text-accent-2" : "text-muted hover:text-text")}>{f === "auto" ? "Auto & Modo" : f}</button>
            ))}
          </div>
        </div>
        {!rows.length && <p className="p-4 text-center text-[11px] text-faint">No portfolio activity yet. Fills, orders, mimic trades, auto and Modo trades, deposits and withdrawals appear here the moment they happen.</p>}
        <ol>
          {rows.map((r) => {
            const body = (
              <div className="flex items-start gap-2 border-b border-line/50 px-3 py-2 last:border-0 hover:bg-panel-2/50">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-accent-2"><r.icon className="size-3" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] leading-snug">{r.title}</div>
                  {r.body && <div className="truncate text-[10.5px] text-faint">{r.body}</div>}
                </div>
                <div className="shrink-0 text-right">
                  {r.amount != null && <div className={cx("num text-[11.5px] font-semibold", r.tone === "down" ? "text-down" : "text-up")}>{usd(r.amount)}</div>}
                  <div className="text-[10px] text-faint">{when(r.at)}</div>
                </div>
              </div>
            );
            return <li key={r.id}>{r.link ? <Link href={r.link}>{body}</Link> : body}</li>;
          })}
        </ol>
      </section>
      <div className="flex gap-2 text-[11px]">
        <Link href="/analytics" className="flex-1 rounded-lg border border-line px-2 py-1.5 text-center text-muted hover:border-accent/50 hover:text-text">Performance</Link>
        <Link href="/portfolio" className="flex-1 rounded-lg border border-line px-2 py-1.5 text-center text-muted hover:border-accent/50 hover:text-text">Positions &amp; orders</Link>
      </div>
    </div>
  );
}
