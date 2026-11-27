"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Repeat, ShieldCheck, ExternalLink, FlaskConical, Zap, Check, Pause, Play, Info, Wallet, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle, useShell } from "@/components/shell/context";
import { CopyBotsPanel } from "@/components/CopyBots";
import { cx, Empty, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { TraderDirectory, type DirPick } from "@/components/TraderDirectory";
import { MimicAssistant } from "@/components/MimicAssistant";

const short = (w: string) => (w?.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w);
const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 })}`);
const signed = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`);
const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-text" : n > 0 ? "text-up" : "text-down");

/** Live mimic status: engine running, keys, copies in the last 24h by outcome, top reasons, problems to fix. */
function MimicHealth() {
  const { data } = useApi<any>("/api/copy/health", { refreshMs: 20_000 });
  if (!data) return null;
  const l = data.last24h, f = data.follows;
  const stat = (k: string, v: any, cls = "") => <div><div className={cx("num text-[1.05rem] font-semibold", cls)}>{v}</div><div className="text-[10.5px] text-muted">{k}</div></div>;
  return (
    <section className={cx("surface rounded-2xl p-3", data.healthy ? "" : "border-warn/40")}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
        <span className={cx("size-2 rounded-full", data.healthy ? "bg-up" : "bg-warn")} />Mimic status
        <span className="font-normal text-muted">· {f.active} active ({f.wallets} wallets, {f.traders} Merod traders{f.watching ? `, ${f.watching} watch-only` : ""}){f.paused ? ` · ${f.paused} paused` : ""}</span>
        <span className="ml-auto text-[11px] font-normal text-faint">{data.engine.running ? `Copy engine running · checked ${Math.max(0, Math.round(Date.now() / 1000 - data.engine.lastChecked))}s ago` : "Copy engine not checking"} · Helius {data.keys.helius ? "✓" : "✗"} · Birdeye {data.keys.birdeye ? "✓" : "✗"}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {stat("copied (24h)", l.copied.n, "text-up")}{stat("copied $ (24h)", `$${l.copied.usd.toFixed(0)}`)}{stat("waiting approval", l.pending.n)}{stat("watched", l.watched.n)}{stat("skipped", l.skipped.n, l.skipped.n ? "text-warn" : "")}{stat("failed", l.failed.n, l.failed.n ? "text-down" : "")}
      </div>
      {data.problems.length > 0 && <ul className="mt-2 space-y-1 text-[12px] text-warn">{data.problems.map((p: string) => <li key={p}>⚠ {p}</li>)}</ul>}
      {data.topReasons.length > 0 && <div className="mt-2 text-[11.5px] text-muted"><span className="text-faint">Why trades weren't copied (24h): </span>{data.topReasons.map((r: any) => `${r.reason} (${r.n})`).join(" · ")}</div>}
      {data.lastEvent && <div className="mt-1 text-[11px] text-faint">Last: {data.lastEvent.label} {data.lastEvent.side} {data.lastEvent.symbol ?? "a token"} → {String(data.lastEvent.status).replace("_", " ")} · {ago(data.lastEvent.created_at)}</div>}
    </section>
  );
}

/** Paste any number of wallet addresses (any separator) → mimic, watch, stop or get stats for all of them at once. */
function BulkWallets({ live, perTrade, onDone }: { live: boolean; perTrade: string; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const count = useMemo(() => new Set([...(text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) ?? []), ...(text.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? [])]).size, [text]);
  async function run(action: "mimic" | "watch" | "stop" | "stats") {
    if (!count) return toast("Paste at least one wallet address", "down");
    if (action === "mimic" && live && !confirm(`Mimic ${count} wallet${count === 1 ? "" : "s"} with REAL money?`)) return;
    setBusy(action); setResult(null);
    try { const r: any = await api("/api/copy/bulk", { method: "POST", json: { text, action, live, perTradeUsd: perTrade ? Number(perTrade) : undefined } }); setResult(r.message); if (action !== "stats") onDone(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  return (
    <section className="surface rounded-2xl p-3">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left text-[13px] font-semibold"><Wallet className="size-4 text-accent-2" />Mimic or look up any wallets <span className="font-normal text-muted">· paste as many addresses as you like</span><span className="ml-auto text-[11px] text-faint">{open ? "▾" : "▸"}</span></button>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste wallet addresses, one per line or separated by commas/spaces. Solana wallets can be mimicked; Solana and Ethereum (0x…) wallets can be looked up."
            className="w-full resize-y rounded-lg border border-line bg-bg-2 px-2.5 py-2 font-mono text-[12px] outline-none focus:border-accent/60" />
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted">{count} address{count === 1 ? "" : "es"}{live ? " · real money" : " · paper"}{perTrade ? ` · $${perTrade}/trade` : ""}</span>
            <button disabled={!!busy} onClick={() => run("mimic")} className="ml-auto rounded-lg bg-grad px-3 py-1.5 font-semibold text-bg disabled:opacity-50">{busy === "mimic" ? "Starting…" : `Mimic all`}</button>
            <button disabled={!!busy} onClick={() => run("watch")} className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-text disabled:opacity-50">{busy === "watch" ? "…" : "Watch only"}</button>
            <button disabled={!!busy} onClick={() => run("stats")} className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-text disabled:opacity-50">{busy === "stats" ? "Looking up…" : "Get stats"}</button>
            <button disabled={!!busy} onClick={() => run("stop")} className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-down disabled:opacity-50">{busy === "stop" ? "…" : "Stop mimicking"}</button>
          </div>
          {result && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg-2/60 p-2.5 font-sans text-[12px] leading-relaxed">{result}</pre>}
          <p className="text-[10.5px] text-faint">Uses the sizing and Paper / Real money setting on the right. Copying swaps needs a Helius key; holdings need Birdeye; Ethereum wallets need Alchemy (Broker &amp; AI keys).</p>
        </div>
      )}
    </section>
  );
}

/** Mimic: copy the best traders on and off Merod (featured trader, leaderboard, settings, Modo, your mimic bots). */
export default function MimicTradingPage() {
  const { user } = useShell();
  usePageTitle({ section: "Automate · Mimic", title: "Copy the best traders", accent: "best" });
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [pick, setPick] = useState<DirPick | null>(null);
  const [live, setLive] = useState(false);
  const [perTrade, setPerTrade] = useState("");
  const [maxDaily, setMaxDaily] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  if (user.role !== "super_admin") return <Empty icon={<Repeat className="size-6" />} title="Mimic trading is for the platform owner">Ask the owner if you&apos;d like access.</Empty>;

  // Default featured trader: the #1 gainer wallet, else the best Merod trader who allows copying.
  const featured: DirPick | null = pick ?? (data?.gainers?.[0] ? { row: data.gainers[0], group: "wallets", target: data.gainers[0].address, kind: "gainers" }
    : data?.merod?.find((m: any) => m.copyable) ? (() => { const m = data.merod.find((x: any) => x.copyable); return { row: m, group: "merod" as const, target: m.handle, kind: "merod" as const }; })() : null);
  // Keep the featured row fresh when the directory refreshes.
  const freshRow = featured && data ? ([...(data.gainers ?? []), ...(data.wallets ?? []), ...(data.merod ?? []), ...(data.stocks ?? [])].find((r: any) => (r.address ?? r.handle) === featured.target) ?? featured.row) : featured?.row;

  async function mimic(on: boolean) {
    if (!featured) return;
    if (on && live && !confirm(`Mimic ${featured.group === "wallets" ? short(featured.target) : `@${featured.target}`} with REAL money?`)) return;
    setBusy(true);
    try {
      const r: any = await api("/api/traders", { method: "POST", json: { group: featured.group, on, targets: [featured.target], live, perTradeUsd: perTrade ? Number(perTrade) : null, maxDailyUsd: maxDaily ? Number(maxDaily) : null } });
      if (r.skipped?.length) toast(`Skipped: ${r.skipped[0]}`, "down");
      else toast(on ? `Mimicking ${featured.group === "wallets" ? short(featured.target) : `@${featured.target}`}${live ? " with real money" : " on paper"}` : "Mimic paused", on ? "up" : "neutral");
      setNonce((n) => n + 1);
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <MimicHealth />
      <BulkWallets live={live} perTrade={perTrade} onDone={() => setNonce((n) => n + 1)} />
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <FeaturedTrader pick={featured} row={freshRow} data={data} busy={busy} onMimic={mimic} />
          <TraderDirectory key={nonce} sizing={{ live, perTrade, maxDaily }} selected={featured?.target ?? null} onSelect={setPick} onData={setData} />
        </div>
        <div className="space-y-4">
          <MimicSettings pick={featured} row={freshRow} live={live} setLive={setLive} perTrade={perTrade} setPerTrade={setPerTrade} maxDaily={maxDaily} setMaxDaily={setMaxDaily} busy={busy} onStart={() => mimic(true)} />
          <MimicAssistant />
        </div>
      </div>
      <CopyBotsPanel variant="mimic" />
      <div className="grid gap-2 text-[11px] text-faint md:grid-cols-3">
        <p><b className="text-muted">On Merod:</b> any Merod trader who allows copying (Settings → Privacy), paper and real trades, stocks and coins.</p>
        <p><b className="text-muted">Off Merod, stocks:</b> a trader&apos;s own Alpaca account once they&apos;ve connected it here and allowed copying.</p>
        <p><b className="text-muted">Off Merod, coins:</b> any public Solana wallet (no permission needed), or connected Kraken / Coinbase accounts. Private broker accounts can&apos;t be seen by anyone.</p>
      </div>
    </div>
  );
}

function who(pick: DirPick, row: any) {
  if (pick.group === "wallets") return { name: short(pick.target), sub: pick.kind === "gainers" ? "Top gainer wallet · Solana" : "Public wallet · Solana", initial: pick.target.slice(0, 2), color: "#d6b37a", link: `https://solscan.io/account/${pick.target}`, external: true };
  return { name: row?.name ?? `@${pick.target}`, sub: `@${pick.target} · ${pick.group === "stocks" ? "Stock trader" : "Merod trader"}${row?.live ? " · live" : " · paper"}`, initial: (row?.name ?? pick.target).slice(0, 1).toUpperCase(), color: row?.color || "#d6b37a", link: `/social/${pick.target}`, external: false };
}

/** Hero card: the selected trader's honest stats (what Merod can actually see) plus their recent trades. */
function FeaturedTrader({ pick, row, data, busy, onMimic }: { pick: DirPick | null; row: any; data: any; busy: boolean; onMimic: (on: boolean) => void }) {
  const trades = useMemo(() => {
    if (!pick || !data) return [] as any[];
    return [...(data.cryptoTrades ?? []), ...(data.stockTrades ?? [])].filter((t: any) => t.wallet === pick.target || t.handle === pick.target).sort((a: any, b: any) => +new Date(a.at) - +new Date(b.at));
  }, [pick, data]);
  if (!pick || !row) {
    return (
      <section className="surface flex min-h-[220px] items-center justify-center rounded-2xl p-6 text-center text-sm text-muted">
        {!data ? "Loading traders…" : <span>No traders to feature yet. Connect Birdeye in Admin → Integrations for top public wallets, or wait for Merod traders who allow copying.</span>}
      </section>
    );
  }
  const w = who(pick, row);
  const stats: [string, string, string?][] = pick.group === "wallets"
    ? pick.kind === "gainers"
      ? [[row.kind === "net_flow" ? `Net flow (${row.window ?? "window"})*` : `PnL (${row.window ?? "window"})`, signed(row.value), tone(row.value)], ["Trades", row.trades?.toLocaleString() ?? "—"], ["Volume", money(row.volume)], ["Coins", String(new Set(row.tokens ?? []).size || "—")], ["Source", row.source ?? "—"]]
      : [["Net (sold − bought)", signed((row.sellUsd ?? 0) - (row.buyUsd ?? 0)), tone((row.sellUsd ?? 0) - (row.buyUsd ?? 0))], ["Bought", money(row.buyUsd)], ["Sold", money(row.sellUsd)], ["Trades", String(row.trades ?? "—")], ["Volume", money(row.volume)]]
    : [["Crypto P&L (30d)", row.cryptoTrades ? signed(row.cryptoPnl) : "—", tone(row.cryptoPnl)], ["Stock P&L (30d)", row.stockTrades ? signed(row.stockPnl) : "—", tone(row.stockPnl)], ["Win rate", row.winRate == null ? "—" : `${row.winRate.toFixed(0)}%`], ["Trades", String(row.trades ?? "—")], ["Volume", money(row.volume)]];
  const copyable = pick.group === "wallets" || row.copyable;
  return (
    <section className="surface relative overflow-hidden rounded-2xl p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-bg ring-2 ring-accent/30" style={{ background: w.color }}>{w.initial}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {w.external ? <a href={w.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[17px] font-semibold hover:underline">{w.name}<ExternalLink className="size-3.5 text-faint" /></a>
              : <Link href={w.link} className="text-[17px] font-semibold hover:underline">{w.name}</Link>}
            {row.mimic && <span className="rounded-md bg-up-soft px-1.5 py-0.5 text-[10px] font-semibold text-up">MIMICKING</span>}
            {pick.group !== "wallets" && !row.copyable && <span className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">Copying not allowed</span>}
          </div>
          <div className="text-[12px] text-muted">{w.sub}{row.lastAt ? ` · last trade ${ago(row.lastAt)}` : ""}</div>
          {row.tokens?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{[...new Set<string>(row.tokens)].slice(0, 8).map((t) => <span key={t} className="rounded-md border border-line px-1.5 py-px text-[10.5px] text-muted">{t}</span>)}</div>}
        </div>
        <button disabled={busy || !copyable} onClick={() => onMimic(!row.mimic)}
          className={cx("flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold disabled:opacity-50", row.mimic ? "border border-line-2 text-text hover:border-down/50" : "bg-grad text-bg")}>
          {row.mimic ? <><Pause className="size-4" /> Pause mimic</> : <><Repeat className="size-4" /> Mimic {pick.group === "wallets" ? "wallet" : row.name?.split(" ")[0] ?? "trader"}</>}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map(([k, v, c]) => (
          <div key={k} className="rounded-xl border border-line bg-bg-2/50 px-3 py-2">
            <div className="truncate text-[10.5px] uppercase tracking-wide text-faint">{k}</div>
            <div className={cx("num mt-0.5 truncate text-[17px] font-semibold", c)}>{v}</div>
          </div>
        ))}
      </div>
      <TradeChart trades={trades} />
      {pick.kind === "gainers" && row.kind === "net_flow" && <p className="mt-1 text-[10.5px] text-faint">* Ranked by net flow (sold − bought): cash taken out, not verified profit.</p>}
    </section>
  );
}

/** Recent trades the feeds have seen for this trader: buys above the line, sells below, sized by dollars. */
function TradeChart({ trades }: { trades: any[] }) {
  if (!trades.length) return <div className="mt-3 flex h-[120px] items-center justify-center rounded-xl border border-dashed border-line text-[12px] text-faint">No recent trades from this trader in Merod&apos;s live feeds yet.</div>;
  const W = 800, H = 130, mid = H / 2;
  const max = Math.max(...trades.map((t) => Number(t.usd) || 0), 1);
  const t0 = +new Date(trades[0].at), t1 = Math.max(+new Date(trades[trades.length - 1].at), t0 + 1);
  let cum = 0;
  const pts = trades.map((t) => { cum += (t.side === "sell" ? 1 : -1) * (Number(t.usd) || 0); return cum; });
  const cmax = Math.max(...pts.map(Math.abs), 1);
  const x = (t: any) => 8 + ((+new Date(t.at) - t0) / (t1 - t0)) * (W - 16);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(trades[i]).toFixed(1)},${(mid - (v / cmax) * (mid - 8)).toFixed(1)}`).join(" ");
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[10.5px] text-faint"><span>Recent trades · {trades.length}</span><span><span className="text-up">▲ buys</span> · <span className="text-down">▼ sells</span> · <span className="text-accent-2">— net flow</span></span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[130px] w-full" preserveAspectRatio="none">
        <line x1="0" x2={W} y1={mid} y2={mid} stroke="var(--line)" />
        {trades.map((t, i) => { const h = Math.max(2, ((Number(t.usd) || 0) / max) * (mid - 6)); const buy = t.side !== "sell"; return <rect key={i} x={x(t) - 2} width="4" y={buy ? mid - h : mid} height={h} rx="1" fill={buy ? "var(--up)" : "var(--down)"} opacity="0.75"><title>{`${t.side} ${t.symbol} ${money(Number(t.usd))}`}</title></rect>; })}
        <path d={line} fill="none" stroke="var(--accent-2)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** Right panel: how new mimics trade (paper / real money, size, daily cap) and Start mimicking for the featured trader. */
function MimicSettings({ pick, row, live, setLive, perTrade, setPerTrade, maxDaily, setMaxDaily, busy, onStart }: {
  pick: DirPick | null; row: any; live: boolean; setLive: (v: boolean) => void; perTrade: string; setPerTrade: (v: string) => void; maxDaily: string; setMaxDaily: (v: string) => void; busy: boolean; onStart: () => void;
}) {
  const chips: [string, string][] = [["", "Same size"], ["10", "$10"], ["25", "$25"], ["100", "$100"], ["500", "$500"]];
  const copyable = pick && (pick.group === "wallets" || row?.copyable);
  return (
    <section className="surface rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">Mimic settings</h3>
        <span className={cx("rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider", live ? "bg-down-soft text-down" : "bg-warn-soft text-warn")}>{live ? "REAL MONEY" : "PAPER"}</span>
      </div>
      <p className="mt-0.5 text-[11.5px] text-muted">Used by Start mimicking, every Mimic switch and Mimic all.</p>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg-2/60 p-0.5 text-[12px]">
        <button onClick={() => setLive(false)} className={cx("flex items-center justify-center gap-1 rounded-md py-1.5", !live ? "nav-active" : "text-muted")}><FlaskConical className="size-3.5" /> Paper</button>
        <button onClick={() => setLive(true)} className={cx("flex items-center justify-center gap-1 rounded-md py-1.5", live ? "bg-down-soft text-down ring-1 ring-down/40" : "text-muted")}><Zap className="size-3.5" /> Real money</button>
      </div>
      <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-faint">Size per copied trade</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {chips.map(([v, l]) => <button key={l} onClick={() => setPerTrade(v)} className={cx("rounded-lg border px-2.5 py-1 text-[12px]", perTrade === v ? "border-accent/60 bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>{l}</button>)}
      </div>
      <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">Custom
        <span className="relative flex-1"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint">$</span>
          <input type="number" min={1} value={perTrade} onChange={(e) => setPerTrade(e.target.value)} placeholder="same size as trader" className="num h-8 w-full rounded-md border border-line bg-panel-2 pl-5 pr-2 text-[12px] text-text" /></span>
      </label>
      <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">Max per day
        <span className="relative flex-1"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint">$</span>
          <input type="number" min={0} value={maxDaily} onChange={(e) => setMaxDaily(e.target.value)} placeholder="no limit" className="num h-8 w-full rounded-md border border-line bg-panel-2 pl-5 pr-2 text-[12px] text-text" /></span>
      </label>
      <ul className="mt-3 space-y-1.5 text-[12px]">
        {["Copies their sells too", "Every order passes the trading engine's risk checks", "Stablecoin swaps are skipped", live ? "Crypto from your Merod Wallet, stocks from your live broker" : "Runs in your paper account"].map((t) => (
          <li key={t} className="flex items-start gap-2 text-muted"><Check className="mt-0.5 size-3.5 shrink-0 text-up" />{t}</li>
        ))}
      </ul>
      {live && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-down-soft px-2.5 py-2 text-[11px] text-down"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />Real money must be switched on (sidebar → Real money) and the account funded.</p>}
      <button onClick={onStart} disabled={!pick || busy || !copyable || row?.mimic}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-grad text-[13px] font-semibold text-bg disabled:opacity-50">
        <Play className="size-4" /> {row?.mimic ? "Already mimicking" : pick ? `Start mimicking ${pick.group === "wallets" ? short(pick.target) : `@${pick.target}`}` : "Pick a trader"}
      </button>
      <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-faint"><Info className="size-3" />Click any row in the leaderboard to feature it. {pick?.group === "wallets" ? <><Wallet className="size-3" /> Wallet swaps need a Helius key.</> : <><Users className="size-3" /> Merod traders must allow copying.</>}</p>
    </section>
  );
}
