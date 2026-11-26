"use client";
import Link from "next/link";
import { useState } from "react";
import { Wallet, Users, CandlestickChart, ExternalLink, Info, Search, Repeat, Trophy, Bitcoin, LineChart } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const money = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 })}`;
const signed = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`;
const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-up" : "text-down");
type Tab = "gainers" | "wallets" | "merod" | "stocks" | "cryptoTrades" | "stockTrades";

export function Switch({ on, onClick, disabled, label = "Mimic", title }: { on: boolean; onClick: () => void; disabled?: boolean; label?: string; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} role="switch" aria-checked={on} title={title}
      className={cx("flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40", on ? "border-up/50 text-up" : "border-line-2 text-muted hover:text-text")}>
      <span className={cx("relative h-4 w-7 rounded-full transition-colors", on ? "bg-up" : "bg-panel-2 ring-1 ring-line")}><span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-[14px]" : "left-0.5")} /></span>{label}
    </button>
  );
}

/**
 * Everyone whose trades Merod can see, on and off the platform: top-gainer and active public Solana wallets (on-chain),
 * Merod traders (crypto + stocks), consenting traders' outside brokers, and live crypto / stock trade feeds —
 * each with stats and a Mimic switch, plus Mimic all per list.
 */
export function TraderDirectory({ compact = false }: { compact?: boolean }) {
  const [period, setPeriod] = useState<"today" | "1h" | "4h" | "12h" | "24h" | "7d">("today");
  const { data, refresh } = useApi<any>(`/api/traders?period=${period}`, { refreshMs: 60000 });
  const [tab, setTab] = useState<Tab>("gainers");
  // PnL dial: 0 = no minimum; otherwise a log scale from $10 to $1,000,000 accumulated in the window.
  const [dial, setDial] = useState(0);
  const minPnl = dial <= 0 ? 0 : Math.round(10 ** (1 + (dial / 100) * 5));
  const onchain = useApi<any>(tab === "cryptoTrades" ? "/api/world/onchain?symbols=SOL" : null, { refreshMs: 15000 });
  const [qs, setQs] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const can = !!data?.canMimic;
  const group = (t: Tab): "wallets" | "merod" | "stocks" => (t === "gainers" || t === "wallets" ? "wallets" : t === "stocks" ? "stocks" : "merod");
  const isWallet = tab === "gainers" || tab === "wallets";
  const isFeed = tab === "cryptoTrades" || tab === "stockTrades";
  let rows: any[] = data?.[tab] ?? [];
  if (tab === "cryptoTrades") rows = [...rows, ...(onchain.data?.trades ?? []).map((t: any) => ({ id: t.tx, wallet: t.wallet, side: t.side, symbol: t.symbol, usd: t.usd, at: t.at, onchain: true }))].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  rows = rows.filter((r: any) => !qs || JSON.stringify([r.address, r.handle, r.name, r.tokens, r.symbol, r.wallet]).toLowerCase().includes(qs.toLowerCase()));
  const gainersTotal = tab === "gainers" ? rows.length : 0;
  if (tab === "gainers" && minPnl > 0) rows = rows.filter((r: any) => (r.value ?? 0) >= minPnl);
  const targetOf = (r: any) => (isWallet ? r.address : r.onchain ? r.wallet : r.handle);
  const eligible = isFeed ? [] : rows.filter((r) => isWallet || r.copyable);
  const allOn = eligible.length > 0 && eligible.every((r) => r.mimic);
  async function flip(g: "wallets" | "merod" | "stocks", targets: string[], on: boolean, key: string) {
    setBusy(key);
    try {
      const r: any = await api("/api/traders", { method: "POST", json: { group: g, on, targets: [...new Set(targets)] } });
      toast(on ? `Mimicking ${r.done} ${g === "wallets" ? "wallet" : "trader"}${r.done === 1 ? "" : "s"}: their new trades are repeated at the same size (paper, $1,000/day cap each)` : `Paused ${r.done}`, on ? "up" : "neutral");
      if (r.skipped?.length) toast(`Skipped ${r.skipped.length}: ${r.skipped[0]}`, "down");
      refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  const TABS: [Tab, string, any, number | undefined][] = [["gainers", "Top gainers", Trophy, data?.gainers?.length], ["wallets", "Public wallets", Wallet, data?.wallets?.length], ["merod", "Merod traders", Users, data?.merod?.length],
    ["stocks", "Stock traders", CandlestickChart, data?.stocks?.length], ["cryptoTrades", "Crypto trades", Bitcoin, data?.cryptoTrades?.length], ["stockTrades", "Stock trades", LineChart, data?.stockTrades?.length]];
  const mimicCell = (r: any, g: "wallets" | "merod" | "stocks", target: string | null, copyable = true) =>
    !can ? <span className="text-[10px] text-faint">Owner only</span> : !target ? null : !copyable ? <span className="text-[10px] text-faint" title="This trader hasn't allowed copy trading">Not shared</span>
      : <Switch on={!!r.mimic} disabled={busy === target} onClick={() => flip(g, [target], !r.mimic, target)} />;
  return (
    <section className="surface rounded-2xl p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Repeat className="size-5 text-accent-2" /> All traders</h3>
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg-2/60 p-1 text-[12px]">
          {TABS.map(([k, l, I, n]) => <button key={k} onClick={() => setTab(k)} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1", tab === k ? "nav-active" : "text-muted hover:text-text")}><I className="size-3.5" />{l}{n != null && <span className="text-faint">{n}</span>}</button>)}
        </div>
        <div className="relative ml-auto"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" /><input value={qs} onChange={(e) => setQs(e.target.value)} placeholder="Filter…" className="h-8 w-40 rounded-lg border border-line bg-panel-2/60 pl-8 pr-2 text-xs outline-none" /></div>
        {can && !isFeed && <Switch on={allOn} disabled={!eligible.length || busy === "all"} onClick={() => flip(group(tab), eligible.map(targetOf), !allOn, "all")} label={`Mimic all (${eligible.length})`} title="Turn mimic on or off for every eligible trader in this list" />}
      </header>
      {isWallet && !data?.birdeye && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-panel-2 px-3 py-2 text-[11.5px] text-muted"><Info className="mt-0.5 size-3.5 shrink-0" /><span>Top public wallets come from Birdeye. Connect it in Admin → Integrations or paste your own key on <Link href="/broker-keys" className="underline">Broker & AI Keys</Link>. Wallets you follow are listed either way. Mimicking a wallet&apos;s swaps also needs a Helius key.</span></p>}
      {tab === "gainers" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-bg-2/50 px-3 py-2.5">
          <div className="flex items-center gap-1 text-[12px]">
            <span className="mr-1 text-muted">Window</span>
            {([["today", "Today"], ["1h", "1h"], ["4h", "4h"], ["12h", "12h"], ["24h", "24h"], ["7d", "7d"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setPeriod(k)} className={cx("rounded-lg px-2.5 py-1", period === k ? "nav-active" : "text-muted hover:text-text")}>{l}</button>
            ))}
          </div>
          <div className="flex min-w-[280px] flex-1 items-center gap-3 text-[12px]">
            <span className="shrink-0 text-muted">Min PnL accumulated</span>
            <input type="range" min={0} max={100} step={1} value={dial} onChange={(e) => setDial(Number(e.target.value))} className="flex-1 accent-[#d6b37a]" aria-label="Minimum PnL accumulated" />
            <span className="flex shrink-0 items-center gap-1">$<input type="number" min={0} value={minPnl} onChange={(e) => { const v = Number(e.target.value); setDial(v <= 10 ? (v > 0 ? 1 : 0) : Math.min(100, Math.max(0, ((Math.log10(v) - 1) / 5) * 100))); }} className="num h-7 w-24 rounded-md border border-line bg-panel-2 px-1.5 text-right" /></span>
            <span className="shrink-0 text-faint">{rows.length}/{gainersTotal} wallets</span>
          </div>
        </div>
      )}
      {tab === "gainers" && rows[0]?.kind === "net_flow" && <p className="mt-2 text-[11px] text-faint">* Birdeye&apos;s PnL ranking isn&apos;t available on this key for this window, so wallets are ranked by net flow (sold − bought) over {rows[0].window}. That&apos;s cash taken out, not verified profit.</p>}
      <div className={cx("mt-3 overflow-x-auto overflow-y-auto", compact ? "max-h-[420px]" : "max-h-[620px]")}>
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="sticky top-0 bg-panel text-left text-[11px] text-muted">
            {tab === "gainers" ? <tr><th className="py-1.5">#</th><th>Wallet</th><th className="text-right">{rows[0]?.kind === "net_flow" ? "Net flow" : "PnL"} ({rows[0]?.window ?? period})</th><th>Coins</th><th className="text-right">Trades</th><th className="text-right">Volume</th><th className="pl-3">Source</th><th /></tr>
              : tab === "wallets" ? <tr><th className="py-1.5">Wallet</th><th>Coins (24h)</th><th className="text-right">Trades</th><th className="text-right">Bought</th><th className="text-right">Sold</th><th className="text-right">Volume</th><th className="pl-3">Source</th><th /></tr>
              : isFeed ? <tr><th className="py-1.5">Time</th><th>Trader</th><th>Side</th><th>Asset</th><th className="text-right">Amount</th><th className="text-right">Price</th><th className="pl-3">Where</th><th /></tr>
              : <tr><th className="py-1.5">Trader</th><th className="text-right">Crypto P&L</th><th className="text-right">Stock P&L</th><th className="text-right">Trades</th><th className="text-right">Win rate</th><th className="text-right">Volume</th><th className="pl-3">Book</th><th /></tr>}
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => tab === "gainers" ? (
              <tr key={r.address} className="border-t border-line/60">
                <td className="py-2 font-semibold text-accent-2">{i + 1}</td>
                <td><a href={`https://solscan.io/account/${r.address}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono hover:underline">{short(r.address)} <ExternalLink className="size-3 text-faint" /></a></td>
                <td className={cx("num text-right font-semibold", tone(r.value))}>{signed(r.value)}{r.kind === "net_flow" ? "*" : ""}</td>
                <td className="text-muted">{r.tokens?.length ? [...new Set(r.tokens)].join(", ") : "—"}</td>
                <td className="num text-right">{r.trades?.toLocaleString() ?? "—"}</td>
                <td className="num text-right">{money(r.volume)}</td>
                <td className="pl-3 text-[11px] text-muted">{r.source}</td>
                <td className="text-right">{mimicCell(r, "wallets", r.address)}</td>
              </tr>
            ) : tab === "wallets" ? (
              <tr key={r.address} className="border-t border-line/60">
                <td className="py-2"><a href={`https://solscan.io/account/${r.address}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono hover:underline">{short(r.address)} <ExternalLink className="size-3 text-faint" /></a></td>
                <td className="text-muted">{r.tokens?.length ? [...new Set(r.tokens)].join(", ") : "—"}</td>
                <td className="num text-right">{r.trades ?? "—"}</td>
                <td className="num text-right text-up">{money(r.buyUsd)}</td>
                <td className="num text-right text-down">{money(r.sellUsd)}</td>
                <td className="num text-right">{money(r.volume)}</td>
                <td className="pl-3 text-[11px] text-muted">{r.source}{r.lastAt ? ` · ${ago(r.lastAt)}` : ""}</td>
                <td className="text-right">{mimicCell(r, "wallets", r.address)}</td>
              </tr>
            ) : isFeed ? (
              <tr key={r.id} className="border-t border-line/60">
                <td className="py-2 text-[11px] text-muted">{ago(r.at)}</td>
                <td>{r.onchain ? <a href={`https://solscan.io/account/${r.wallet}`} target="_blank" rel="noreferrer" className="font-mono hover:underline">{short(r.wallet)}</a> : <Link href={`/social/${r.handle}`} className="hover:underline">@{r.handle}</Link>}</td>
                <td className={r.side === "buy" ? "text-up" : "text-down"}>{r.side}</td>
                <td>{r.asset_id ? <Link href={`/research/${r.asset_id}`} className="font-medium hover:underline">{r.symbol}</Link> : <span className="font-medium">{r.symbol}</span>}</td>
                <td className="num text-right">{money(r.usd)}</td>
                <td className="num text-right">{r.price ? money(r.price) : "—"}</td>
                <td className="pl-3 text-[11px] text-muted">{r.onchain ? "Solana (public)" : `Merod${r.is_paper ? " · paper" : " · live"}`}</td>
                <td className="text-right">{mimicCell(r, r.onchain ? "wallets" : "merod", r.onchain ? r.wallet : r.handle, r.onchain || !!r.allow_copy_trading)}</td>
              </tr>
            ) : (
              <tr key={r.handle} className="border-t border-line/60">
                <td className="py-2"><Link href={`/social/${r.handle}`} className="flex items-center gap-2 hover:underline"><span className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-black" style={{ background: r.color || "#d6b37a" }}>{(r.name ?? r.handle).slice(0, 1).toUpperCase()}</span><span><span className="font-medium">{r.name}</span> <span className="text-muted">@{r.handle}</span></span></Link></td>
                <td className={cx("num text-right", tone(r.cryptoPnl))}>{r.cryptoTrades ? signed(r.cryptoPnl) : "—"}</td>
                <td className={cx("num text-right", tone(r.stockPnl))}>{r.stockTrades ? signed(r.stockPnl) : "—"}</td>
                <td className="num text-right">{r.trades}</td>
                <td className="num text-right">{r.winRate == null ? "—" : `${r.winRate.toFixed(0)}%`}</td>
                <td className="num text-right">{money(r.volume)}</td>
                <td className="pl-3 text-[11px] text-muted">{r.live ? "Live" : "Paper"}{r.outsideBroker ? " + outside broker" : ""}{r.lastAt ? ` · ${ago(r.lastAt)}` : ""}</td>
                <td className="text-right">{mimicCell(r, group(tab), r.handle, r.copyable)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-8 text-center text-xs text-muted">{!data ? "Loading…" : tab === "merod" || tab === "stocks" || tab === "stockTrades" ? "No other Merod traders with public profiles have traded yet. As people join and trade, they appear here." : "No traders in this list yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10.5px] text-faint">Stats: gainers = Birdeye 7-day / today PnL; wallets = last 24h on-chain; Merod traders = last 30 days realised P&L; trade feeds = last 7 days. {data?.limits} Mimicked trades run in your paper account through the order engine&apos;s risk checks.</p>
    </section>
  );
}
