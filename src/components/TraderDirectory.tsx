"use client";
import Link from "next/link";
import { useState } from "react";
import { Wallet, Users, CandlestickChart, ExternalLink, Info, Search, Repeat } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const money = (n: number | null | undefined) => n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 })}`;
const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-up" : "text-down");

function Switch({ on, onClick, disabled, label = "Mimic", title }: { on: boolean; onClick: () => void; disabled?: boolean; label?: string; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} role="switch" aria-checked={on} title={title}
      className={cx("flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40", on ? "border-up/50 text-up" : "border-line-2 text-muted hover:text-text")}>
      <span className={cx("relative h-4 w-7 rounded-full transition-colors", on ? "bg-up" : "bg-panel-2 ring-1 ring-line")}><span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-[14px]" : "left-0.5")} /></span>{label}
    </button>
  );
}

/**
 * Everyone whose trades Merod can see, on and off the platform: public Solana wallets (on-chain), Merod traders
 * (crypto + stocks) and consenting traders' outside brokers — each with stats and a Mimic switch, plus Mimic all.
 */
export function TraderDirectory({ compact = false }: { compact?: boolean }) {
  const { data, refresh } = useApi<any>("/api/traders", { refreshMs: 60000 });
  const [tab, setTab] = useState<"wallets" | "merod" | "stocks">("wallets");
  const [qs, setQs] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const can = !!data?.canMimic;
  const rows: any[] = (data?.[tab] ?? []).filter((r: any) => !qs || JSON.stringify([r.address, r.handle, r.name, r.tokens]).toLowerCase().includes(qs.toLowerCase()));
  const eligible = rows.filter((r) => tab === "wallets" || r.copyable);
  const allOn = eligible.length > 0 && eligible.every((r) => r.mimic);
  async function flip(targets: string[], on: boolean, key: string) {
    setBusy(key);
    try {
      const r: any = await api("/api/traders", { method: "POST", json: { group: tab, on, targets } });
      toast(on ? `Mimicking ${r.done} ${tab === "wallets" ? "wallet" : "trader"}${r.done === 1 ? "" : "s"}: their new trades are repeated at the same size (paper, $1,000/day cap each)` : `Paused ${r.done}`, on ? "up" : "neutral");
      if (r.skipped?.length) toast(`Skipped ${r.skipped.length}: ${r.skipped[0]}`, "down");
      refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  const TABS = [["wallets", "Public wallets", Wallet, data?.wallets?.length], ["merod", "Merod traders", Users, data?.merod?.length], ["stocks", "Stock traders", CandlestickChart, data?.stocks?.length]] as const;
  return (
    <section className="surface rounded-2xl p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Repeat className="size-5 text-accent-2" /> All traders</h3>
        <div className="flex gap-1 rounded-xl border border-line bg-bg-2/60 p-1 text-[12px]">
          {TABS.map(([k, l, I, n]) => <button key={k} onClick={() => setTab(k)} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1", tab === k ? "nav-active" : "text-muted hover:text-text")}><I className="size-3.5" />{l}{n != null && <span className="text-faint">{n}</span>}</button>)}
        </div>
        <div className="relative ml-auto"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" /><input value={qs} onChange={(e) => setQs(e.target.value)} placeholder="Filter…" className="h-8 w-40 rounded-lg border border-line bg-panel-2/60 pl-8 pr-2 text-xs outline-none" /></div>
        {can && <Switch on={allOn} disabled={!eligible.length || busy === "all"} onClick={() => flip(eligible.map((r) => tab === "wallets" ? r.address : r.handle), !allOn, "all")} label={`Mimic all (${eligible.length})`} title="Turn mimic on or off for every eligible trader in this list" />}
      </header>
      {tab === "wallets" && !data?.birdeye && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-panel-2 px-3 py-2 text-[11.5px] text-muted"><Info className="mt-0.5 size-3.5 shrink-0" /><span>Top public wallets come from Birdeye. Connect it in Admin → Integrations or paste your own key on <Link href="/broker-keys" className="underline">Broker & AI Keys</Link>. Wallets you follow are listed either way. Mimicking a wallet&apos;s swaps also needs a Helius key.</span></p>}
      <div className={cx("mt-3 overflow-x-auto", compact ? "max-h-[420px]" : "max-h-[620px]", "overflow-y-auto")}>
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="sticky top-0 bg-panel text-left text-[11px] text-muted">
            {tab === "wallets"
              ? <tr><th className="py-1.5">Wallet</th><th>Coins (24h)</th><th className="text-right">Trades</th><th className="text-right">Bought</th><th className="text-right">Sold</th><th className="text-right">Volume</th><th className="pl-3">Source</th><th /></tr>
              : <tr><th className="py-1.5">Trader</th><th className="text-right">Crypto P&L</th><th className="text-right">Stock P&L</th><th className="text-right">Trades</th><th className="text-right">Win rate</th><th className="text-right">Volume</th><th className="pl-3">Book</th><th /></tr>}
          </thead>
          <tbody>
            {rows.map((r) => tab === "wallets" ? (
              <tr key={r.address} className="border-t border-line/60">
                <td className="py-2"><a href={`https://solscan.io/account/${r.address}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono hover:underline">{short(r.address)} <ExternalLink className="size-3 text-faint" /></a></td>
                <td className="text-muted">{r.tokens?.length ? [...new Set(r.tokens)].join(", ") : "—"}</td>
                <td className="num text-right">{r.trades ?? "—"}</td>
                <td className="num text-right text-up">{money(r.buyUsd)}</td>
                <td className="num text-right text-down">{money(r.sellUsd)}</td>
                <td className="num text-right">{money(r.volume)}</td>
                <td className="pl-3 text-[11px] text-muted">{r.source}{r.lastAt ? ` · ${ago(r.lastAt)}` : ""}</td>
                <td className="text-right">{can ? <Switch on={!!r.mimic} disabled={busy === r.address} onClick={() => flip([r.address], !r.mimic, r.address)} /> : <span className="text-[10px] text-faint">Owner only</span>}</td>
              </tr>
            ) : (
              <tr key={r.handle} className="border-t border-line/60">
                <td className="py-2"><Link href={`/social/${r.handle}`} className="flex items-center gap-2 hover:underline"><span className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-black" style={{ background: r.color || "#d6b37a" }}>{(r.name ?? r.handle).slice(0, 1).toUpperCase()}</span><span><span className="font-medium">{r.name}</span> <span className="text-muted">@{r.handle}</span></span></Link></td>
                <td className={cx("num text-right", tone(r.cryptoPnl))}>{r.cryptoTrades ? money(r.cryptoPnl) : "—"}</td>
                <td className={cx("num text-right", tone(r.stockPnl))}>{r.stockTrades ? money(r.stockPnl) : "—"}</td>
                <td className="num text-right">{r.trades}</td>
                <td className="num text-right">{r.winRate == null ? "—" : `${r.winRate.toFixed(0)}%`}</td>
                <td className="num text-right">{money(r.volume)}</td>
                <td className="pl-3 text-[11px] text-muted">{r.live ? "Live" : "Paper"}{r.outsideBroker ? " + outside broker" : ""}{r.lastAt ? ` · ${ago(r.lastAt)}` : ""}</td>
                <td className="text-right">{!can ? <span className="text-[10px] text-faint">Owner only</span> : r.copyable ? <Switch on={!!r.mimic} disabled={busy === r.handle} onClick={() => flip([r.handle], !r.mimic, r.handle)} /> : <span className="text-[10px] text-faint" title="This trader hasn't allowed copy trading">Not shared</span>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-8 text-center text-xs text-muted">{data ? "No traders in this list yet." : "Loading…"}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10.5px] text-faint">Stats: wallets = last 24h on-chain; Merod traders = last 30 days (realised P&L). {data?.limits} Mimicked trades run in your paper account through the order engine&apos;s risk checks.</p>
    </section>
  );
}
