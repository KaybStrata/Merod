"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Wallet, Plus, Building2, KeyRound, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Receipt, RefreshCw, Unplug, Copy, ShieldAlert, Sparkles, FlaskConical, Bitcoin, Coins, Link2, ChevronRight } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle, useShell } from "@/components/shell/context";
import { ValueHistory } from "@/components/ValueHistory";
import { usd, ago, qty } from "@/lib/format";
import { AssetIcon, Badge, Button, Empty, Input, Modal, Select, Skeleton, StatusPill, cx, useToast } from "@/components/ui";
import { FundingPanel } from "@/components/wallet/FundingPanel";
import { MerodWalletCard, BrowserWallets, PendingSignatures, BuyFromMerod } from "@/components/wallet/SolanaWallets";
import { BuyWithCard, TokenizedStocks } from "@/components/wallet/BuyCrypto";
import { classify } from "@/components/wallet/AccountPicker";

const money = (n: number | null | undefined) => n == null || !Number.isFinite(Number(n)) ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const funding = (t: string) => window.dispatchEvent(new CustomEvent("merod-funding-tab", { detail: t }));
const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

function WalletInner() {
  usePageTitle({ section: "Trade · Funds", title: "Wallet & Funds", accent: "Funds" });
  const toast = useToast();
  const { user } = useShell();
  const owner = user.role === "super_admin";
  const params = useSearchParams();
  const { data, error, loading, refresh } = useApi<any>("/api/wallet/accounts");
  const fund = useApi<any>("/api/wallet/funding");
  const port = useApi<any>("/api/portfolio", { refreshMs: 60_000 });
  const mw = useApi<any>(owner ? "/api/wallet/merod" : null, { refreshMs: 60_000 });
  const [view, setView] = useState<"paper" | "real">("paper");
  const [modal, setModal] = useState<null | "external" | "byo">(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ext, setExt] = useState({ network: "solana", address: "", label: "" });
  const [byo, setByo] = useState({ providerId: "alpaca_trading", environment: "sandbox", label: "", externalRef: "" });
  const [histFilter, setHistFilter] = useState<"all" | "deposit" | "withdrawal" | "transfer">("all");

  useEffect(() => {
    if (params.get("snaptrade") === "done") api("/api/wallet/snaptrade").then((r) => { toast(`Synced ${r.synced} brokerage account(s)`, "up"); refresh(); }).catch((e) => toast(e.message, "down"));
    if (params.get("onramp") === "done") toast("Payment submitted. Your coins arrive in your wallet once the provider sends them (usually a few minutes).", "up");
  }, []); // eslint-disable-line

  const active: any[] = useMemo(() => (data?.accounts ?? []).filter((a: any) => a.status !== "disconnected"), [data]);
  const realWallets: any[] = mw.data?.wallets ?? [];
  const brokers = active.filter((a) => classify(a).mode === "live" && a.kind === "brokerage");
  const realTotal = (mw.data?.totalUsd ?? 0) + brokers.reduce((s, a) => s + Number(a.cash_balance ?? 0), 0);
  const paperSum = port.data?.paper;
  const paperTotal = paperSum?.total ?? active.filter((a) => a.kind === "paper").reduce((s, a) => s + Number(a.cash_balance ?? 0), 0);
  useEffect(() => { if (realTotal > 0) setView("real"); }, [realTotal > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = view === "real" ? realTotal : paperTotal;
  const tokens: any[] = useMemo(() => {
    const m = new Map<string, any>();
    for (const w of realWallets) for (const t of w.balances?.tokens ?? []) {
      const cur = m.get(t.mint) ?? { ...t, amount: 0, usd: 0 };
      cur.amount += Number(t.amount ?? 0); cur.usd += Number(t.usd ?? 0);
      m.set(t.mint, cur);
    }
    return [...m.values()].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  }, [realWallets]);
  const paperPositions: any[] = (port.data?.positions ?? []).filter((p: any) => p.is_paper && Number(p.quantity) > 0).sort((a: any, b: any) => Number(b.market_value ?? 0) - Number(a.market_value ?? 0));
  const history: any[] = (fund.data?.recent ?? []).filter((t: any) => histFilter === "all" || (histFilter === "transfer" ? /transfer|send/.test(t.kind) : t.kind.includes(histFilter)));

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-56" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (error) return <Empty title="Couldn't load wallets">{error}</Empty>;
  const caps = data.capabilities, flags = data.flags;

  async function run(key: string, fn: () => Promise<any>, okMsg?: string) {
    setBusy(key);
    try { const r = await fn(); if (okMsg) toast(okMsg, "up"); refresh(); fund.refresh(); return r; }
    catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); } finally { setBusy(null); }
  }
  const has = (pred: (a: any) => boolean) => active.some(pred);

  // Account cards: every connected account, plus "connect" cards for the common ones that are missing.
  const cards: { key: string; icon: any; title: string; sub: string; value: string; tone?: string; badge?: string; action?: React.ReactNode }[] = [];
  for (const a of active) {
    if (a.provider_id === "merod_wallet") continue; // listed with their balances under Merod Wallets
    const g = classify(a).group;
    const icon = a.kind === "paper" ? FlaskConical : a.kind === "wallet" ? Wallet : g === "Crypto exchanges" ? Bitcoin : Building2;
    const val = a.watch_only ? "Signs in wallet" : a.kind === "brokerage" && !a.balance_synced && a.provider_id !== "paper" ? "Not synced" : money(a.cash_balance);
    cards.push({ key: a.id, icon, title: a.kind === "paper" ? "Paper account" : a.label, sub: `${a.kind === "paper" ? "Merod · virtual funds" : `${caps.names?.[a.provider_id] ?? a.provider_id}${a.network ? ` · ${a.network}` : ""}`}`, value: val, badge: a.kind === "paper" || a.environment === "sandbox" ? "Paper" : "Real", tone: a.kind === "paper" || a.environment === "sandbox" ? "warn" : "up" });
  }
  if (owner && realWallets.length) cards.push({ key: "mw", icon: Sparkles, title: `Merod Wallets (${realWallets.length})`, sub: "Solana · signs automatically", value: money(mw.data?.totalUsd), badge: "Real", tone: "up", action: <button onClick={() => go("merod-wallets")} className="text-[11.5px] text-accent-2 hover:underline">Manage</button> });
  if (!has((a) => a.provider_id === "alpaca_trading")) cards.push({ key: "c-alp", icon: Building2, title: "Brokerage · Alpaca", sub: "US stocks & ETFs", value: "Not connected", action: <Link href="/broker-keys" className="text-[11.5px] text-accent-2 hover:underline">Connect Alpaca</Link> });
  if (!has((a) => a.provider_id === "coinbase_advanced")) cards.push({ key: "c-cb", icon: Bitcoin, title: "Coinbase", sub: "Crypto exchange", value: "Not connected", action: <Link href="/broker-keys" className="text-[11.5px] text-accent-2 hover:underline">Add keys</Link> });
  if (!has((a) => a.kind === "wallet" && a.provider_id !== "merod_wallet")) cards.push({ key: "c-ph", icon: Wallet, title: "Phantom · Solana", sub: "Your browser wallet", value: "Not connected", action: <button onClick={() => go("browser-wallets")} className="text-[11.5px] text-accent-2 hover:underline">Connect</button> });

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 text-[12.5px]">
        {[["overview", "Overview"], ["accounts", "Accounts"], ["buy", "Buy & sell"], ["card", "Buy with card"], ["stocks", "Tokenized stocks"], ["tokens", "Token balances"], ["history", "Statements"]].map(([id, l]) => (
          <button key={id} onClick={() => go(id)} className="rounded-lg border border-line px-2.5 py-1 text-muted hover:border-accent/40 hover:text-text">{l}</button>
        ))}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setModal("external")}><Plus className="size-3.5" /> Connect wallet</Button>
          <Button size="sm" variant="secondary" onClick={() => setModal("byo")}><KeyRound className="size-3.5" /> Connect broker</Button>
        </span>
      </nav>

      <PendingSignatures />

      {/* Total balance + funding */}
      <div id="overview" className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="surface rounded-2xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Total balance · {view === "real" ? "real money" : "paper"} accounts</div>
              <div className="num mt-1 text-[38px] font-semibold leading-none tracking-tight">{money(total).replace(/\.(\d\d)$/, "")}<span className="text-[22px] text-muted">.{money(total).split(".")[1] ?? "00"}</span></div>
              <div className="mt-1.5 text-[12px] text-muted">{view === "real" ? `${realWallets.length} Merod wallet${realWallets.length === 1 ? "" : "s"} · ${brokers.length} broker account${brokers.length === 1 ? "" : "s"}` : paperSum ? <>Cash {money(paperSum.cash)} · Invested {money(paperSum.invested)} · <span className={paperSum.lifetimePnl >= 0 ? "text-up" : "text-down"}>{paperSum.lifetimePnl >= 0 ? "+" : ""}{money(paperSum.lifetimePnl)} all time</span></> : "Virtual funds"}</div>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg-2/60 p-0.5 text-[12px]">
              <button onClick={() => setView("paper")} className={cx("flex items-center gap-1 rounded-md px-2.5 py-1", view === "paper" ? "nav-active" : "text-muted")}><FlaskConical className="size-3.5" />Paper</button>
              <button onClick={() => setView("real")} className={cx("flex items-center gap-1 rounded-md px-2.5 py-1", view === "real" ? "bg-down-soft text-down" : "text-muted")}><Coins className="size-3.5" />Real money</button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => { funding("deposit"); go("funding"); }} className="flex h-9 items-center gap-1.5 rounded-lg bg-grad px-3.5 text-[13px] font-semibold text-bg"><ArrowDownToLine className="size-4" />Deposit</button>
            <button onClick={() => { funding("withdraw"); go("funding"); }} className="flex h-9 items-center gap-1.5 rounded-lg border border-line-2 px-3.5 text-[13px] hover:border-accent/50"><ArrowUpFromLine className="size-4" />Withdraw</button>
            <button onClick={() => { funding("send"); go("funding"); }} className="flex h-9 items-center gap-1.5 rounded-lg border border-line-2 px-3.5 text-[13px] hover:border-accent/50"><ArrowLeftRight className="size-4" />Transfer</button>
            <button onClick={() => go("card")} className="flex h-9 items-center gap-1.5 rounded-lg border border-accent/40 px-3.5 text-[13px] text-accent-2 hover:bg-accent-soft"><Sparkles className="size-4" />Buy with card</button>
          </div>
          {view === "paper" ? <div className="mt-3"><ValueHistory initial="1M" height={170} /></div> : (
            <p className="mt-4 rounded-xl border border-line bg-bg-2/50 p-3 text-[12px] text-muted">Real-money balances are read live from the blockchain and your brokers. {owner ? <>Fund a Merod Wallet with a card above, or send SOL/USDC to its address.</> : <>Connect a broker or wallet to see real balances.</>}</p>
          )}
        </section>
        <BuyWithCard />
      </div>

      {/* Accounts */}
      <section id="accounts">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">Accounts</h3><span className="text-[11px] text-faint">Stock brokerage funds and crypto wallet funds are kept separate</span></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((c) => (
            <div key={c.key} className="surface rounded-2xl p-3.5">
              <div className="flex items-start justify-between gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg border border-line bg-panel-2 text-accent-2"><c.icon className="size-4" /></span>
                {c.badge && <span className={cx("rounded-md px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide", c.tone === "warn" ? "bg-warn-soft text-warn" : "bg-up-soft text-up")}>{c.badge.toUpperCase()}</span>}
              </div>
              <div className="mt-2 truncate text-[13px] font-semibold">{c.title}</div>
              <div className="truncate text-[11px] text-muted">{c.sub}</div>
              <div className="mt-2 flex items-end justify-between gap-2"><span className={cx("num text-[17px] font-semibold", c.value === "Not connected" && "text-[13px] font-normal text-faint")}>{c.value}</span>{c.action}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Buy anything */}
      <BuyFromMerod />
      <TokenizedStocks />

      {/* History + token balances */}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <section id="history" className="surface rounded-2xl p-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Receipt className="size-4 text-accent-2" /> Transaction history</h3>
            <div className="flex gap-1 text-[11.5px]">{(["all", "deposit", "withdrawal", "transfer"] as const).map((f) => <button key={f} onClick={() => setHistFilter(f)} className={cx("rounded-md px-2 py-0.5 capitalize", histFilter === f ? "nav-active" : "text-muted hover:text-text")}>{f === "all" ? "All" : `${f}s`}</button>)}</div>
          </header>
          {history.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[600px] text-[12.5px]">
                <thead className="text-[10.5px] uppercase tracking-wide text-faint"><tr className="border-b border-line"><th className="py-2 text-left font-medium">Date</th><th className="text-left font-medium">Type</th><th className="text-left font-medium">Account</th><th className="text-left font-medium">Asset</th><th className="text-right font-medium">Amount</th><th className="pl-3 text-left font-medium">Status</th><th /></tr></thead>
                <tbody>{history.map((t: any) => (
                  <tr key={t.id} className="border-b border-line/50">
                    <td className="py-2 text-muted">{new Date(t.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="capitalize">{t.kind.replace(/_/g, " ")}</td>
                    <td className="text-muted">{t.account_label}</td>
                    <td>{t.symbol ?? "USD"}</td>
                    <td className={cx("num text-right", Number(t.amount) >= 0 ? "text-up" : "text-text")}>{Number(t.amount) >= 0 ? "+" : "−"}{t.symbol ? qty(Math.abs(t.amount)) : usd(Math.abs(t.amount))}</td>
                    <td className="pl-3">{t.status ? <StatusPill status={t.status} /> : <span className="text-up">completed</span>}</td>
                    <td className="text-right"><button className="text-[11.5px] text-muted hover:text-text" onClick={async () => setReceipt((await api(`/api/wallet/funding?receipt=${t.id}`)).receipt)}>Receipt</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="py-10 text-center text-[12.5px] text-muted">No {histFilter === "all" ? "" : `${histFilter} `}transactions yet.</p>}
        </section>

        <section id="tokens" className="surface rounded-2xl p-4">
          <header className="flex items-center justify-between"><h3 className="text-[15px] font-semibold">Token balances</h3><span className="text-[11px] text-faint">{view === "real" ? "Merod Wallets" : "Paper positions"}</span></header>
          <ul className="mt-2 divide-y divide-line/50">
            {view === "real" ? (tokens.length ? tokens.map((t) => (
              <li key={t.mint} className="flex items-center gap-2.5 py-2">
                <AssetIcon symbol={t.symbol} size={26} />
                <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{t.symbol}</div><div className="num truncate text-[11px] text-muted">{Number(t.amount).toLocaleString("en-US", { maximumFractionDigits: 6 })} {t.symbol}</div></div>
                <div className="num text-right text-[13px]">{t.usd ? money(t.usd) : "—"}</div>
              </li>
            )) : <li className="py-8 text-center text-[12px] text-muted">{owner ? "No tokens in your Merod Wallets yet." : "Real token balances appear here once a wallet is funded."}</li>)
              : (paperPositions.length ? paperPositions.slice(0, 12).map((p: any) => (
                <li key={p.id ?? `${p.account_id}-${p.asset_id}`} className="flex items-center gap-2.5 py-2">
                  <AssetIcon symbol={p.symbol} logo={p.logo_url} size={26} />
                  <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{p.symbol}</div><div className="num truncate text-[11px] text-muted">{qty(p.quantity)} {p.symbol}</div></div>
                  <div className="text-right"><div className="num text-[13px]">{money(p.market_value)}</div><div className={cx("num text-[11px]", Number(p.unrealized_pnl) >= 0 ? "text-up" : "text-down")}>{Number(p.unrealized_pnl) >= 0 ? "+" : ""}{money(p.unrealized_pnl)}</div></div>
                </li>
              )) : <li className="py-8 text-center text-[12px] text-muted">No paper positions yet.</li>)}
          </ul>
        </section>
      </div>

      <FundingPanel onChanged={() => { refresh(); fund.refresh(); }} />

      <div id="merod-wallets"><MerodWalletCard /></div>
      <div id="browser-wallets"><BrowserWallets onChanged={refresh} /></div>

      {/* More ways to connect */}
      <div className="grid gap-3 md:grid-cols-3">
        <section className="surface rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles className="size-4 text-accent-2" /> Embedded wallet (Privy)</h3>
          <p className="mt-1 text-[12px] text-muted">A wallet secured by Privy. Merod stores only the public address.</p>
          <div className="mt-3 flex gap-2">
            {(["solana", "ethereum"] as const).map((c) => (
              <Button key={c} size="sm" variant="outline" disabled={!caps.privy || !flags.embedded_wallets} loading={busy === `privy-${c}`}
                onClick={() => run(`privy-${c}`, () => api("/api/wallet/privy", { method: "POST", json: { chain: c } }), "Embedded wallet created")}>{c === "solana" ? "Solana" : "Ethereum"}</Button>
            ))}
          </div>
          {(!caps.privy || !flags.embedded_wallets) && <p className="mt-2 text-[11px] text-warn">{!flags.embedded_wallets ? "Disabled by the administrator." : "Unavailable: Privy isn't connected in the Integration Center yet."}</p>}
        </section>
        <section className="surface rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Building2 className="size-4 text-accent-2" /> Existing brokerage (SnapTrade)</h3>
          <p className="mt-1 text-[12px] text-muted">Link Schwab, Fidelity, Robinhood and others to sync holdings.</p>
          <Button size="sm" className="mt-3" variant="outline" disabled={!caps.snaptrade} loading={busy === "snap"}
            onClick={() => run("snap", async () => { const r = await api("/api/wallet/snaptrade", { method: "POST" }); window.location.href = r.url; })}>Connect brokerage</Button>
          {!caps.snaptrade && <p className="mt-2 text-[11px] text-warn">Unavailable: SnapTrade isn&apos;t configured by the administrator yet.</p>}
        </section>
        <section className="surface rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><KeyRound className="size-4 text-accent-2" /> Your own broker keys</h3>
          <p className="mt-1 text-[12px] text-muted">Alpaca, Tradier, Coinbase, Kraken, Gemini and more with keys you paste on <Link href="/broker-keys" className="text-accent-2">Broker & AI keys</Link>.</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {Object.entries(caps.byo).map(([pid, envs]: any) => Object.entries(envs).map(([env, st]: any) => <Badge key={pid + env} tone={st === "connected" ? "up" : "warn"}>{caps.names?.[pid] ?? pid} {env}: {st}</Badge>))}
            {!Object.values(caps.byo).some((e: any) => Object.keys(e).length) && <span className="text-faint">No keys pasted yet.</span>}
          </div>
        </section>
      </div>

      {/* Connected accounts (manage) */}
      <section className="surface rounded-2xl p-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Link2 className="size-4 text-accent-2" /> Connected accounts</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-wide text-faint"><tr className="border-b border-line"><th className="py-2 text-left font-medium">Account</th><th className="text-left font-medium">Provider</th><th className="text-left font-medium">Address / ref</th><th className="text-right font-medium">Balance</th><th className="pl-3 text-left font-medium">Status</th><th /></tr></thead>
            <tbody>{active.map((a: any) => (
              <tr key={a.id} className="border-b border-line/50">
                <td className="py-2"><div className="font-medium">{a.label}</div><div className="text-[11px] text-muted">{a.kind}{a.network ? ` · ${a.network}` : ""}{a.positions ? ` · ${a.positions} positions` : ""}</div></td>
                <td><Badge>{a.provider_id}</Badge>{a.byo_keys && <Badge tone="accent" className="ml-1">own keys</Badge>}{(a.kind === "paper" || a.environment === "sandbox") && <Badge tone="warn" className="ml-1">paper</Badge>}</td>
                <td className="font-mono text-[11px] text-muted">{a.external_ref ? <button className="inline-flex items-center gap-1 hover:text-text" onClick={() => { navigator.clipboard?.writeText(a.external_ref); toast("Copied"); }}>{a.external_ref.length > 16 ? `${a.external_ref.slice(0, 8)}…${a.external_ref.slice(-6)}` : a.external_ref}<Copy className="size-3" /></button> : "—"}</td>
                <td className="num text-right">{a.watch_only ? <span className="text-[11px] text-faint">watch-only</span> : a.kind === "brokerage" && !a.balance_synced && a.provider_id !== "paper" ? <span className="text-[11px] text-faint">not synced</span> : usd(a.cash_balance)}</td>
                <td className="pl-3"><StatusPill status={a.status} /></td>
                <td className="space-x-1 text-right">
                  {a.provider_id === "alpaca_trading" && a.byo_keys && <Button size="sm" variant="ghost" loading={busy === `sync-${a.id}`} onClick={() => run(`sync-${a.id}`, () => api(`/api/wallet/accounts/${a.id}`, { method: "POST" }), "Balance refreshed")}><RefreshCw className="size-3.5" /></Button>}
                  {a.provider_id === "snaptrade" && <Button size="sm" variant="ghost" loading={busy === "snapsync"} onClick={() => run("snapsync", () => api("/api/wallet/snaptrade"), "Synced")}><RefreshCw className="size-3.5" /></Button>}
                  {a.kind !== "paper" && <Button size="sm" variant="ghost" loading={busy === `dc-${a.id}`} onClick={() => confirm(`Disconnect ${a.label}?`) && run(`dc-${a.id}`, () => api(`/api/wallet/accounts/${a.id}`, { method: "DELETE" }), "Disconnected")}><Unplug className="size-3.5" /></Button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-faint">Merod never asks for your seed phrase. Only Merod Wallet keys are held by Merod (encrypted). <ChevronRight className="size-3" /></p>
      </section>

      <Modal open={modal === "external"} onClose={() => setModal(null)} title="Connect an existing wallet">
        <p className="text-sm text-muted">Enter your <b>public</b> address only. It will be watch-only until transaction signing is enabled.</p>
        <div className="mt-4 space-y-3">
          <Select label="Network" value={ext.network} onChange={(e) => setExt({ ...ext, network: e.target.value })}>{data.networks.map((n: any) => <option key={n.id} value={n.id}>{n.label}</option>)}</Select>
          <Input label="Public address" value={ext.address} onChange={(e) => setExt({ ...ext, address: e.target.value.trim() })} placeholder={ext.network === "solana" ? "e.g. 7xKX…" : "0x…"} />
          <Input label="Label (optional)" value={ext.label} onChange={(e) => setExt({ ...ext, label: e.target.value })} />
          <p className="flex gap-1.5 text-[11px] text-warn"><ShieldAlert className="size-3.5 shrink-0" /> Never paste a private key or seed phrase anywhere on Merod.</p>
          <div className="flex justify-end"><Button variant="primary" loading={busy === "ext"} onClick={() => run("ext", () => api("/api/wallet/accounts", { method: "POST", json: { type: "external_wallet", ...ext } }), "Wallet connected").then((r) => r && setModal(null))}>Connect</Button></div>
        </div>
      </Modal>

      <Modal open={modal === "byo"} onClose={() => setModal(null)} title="Connect my own brokerage or exchange account">
        <p className="text-sm text-muted">Uses the keys you pasted and tested on <Link className="text-accent-2" href="/broker-keys">Broker & AI keys</Link>. Your keys are only ever used for your own account.</p>
        <div className="mt-4 space-y-3">
          <Select label="Broker or exchange" value={byo.providerId} onChange={(e) => setByo({ ...byo, providerId: e.target.value, environment: ["alpaca_trading", "tradier", "gemini"].includes(e.target.value) ? byo.environment : "production" })}>{Object.entries(caps.names ?? { alpaca_trading: "Alpaca", tradier: "Tradier" }).map(([id, n]: any) => <option key={id} value={id}>{n}</option>)}</Select>
          <Select label="Environment" value={byo.environment} onChange={(e) => setByo({ ...byo, environment: e.target.value })}>{["alpaca_trading", "tradier", "gemini"].includes(byo.providerId) && <option value="sandbox">Paper / sandbox (no real money)</option>}<option value="production">Live (real money)</option></Select>
          {byo.providerId === "tradier" && <Input label="Tradier account number" value={byo.externalRef} onChange={(e) => setByo({ ...byo, externalRef: e.target.value })} />}
          <Input label="Label (optional)" value={byo.label} onChange={(e) => setByo({ ...byo, label: e.target.value })} />
          <div className="flex justify-end"><Button variant="primary" loading={busy === "byo"} onClick={() => run("byo", () => api("/api/wallet/accounts", { method: "POST", json: { type: "byo_broker", ...byo, externalRef: byo.externalRef || undefined } }), "Brokerage connected").then((r) => r && setModal(null))}>Connect</Button></div>
        </div>
      </Modal>

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Transaction receipt">
        {receipt && (
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Reference</dt><dd className="break-all font-mono text-xs">{receipt.id}</dd>
            <dt className="text-muted">Type</dt><dd>{receipt.kind}</dd>
            <dt className="text-muted">Status</dt><dd><StatusPill status={receipt.status} /></dd>
            <dt className="text-muted">Account</dt><dd>{receipt.account_label} ({receipt.provider_id})</dd>
            <dt className="text-muted">Asset</dt><dd>{receipt.symbol ?? "USD"}</dd>
            <dt className="text-muted">Amount</dt><dd className="num">{receipt.amount}</dd>
            <dt className="text-muted">USD value</dt><dd className="num">{receipt.amount_usd != null ? usd(Math.abs(receipt.amount_usd)) : "—"}</dd>
            {receipt.tx_hash && <><dt className="text-muted">Tx hash</dt><dd className="break-all font-mono text-xs">{receipt.tx_hash}</dd></>}
            <dt className="text-muted">Time</dt><dd>{new Date(receipt.created_at).toLocaleString()}</dd>
            <dt className="text-muted">Details</dt><dd><pre className="whitespace-pre-wrap text-xs text-muted">{JSON.stringify(receipt.receipt, null, 2)}</pre></dd>
          </dl>
        )}
      </Modal>
    </div>
  );
}

export default function WalletPage() { return <Suspense><WalletInner /></Suspense>; }
