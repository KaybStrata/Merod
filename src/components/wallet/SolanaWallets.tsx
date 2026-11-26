"use client";
import { useEffect, useState } from "react";
import { Copy, ExternalLink, Wallet, PenLine, ShieldCheck, Send, Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { Modal, cx, useToast } from "@/components/ui";
import { AccountPicker, type TradeMode } from "./AccountPicker";

/* ───────────── Browser wallets (Phantom / Solflare) ───────────── */
type WalletId = "phantom" | "solflare";
function provider(id: WalletId): any {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return id === "phantom" ? (w.phantom?.solana?.isPhantom ? w.phantom.solana : w.solana?.isPhantom ? w.solana : null) : w.solflare?.isSolflare ? w.solflare : null;
}
const INSTALL: Record<WalletId, string> = { phantom: "https://phantom.app/download", solflare: "https://solflare.com/download" };
const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };

/** Sign a Jupiter swap waiting in an order with Phantom or Solflare, then hand it back to Merod to execute. */
export async function signOrderWithWallet(order: any, prefer?: WalletId) {
  const tx64 = order.unsigned_tx?.tx;
  if (!tx64) throw new Error("This order has no transaction to sign");
  const ids: WalletId[] = prefer ? [prefer] : ["phantom", "solflare"];
  const id = ids.find((i) => provider(i));
  if (!id) throw new Error("Install Phantom or Solflare to sign this trade");
  const p = provider(id);
  await p.connect();
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(b64ToBytes(tx64));
  const signed = await p.signTransaction(tx);
  return api(`/api/orders/${order.id}`, { method: "POST", json: { action: "signed", signedTransaction: bytesToB64(signed.serialize()) } });
}

export function BrowserWallets({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [ready, setReady] = useState<Record<WalletId, boolean>>({ phantom: false, solflare: false });
  const accts = useApi<any>("/api/wallet/accounts");
  useEffect(() => { const t = setTimeout(() => setReady({ phantom: !!provider("phantom"), solflare: !!provider("solflare") }), 400); return () => clearTimeout(t); }, []);
  const connected: any[] = (accts.data?.accounts ?? []).filter((a: any) => a.kind === "wallet" && a.network === "solana" && a.provider_id === "external" && a.status !== "disconnected");
  async function connect(id: WalletId) {
    const p = provider(id);
    if (!p) { window.open(INSTALL[id], "_blank"); return; }
    try {
      const r = await p.connect();
      const address = (r?.publicKey ?? p.publicKey)?.toString();
      if (!address) throw new Error("Wallet didn't share an address");
      if (connected.some((a) => a.external_ref === address)) { toast(`${id === "phantom" ? "Phantom" : "Solflare"} is already connected`, "neutral"); return; }
      await api("/api/wallet/accounts", { method: "POST", json: { type: "external_wallet", network: "solana", address, label: `${id === "phantom" ? "Phantom" : "Solflare"} ${address.slice(0, 4)}…${address.slice(-4)}` } });
      toast(`${id === "phantom" ? "Phantom" : "Solflare"} connected. Real Solana trades from it pop up in the wallet for you to approve.`, "up");
      accts.refresh(); onChanged?.();
    } catch (e: any) { toast(e.message ?? "Connection cancelled", "down"); }
  }
  return (
    <section className="surface rounded-2xl p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Wallet className="size-4 text-accent-2" /> Phantom & Solflare</h3>
      <p className="mt-1 text-[12px] text-muted">Connect your own wallet. Merod builds the Jupiter swap, your wallet pops up, you approve. Your keys never leave your wallet.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["phantom", "solflare"] as WalletId[]).map((id) => (
          <button key={id} onClick={() => connect(id)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-2 text-sm font-medium hover:border-accent/50">
            <span className={cx("size-2.5 rounded-full", id === "phantom" ? "bg-[#ab9ff2]" : "bg-[#fc7227]")} />{id === "phantom" ? "Phantom" : "Solflare"}<span className="text-[11px] text-faint">{ready[id] ? "Connect" : "Install"}</span>
          </button>
        ))}
      </div>
      {connected.length > 0 && <ul className="mt-3 space-y-1 text-[12px]">{connected.map((a) => <li key={a.id} className="flex items-center justify-between rounded-lg bg-panel-2/60 px-2.5 py-1.5"><span>{a.label}</span><a href={`https://solscan.io/account/${a.external_ref}`} target="_blank" rel="noreferrer" className="text-muted hover:text-text"><ExternalLink className="size-3.5" /></a></li>)}</ul>}
    </section>
  );
}

