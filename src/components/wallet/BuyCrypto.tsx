"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CreditCard, Apple, Landmark, ExternalLink, ShieldCheck, Plus, LineChart, RefreshCw, ArrowRight, Info } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { AssetIcon, ChangeText, cx, useToast } from "@/components/ui";
import { price } from "@/lib/format";

/**
 * Buy crypto with a card / Apple Pay / bank, straight into the user's own Solana wallet.
 * The provider (MoonPay or Transak) takes the payment and sends the coins on-chain; Merod never holds the money.
 */
export function BuyWithCard() {
  const toast = useToast();
  const { user } = useShell();
  const owner = user.role === "super_admin";
  const { data, refresh } = useApi<any>("/api/funding/onramp");
  const [wallet, setWallet] = useState("");
  const [coin, setCoin] = useState("usdc_sol");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const wallets: any[] = data?.wallets ?? [];
  useEffect(() => { if (!wallet && wallets[0]) setWallet(wallets[0].id); }, [wallets, wallet]);
  useEffect(() => { if (data?.coins?.length && !data.coins.some((c: any) => c.code === coin)) setCoin(data.coins[0].code); }, [data, coin]);
  const providerName = data?.provider === "transak" ? "Transak" : "MoonPay";

  async function open() {
    setBusy(true);
    // Open the window first (inside the click) so popup blockers allow it, then point it at the signed URL.
    const win = window.open("about:blank", "merod-onramp", "popup,width=480,height=780");
    try {
      const r: any = await api("/api/funding/onramp", { method: "POST", json: { accountId: wallet, currency: coin, amountUsd: Number(amount) || undefined } });
      if (win) win.location.href = r.url; else window.location.href = r.url;
      toast(`${providerName} opened. Coins go straight to your wallet when the payment clears.`, "up");
    } catch (e: any) { win?.close(); toast(e.message, "down"); } finally { setBusy(false); }
  }
  async function newWallet() {
    try { await api("/api/wallet/merod", { method: "POST", json: { action: "create" } }); toast("Merod Wallet created", "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }

  return (
    <section id="card" className="surface rounded-2xl p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Funding</div>
          <h3 className="text-[15px] font-semibold">Buy crypto with <span className="serif-accent text-[17px] text-accent-2">card</span></h3>
        </div>
        <div className="flex gap-1 text-[10.5px] text-muted">
          <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5"><CreditCard className="size-3" />Card</span>
          <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5"><Apple className="size-3" />Apple Pay</span>
          <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5"><Landmark className="size-3" />Bank</span>
        </div>
      </header>

      {!data ? <div className="mt-3 h-40 animate-pulse rounded-xl bg-panel-2" /> : (
        <>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-[22px] text-muted">$</span>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="num w-full bg-transparent text-[30px] font-semibold tracking-tight outline-none" aria-label="Amount in dollars" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {[50, 100, 250, 500, 1000].map((v) => <button key={v} onClick={() => setAmount(String(v))} className={cx("rounded-md border px-2 py-0.5 text-[11.5px]", Number(amount) === v ? "border-accent/60 text-accent-2" : "border-line text-muted hover:text-text")}>${v.toLocaleString()}</button>)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-[10.5px] uppercase tracking-wide text-faint">Coin
              <select value={coin} onChange={(e) => setCoin(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel-2 px-2 text-[13px] normal-case tracking-normal text-text">
                {(data.coins ?? []).map((c: any) => <option key={c.code} value={c.code}>{c.symbol} · {c.name}</option>)}
              </select>
            </label>
            <label className="text-[10.5px] uppercase tracking-wide text-faint">Into wallet
              <select value={wallet} onChange={(e) => setWallet(e.target.value)} disabled={!wallets.length} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel-2 px-2 text-[13px] normal-case tracking-normal text-text disabled:opacity-50">
                {wallets.map((w) => <option key={w.id} value={w.id}>{w.label} · {w.address.slice(0, 4)}…{w.address.slice(-4)}</option>)}
                {!wallets.length && <option>No Solana wallet yet</option>}
              </select>
            </label>
          </div>

          {!data.configured ? (
            <div className="mt-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-[12px] text-warn">
              <div className="font-semibold">Card payments aren&apos;t switched on yet</div>
              <p className="mt-1 text-warn/90">Merod needs an on-ramp partner key: <b>MoonPay</b> (publishable key, plus the secret key to sign the address) or <b>Transak</b> (API key). Sign up with them, then paste the key in {owner ? <Link href="/broker-keys" className="underline">Broker & AI keys → Platform APIs</Link> : "Platform APIs (ask the platform owner)"}{owner && <> or <Link href="/admin/integrations" className="underline">Admin → Integrations</Link></>}.</p>
            </div>
          ) : !wallets.length ? (
            <div className="mt-3 rounded-xl border border-line bg-bg-2/60 p-3 text-[12px] text-muted">
              You need a Solana wallet to receive the coins. {owner ? <button onClick={newWallet} className="ml-1 inline-flex items-center gap-1 rounded-md bg-grad px-2 py-0.5 text-[11.5px] font-semibold text-bg"><Plus className="size-3" />Create a Merod Wallet</button> : <>Connect Phantom or Solflare below.</>}
            </div>
          ) : (
            <button onClick={open} disabled={busy || !wallet || !(Number(amount) > 0)} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-grad text-[13.5px] font-semibold text-bg disabled:opacity-50">
              {busy ? "Opening…" : <>Continue to {providerName} <ExternalLink className="size-3.5" /></>}
            </button>
          )}
          <ul className="mt-3 space-y-1 text-[11px] text-muted">
            <li className="flex gap-1.5"><ShieldCheck className="mt-px size-3.5 shrink-0 text-up" /><span>You pay {data.configured ? providerName : "the on-ramp"} directly. The coins land in <b className="text-text">your own wallet</b>. Merod never holds your money.</span></li>
            <li className="flex gap-1.5"><ArrowRight className="mt-px size-3.5 shrink-0 text-accent-2" /><span>Then buy <b className="text-text">any</b> Solana coin with that USDC/SOL in <a href="#buy" className="underline">Buy any coin</a>.</span></li>
            {data.env === "sandbox" && <li className="text-warn">Sandbox keys: test payments only, no real coins.</li>}
          </ul>
        </>
      )}
    </section>
  );
}

/** Tokenized stocks (xStocks) a Merod Wallet can buy with USDC/SOL through Jupiter. */
export function TokenizedStocks() {
  const { data, refresh, loading } = useApi<any>("/api/funding/xstocks");
  const [q, setQ] = useState("");
  const [force, setForce] = useState(false);
  const rows: any[] = (data?.rows ?? []).filter((r: any) => !q || `${r.symbol} ${r.name}`.toLowerCase().includes(q.toLowerCase()));
  async function reload() { setForce(true); try { await api("/api/funding/xstocks?refresh=1"); } catch {} refresh(); setForce(false); }
  const buy = (r: any) => window.dispatchEvent(new CustomEvent("merod-buy", { detail: { id: r.id, symbol: r.symbol, name: r.name, asset_class: "crypto", venue: "solana", logo_url: r.logo } }));
  return (
    <section id="stocks" className="surface rounded-2xl p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Stocks from your wallet</div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold"><LineChart className="size-4 text-accent-2" /> Tokenized <span className="serif-accent text-[17px] text-accent-2">stocks</span> <span className="text-[11px] font-normal text-faint">{data?.rows?.length ?? 0}</span></h3>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="AAPL, TSLA, NVDA…" className="h-8 w-40 rounded-lg border border-line bg-panel-2/60 px-2.5 text-[12.5px] outline-none focus:border-accent/60" />
          <button onClick={reload} disabled={force} className="flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[12px] text-muted hover:text-text"><RefreshCw className={cx("size-3.5", force && "animate-spin")} /></button>
        </div>
      </header>
      <p className="mt-2 flex gap-1.5 rounded-lg border border-line bg-bg-2/50 px-2.5 py-1.5 text-[11px] text-muted"><Info className="mt-px size-3.5 shrink-0 text-accent-2" />xStocks are Solana tokens that track a company&apos;s share price, bought from your Merod Wallet with USDC/SOL via Jupiter. They are <b className="text-text">not shares held at a broker</b>: no voting rights, and availability depends on your country. For real shares, trade through Alpaca.</p>
      {loading && !data ? <div className="mt-3 h-32 animate-pulse rounded-xl bg-panel-2" /> : !rows.length ? (
        <p className="mt-3 text-center text-[12px] text-muted">{data?.error ? `Couldn't reach Jupiter's token list (${data.error}).` : q ? "No match." : "No tokenized stocks found yet."}</p>
      ) : (
        <div className="mt-3 grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-bg-2/40 px-2.5 py-2">
              <AssetIcon symbol={r.symbol} logo={r.logo} size={26} />
              <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{r.symbol}</div><div className="truncate text-[11px] text-muted">{r.name}</div></div>
              <div className="text-right"><div className="num text-[12.5px]">{price(r.price)}</div><ChangeText value={r.change24h} className="text-[11px]" /></div>
              <button onClick={() => buy(r)} className="rounded-md bg-grad px-2 py-1 text-[11.5px] font-semibold text-bg">Buy</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
