"use client";
import { SectionTabs } from "@/components/SectionTabs";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Wallet, Plus, Building2, KeyRound, ArrowDownToLine, ArrowUpFromLine, Receipt, RefreshCw, Unplug, Copy, ShieldAlert, Sparkles, PieChart } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usd, ago, qty } from "@/lib/format";
import { Badge, Button, Card, Empty, Input, Modal, Select, Skeleton, StatusPill, useToast } from "@/components/ui";
import { FundingPanel } from "@/components/wallet/FundingPanel";

function WalletInner() {
  const toast = useToast();
  const params = useSearchParams();
  const { data, error, loading, refresh } = useApi<any>("/api/wallet/accounts");
  const funding = useApi<any>("/api/wallet/funding");
  const [modal, setModal] = useState<null | "external" | "byo" | "withdraw" | "deposit">(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ext, setExt] = useState({ network: "solana", address: "", label: "" });
  const [byo, setByo] = useState({ providerId: "alpaca_trading", environment: "sandbox", label: "", externalRef: "" });
  const [wd, setWd] = useState({ accountId: "", amount: "", destination: "", code: "" });

  useEffect(() => {
    if (params.get("snaptrade") === "done") api("/api/wallet/snaptrade").then((r) => { toast(`Synced ${r.synced} brokerage account(s)`, "up"); refresh(); }).catch((e) => toast(e.message, "down"));
  }, []); // eslint-disable-line

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  if (error) return <Empty title="Couldn't load wallets">{error}</Empty>;
  const caps = data.capabilities, flags = data.flags;
  const active = data.accounts.filter((a: any) => a.status !== "disconnected");
  const wallets = active.filter((a: any) => a.kind === "wallet");

  async function run(key: string, fn: () => Promise<any>, okMsg?: string) {
    setBusy(key);
    try { const r = await fn(); if (okMsg) toast(okMsg, "up"); refresh(); funding.refresh(); return r; }
    catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <SectionTabs tabs={[{ href: "/portfolio", label: "Portfolio", icon: PieChart }, { href: "/wallet", label: "Wallet & funding", icon: Wallet }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Wallet & Funding</h1>
          <p className="text-sm text-muted">Stock brokerage funds and crypto wallet funds are accounted for separately. Merod never asks for private keys or seed phrases.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModal("external")}><Plus className="size-4" /> Connect wallet</Button>
          <Button variant="secondary" onClick={() => setModal("byo")}><KeyRound className="size-4" /> Connect my broker (own keys)</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Embedded wallet (Privy)" icon={<Sparkles className="size-4 text-accent-2" />}>
          <p className="text-sm text-muted">Create a Merod wallet secured by Privy. Merod stores only the public address.</p>
          <div className="mt-3 flex gap-2">
            {(["solana", "ethereum"] as const).map((c) => (
              <Button key={c} size="sm" variant="outline" disabled={!caps.privy || !flags.embedded_wallets} loading={busy === `privy-${c}`}
                onClick={() => run(`privy-${c}`, () => api("/api/wallet/privy", { method: "POST", json: { chain: c } }), "Embedded wallet created")}>{c === "solana" ? "Solana" : "Ethereum"}</Button>
            ))}
          </div>
          {(!caps.privy || !flags.embedded_wallets) && <p className="mt-2 text-[11px] text-warn">{!flags.embedded_wallets ? "Disabled by the administrator." : "Unavailable: Privy isn't connected in the Integration Center yet."}</p>}
        </Card>
        <Card title="Existing brokerage (SnapTrade)" icon={<Building2 className="size-4 text-accent-2" />}>
          <p className="text-sm text-muted">Link Schwab, Fidelity, Robinhood and other supported brokerages to sync holdings.</p>
          <Button size="sm" className="mt-3" variant="outline" disabled={!caps.snaptrade} loading={busy === "snap"}
            onClick={() => run("snap", async () => { const r = await api("/api/wallet/snaptrade", { method: "POST" }); window.location.href = r.url; })}>Connect brokerage</Button>
          {!caps.snaptrade && <p className="mt-2 text-[11px] text-warn">Unavailable: SnapTrade isn't configured by the administrator yet.</p>}
        </Card>
        <Card title="Your own broker keys" icon={<KeyRound className="size-4 text-accent-2" />}>
          <p className="text-sm text-muted">Trade your own brokerage (Alpaca, Tradier) or crypto exchange account (Coinbase, Kraken, Gemini, Bitstamp, Crypto.com, Binance.US, OKX) with keys you paste on <Link href="/broker-keys" className="text-accent-2">Broker Keys</Link>.</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {Object.entries(caps.byo).map(([pid, envs]: any) => Object.entries(envs).map(([env, st]: any) => <Badge key={pid + env} tone={st === "connected" ? "up" : "warn"}>{caps.names?.[pid] ?? pid} {env}: {st}</Badge>))}
            {!Object.values(caps.byo).some((e: any) => Object.keys(e).length) && <span className="text-faint">No keys pasted yet.</span>}
          </div>
          <p className="mt-2 text-[11px] text-muted">Real-money orders only go through when the platform owner has turned on live trading.</p>
        </Card>
      </div>

      <Card title="Connected accounts" icon={<Wallet className="size-4 text-accent-2" />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs text-faint"><tr className="border-b border-line"><th className="py-2 text-left font-medium">Account</th><th className="text-left font-medium">Provider</th><th className="text-left font-medium">Address / ref</th><th className="text-right font-medium">Balance</th><th className="pl-3 text-left font-medium">Status</th><th /></tr></thead>
            <tbody>{active.map((a: any) => (
              <tr key={a.id} className="border-b border-line/60">
                <td className="py-2.5"><div className="font-medium">{a.label}</div><div className="text-xs text-muted">{a.kind}{a.network ? ` · ${a.network}` : ""}{a.positions ? ` · ${a.positions} positions` : ""}</div></td>
                <td><Badge>{a.provider_id}</Badge>{a.byo_keys && <Badge tone="accent" className="ml-1">own keys</Badge>}{(a.kind === "paper" || a.environment === "sandbox") && <Badge tone="warn" className="ml-1">paper</Badge>}</td>
                <td className="font-mono text-xs text-muted">{a.external_ref ? <button className="inline-flex items-center gap-1 hover:text-text" onClick={() => { navigator.clipboard?.writeText(a.external_ref); toast("Copied"); }}>{a.external_ref.length > 16 ? `${a.external_ref.slice(0, 8)}…${a.external_ref.slice(-6)}` : a.external_ref}<Copy className="size-3" /></button> : "—"}</td>
                <td className="num text-right">{a.watch_only ? <span className="text-xs text-faint">watch-only until signing is enabled</span> : a.kind === "brokerage" && !a.balance_synced && a.provider_id !== "paper" ? <span className="text-xs text-faint">not synced</span> : usd(a.cash_balance)}</td>
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
      </Card>

      <FundingPanel onChanged={() => { refresh(); funding.refresh(); }} />

      <Card title="Funding history & receipts" icon={<Receipt className="size-4 text-accent-2" />}>
        {funding.data?.recent?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-xs text-faint"><tr className="border-b border-line"><th className="py-2 text-left font-medium">When</th><th className="text-left font-medium">Type</th><th className="text-left font-medium">Asset</th><th className="text-right font-medium">Amount</th><th className="pl-3 text-left font-medium">Account</th><th /></tr></thead>
              <tbody>{funding.data.recent.map((t: any) => (
                <tr key={t.id} className="border-b border-line/60">
                  <td className="py-2 text-muted">{ago(t.created_at)}</td><td><Badge>{t.kind}</Badge></td><td>{t.symbol ?? "USD"}</td>
                  <td className="num text-right">{t.symbol ? qty(Math.abs(t.amount)) : usd(t.amount)}</td><td className="pl-3 text-xs text-muted">{t.account_label}</td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={async () => setReceipt((await api(`/api/wallet/funding?receipt=${t.id}`)).receipt)}>Receipt</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon={<Receipt className="size-5" />} title="No transactions yet" />}
      </Card>

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
        <p className="text-sm text-muted">Uses the keys you pasted and tested on <Link className="text-accent-2" href="/broker-keys">Broker Keys</Link>. Your keys are only ever used for your own account.</p>
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

function Disabled({ text }: { text: string }) {
  return <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">{text}</div>;
}

export default function WalletPage() { return <Suspense><WalletInner /></Suspense>; }