/** Orders waiting for a wallet signature, with Sign buttons. */
export function PendingSignatures() {
  const { data, refresh } = useApi<any>("/api/orders?status=open", { refreshMs: 15000 });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const pending: any[] = (data?.orders ?? []).filter((o: any) => o.status === "pending_approval" && o.unsigned_tx?.tx && o.unsigned_tx?.network === "solana");
  if (!pending.length) return null;
  async function sign(o: any, id?: WalletId) {
    setBusy(o.id);
    try { const r: any = await signOrderWithWallet(o, id); toast(r.order?.status === "filled" ? `Swap confirmed on-chain: ${o.symbol ?? ""}` : `Submitted (${r.order?.status})`, "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  return (
    <section className="surface rounded-2xl border-accent/40 p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold"><PenLine className="size-4 text-accent-2" /> Waiting for your signature ({pending.length})</h3>
      <p className="mt-1 text-[11.5px] text-muted">Jupiter quotes expire in about 20 seconds. If signing fails, place the order again for a fresh quote.</p>
      <ul className="mt-2 space-y-1.5">
        {pending.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-panel-2/60 px-3 py-2 text-[12.5px]">
            <span><b className={o.side === "buy" ? "text-up" : "text-down"}>{o.side}</b> {o.symbol ?? "token"} · ${Number(o.notional_usd ?? o.quote?.notionalUsd ?? 0).toFixed(2)} · {o.quote?.route ?? "Jupiter"}</span>
            <span className="flex gap-1.5">
              <button disabled={busy === o.id} onClick={() => sign(o, "phantom")} className="rounded-lg border border-line-2 px-2.5 py-1 text-[11.5px] hover:border-accent/50">Sign with Phantom</button>
              <button disabled={busy === o.id} onClick={() => sign(o, "solflare")} className="rounded-lg border border-line-2 px-2.5 py-1 text-[11.5px] hover:border-accent/50">Sign with Solflare</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────────── Merod Wallet (owner's own Solana wallet in Merod) ───────────── */
/** All Merod Wallets (unlimited): a total, a "New wallet" button, and one panel per wallet. */
export function MerodWalletCard() {
  const { user } = useShell();
  const owner = user.role === "super_admin";
  const { data, refresh } = useApi<any>(owner ? "/api/wallet/merod" : null, { refreshMs: 30000 });
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  if (!owner) return null;
  async function create() {
    if (!data?.exists && !confirm("Create a Merod Wallet? Merod will hold this wallet's key (encrypted) so it can sign trades for you. It's a hot wallet: only fund it with what you're willing to risk.")) return;
    setBusy(true);
    try { const r: any = await api("/api/wallet/merod", { method: "POST", json: { action: "create", name: name || undefined } }); toast(`Wallet created: ${r.address.slice(0, 4)}…${r.address.slice(-4)}. Send SOL or USDC to it to start.`, "up"); setName(""); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  if (!data) return <section className="surface h-40 animate-pulse rounded-2xl" />;
  return (
    <section className="space-y-3">
      <div className="surface rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Sparkles className="size-5 text-accent-2" /> Merod Wallets <span className="text-sm font-normal text-muted">({data.wallets?.length ?? 0})</span></h3>
            <p className="mt-1 max-w-2xl text-[12.5px] text-muted">Your own Solana wallets inside Merod. Make as many as you want, e.g. one for meme coins, one for bots, one for long-term SOL. Each has its own address, caps and balances. Merod keeps every key encrypted; withdrawals need your 2FA code.</p>
          </div>
          {data.exists && <div className="text-right"><div className="text-[11px] text-muted">All wallets</div><div className="num text-[1.6rem] font-semibold">${(data.totalUsd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div><button onClick={() => refresh()} className="ml-auto flex items-center gap-1 text-[11px] text-muted hover:text-text"><RefreshCw className="size-3" /> Refresh</button></div>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name (optional), e.g. Meme coins" className="h-10 w-64 rounded-xl border border-line bg-panel-2/70 px-3 text-sm outline-none focus:border-accent/60" />
          <button onClick={create} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl bg-grad px-4 text-sm font-semibold"><Plus className="size-4" /> {data.exists ? "New wallet" : "Create my Merod Wallet"}</button>
        </div>
        {data.exists && !data.liveCrypto && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">Real crypto trading is off. Turn on the Real money switch in the top bar (needs 2FA) to trade from these wallets.</p>}
      </div>
      {(data.wallets ?? []).map((w: any) => <WalletPanel key={w.id} w={w} onChange={refresh} />)}
    </section>
  );
}

function WalletPanel({ w: data, onChange: refresh }: { w: any; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [wd, setWd] = useState(false); const [to, setTo] = useState(""); const [amt, setAmt] = useState(""); const [code, setCode] = useState("");
  const [lim, setLim] = useState<{ perTradeUsd: number; dailyUsd: number } | null>(null);
  async function save(p: any) { try { await api("/api/wallet/merod", { method: "POST", json: { action: "settings", accountId: data.id, ...p } }); toast("Saved", "up"); refresh(); } catch (e: any) { toast(e.message, "down"); } }
  async function withdraw() {
    setBusy(true);
    try { const r: any = await api("/api/wallet/merod", { method: "POST", json: { action: "withdraw", accountId: data.id, to, amountSol: Number(amt), code } }); toast(`Sent. Signature ${String(r.signature).slice(0, 10)}…`, "up"); setWd(false); setCode(""); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const l = lim ?? data.limits;
  return (
    <section className="surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Wallet className="size-5 text-accent-2" />
            <input defaultValue={data.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== data.name) save({ name: e.target.value }); }} className="w-56 rounded-md border border-transparent bg-transparent px-1 hover:border-line focus:border-accent/60 focus:outline-none" aria-label="Wallet name" />
            <span className="rounded-md bg-down-soft px-1.5 py-0.5 text-[10px] font-semibold text-down">REAL MONEY</span></h3>
          <button onClick={() => { navigator.clipboard.writeText(data.address); toast("Address copied", "neutral"); }} className="mt-1 flex items-center gap-1.5 font-mono text-[12.5px] text-muted hover:text-text">{data.address} <Copy className="size-3.5" /></button>
          <p className="mt-1 text-[11px] text-faint">Deposit: send SOL or USDC (Solana network only) to this address.</p>
        </div>
        <div className="text-right"><div className="num text-[1.6rem] font-semibold">${(data.balances?.totalUsd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div></div>
      </div>
      {data.error && <p className="mt-3 text-[12px] text-down">{data.error}</p>}
      <div className="mt-3 overflow-x-auto"><table className="w-full text-[12.5px]"><thead className="text-left text-[11px] text-muted"><tr><th className="py-1">Asset</th><th className="text-right">Amount</th><th className="text-right">Price</th><th className="text-right">Value</th></tr></thead>
        <tbody>{(data.balances?.tokens ?? []).map((t: any) => <tr key={t.mint} className="border-t border-line/60"><td className="py-1.5"><b>{t.symbol}</b> <span className="text-muted">{t.name}</span></td><td className="num text-right">{t.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td><td className="num text-right">{t.price != null ? `$${t.price.toPrecision(6)}` : "—"}</td><td className="num text-right">{t.usd != null ? `$${t.usd.toFixed(2)}` : "—"}</td></tr>)}</tbody></table></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="text-[11px] text-muted">Max per trade ($)<input type="number" min={1} value={l.perTradeUsd} onChange={(e) => setLim({ ...l, perTradeUsd: Number(e.target.value) })} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel-2 px-2 text-sm text-text" /></label>
        <label className="text-[11px] text-muted">Max per day ($) · spent ${data.spentTodayUsd.toFixed(2)}<input type="number" min={1} value={l.dailyUsd} onChange={(e) => setLim({ ...l, dailyUsd: Number(e.target.value) })} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel-2 px-2 text-sm text-text" /></label>
        <label className="text-[11px] text-muted">Pay for buys with<select value={data.payWith} onChange={(e) => save({ payWith: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel-2 px-2 text-sm text-text"><option value="USDC">USDC</option><option value="SOL">SOL</option></select></label>
        <div className="flex items-end gap-2"><button onClick={() => { save(l); setLim(null); }} className="h-9 flex-1 rounded-lg border border-line-2 text-sm hover:border-accent/50"><ShieldCheck className="mr-1 inline size-4" />Save caps</button><button onClick={() => setWd(true)} className="h-9 flex-1 rounded-lg border border-line-2 text-sm hover:border-accent/50"><Send className="mr-1 inline size-4" />Withdraw</button></div>
      </div>
      <Modal open={wd} onClose={() => setWd(false)} title="Withdraw SOL">
        <div className="space-y-3 text-sm">
          <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="Destination Solana address" className="h-10 w-full rounded-lg border border-line bg-panel-2 px-3 font-mono text-xs" />
          <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Amount (SOL)" className="h-10 w-full rounded-lg border border-line bg-panel-2 px-3" />
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="2FA code" maxLength={8} className="h-10 w-full rounded-lg border border-line bg-panel-2 px-3" />
          <p className="text-[11px] text-faint">Double-check the address: blockchain transfers can&apos;t be reversed. To move tokens, sell them to USDC/SOL first.</p>
          <div className="flex justify-end"><button onClick={withdraw} disabled={busy || !to || !amt || code.length < 6} className="h-10 rounded-xl bg-grad px-4 font-semibold disabled:opacity-50">Send</button></div>
        </div>
      </Modal>
    </section>
  );
}

/* ───────────── Buy anything from Merod ───────────── */
export function BuyFromMerod({ id = "buy" }: { id?: string }) {
  const toast = useToast();
  const [q, setQ] = useState(""); const [results, setResults] = useState<any[]>([]); const [asset, setAsset] = useState<any>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy"); const [usd, setUsd] = useState("25"); const [acct, setAcct] = useState(""); const [mode, setMode] = useState<TradeMode>("paper"); const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.trim().length < 1) { setResults([]); return; } const t = setTimeout(() => api(`/api/assets?q=${encodeURIComponent(q)}&limit=8`).then((r: any) => setResults(r.assets)).catch(() => {}), 150); return () => clearTimeout(t); }, [q]);
  async function go() {
    if (!asset || !acct) return;
    if (mode === "live" && !confirm(`${side === "buy" ? `Buy $${usd} of` : "Sell all of"} ${asset.symbol} with REAL money?`)) return;
    setBusy(true);
    try {
      const r: any = await api("/api/orders", { method: "POST", json: { mode: "place", intent: { asset: { assetId: asset.id }, side, orderType: "market", timeInForce: asset.asset_class === "crypto" ? "gtc" : "day", accountId: acct, ...(side === "buy" ? { notionalUsd: Number(usd) } : { percentOfPosition: 100 }) } } });
      const o = r.order;
      if (o.status === "pending_approval" && o.unsigned_tx?.tx) { toast("Approve the swap in your wallet…", "neutral"); const s: any = await signOrderWithWallet(o); toast(`Swap ${s.order?.status}`, "up"); }
      else toast(o.status === "rejected" || o.status === "failed" ? `${o.status}: ${o.status_reason}` : `${side === "buy" ? "Bought" : "Sold"} ${asset.symbol}: ${o.status.replace("_", " ")}`, o.status === "rejected" || o.status === "failed" ? "down" : "up");
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <section id={id} className={cx("surface rounded-2xl p-5", mode === "live" && "ring-1 ring-down/30")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Search className="size-5 text-accent-2" /> Buy & sell</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">Any coin or stock, in paper or with real money. Solana tokens swap through Jupiter, other coins go to your exchange, stocks to your broker.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-2.5">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-faint">1 · Asset</label>
          <div className="relative">
            <input value={asset ? `${asset.symbol} · ${asset.name}` : q} onChange={(e) => { setAsset(null); setQ(e.target.value); }} placeholder="Search SOL, BONK, BTC, NVDA, AAPL…" className="h-10 w-full rounded-xl border border-line bg-panel-2/70 px-3 text-sm outline-none focus:border-accent/60" />
            {!asset && results.length > 0 && <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">{results.map((a) => <button key={a.id} onClick={() => { setAsset(a); setResults([]); }} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-panel-2"><span><b>{a.symbol}</b> <span className="text-muted">{a.name}</span></span><span className="text-xs text-faint">{a.asset_class === "crypto" ? a.venue : "Stock"}</span></button>)}</div>}
          </div>
          <label className="block pt-1 text-[11px] font-medium uppercase tracking-wide text-faint">2 · Order</label>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg-2/60 p-1">{(["buy", "sell"] as const).map((s) => <button key={s} onClick={() => setSide(s)} className={cx("rounded-lg py-1.5 text-sm font-semibold capitalize", side === s ? (s === "buy" ? "bg-up text-[#04130d]" : "bg-down text-white") : "text-muted")}>{s}</button>)}</div>
            {side === "buy" ? <label className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span><input type="number" min={1} value={usd} onChange={(e) => setUsd(e.target.value)} className="h-10 w-full rounded-xl border border-line bg-panel-2/70 pl-6 pr-2 text-sm" aria-label="Amount in dollars" /></label> : <div className="flex h-10 items-center justify-center rounded-xl border border-line text-[12px] text-muted">Sell whole position</div>}
          </div>
        </div>
        <div className="space-y-2.5">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-faint">3 · Account</label>
          <AccountPicker asset={asset} value={acct} onChange={(i, m) => { setAcct(i); setMode(m); }} />
          <button onClick={go} disabled={busy || !asset || !acct} className={cx("h-11 w-full rounded-xl text-sm font-semibold disabled:opacity-50", mode === "live" ? "bg-down text-white" : "bg-grad")}>
            {busy ? "Working…" : `${side === "buy" ? "Buy" : "Sell"}${asset ? ` ${asset.symbol}` : ""}${mode === "live" ? " · real money" : " · paper"}`}
          </button>
        </div>
      </div>
    </section>
  );
}
