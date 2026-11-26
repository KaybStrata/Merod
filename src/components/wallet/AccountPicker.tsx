"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, FlaskConical, Zap, Wallet, Building2, Bitcoin, Plus, Link2, AlertTriangle } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { cx, useToast } from "@/components/ui";

const EXCHANGES = new Set(["coinbase_advanced", "kraken", "gemini", "bitstamp", "cryptocom", "binance_us", "okx_us"]);
export type TradeMode = "paper" | "live";

/** Which accounts can trade this asset, and in which mode. */
export function classify(a: any) {
  const sandbox = a.kind === "paper" || a.environment === "sandbox";
  const group = a.kind === "paper" ? "Merod paper" : a.provider_id === "merod_wallet" ? "Merod Wallets" : a.kind === "wallet" ? "Your wallets" : EXCHANGES.has(a.provider_id) ? "Crypto exchanges" : "Stock brokers";
  return { mode: (sandbox ? "paper" : "live") as TradeMode, group };
}
export function canTrade(a: any, asset: any | null) {
  if (!asset) return true;
  const stock = ["stock", "etf", "option"].includes(asset.asset_class);
  if (a.kind === "paper") return true;
  if (stock) return a.kind === "brokerage" && !EXCHANGES.has(a.provider_id);
  if (a.kind === "wallet") return a.network === asset.venue;
  return EXCHANGES.has(a.provider_id);
}
const ICON: Record<string, any> = { "Merod paper": FlaskConical, "Merod Wallets": Wallet, "Your wallets": Wallet, "Crypto exchanges": Bitcoin, "Stock brokers": Building2 };

/**
 * Paper / Real money switch + grouped account list for a trade, with one-click fixes for what's missing
 * (create a Merod Wallet, connect Alpaca paper/live from keys you already pasted, turn on real money).
 */
export function AccountPicker({ asset, value, onChange, compact = false }: { asset: any | null; value: string; onChange: (id: string, mode: TradeMode) => void; compact?: boolean }) {
  const { user } = useShell();
  const owner = user.role === "super_admin";
  const toast = useToast();
  const accts = useApi<any>("/api/wallet/accounts");
  const [mode, setMode] = useState<TradeMode>("paper");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const list: any[] = (accts.data?.accounts ?? []).filter((a: any) => a.status === "active");
  const byo = accts.data?.capabilities?.byo ?? {};
  const liveOn = !!(accts.data?.flags?.live_crypto_trading || accts.data?.flags?.live_brokerage_trading);
  const stock = asset && ["stock", "etf", "option"].includes(asset.asset_class);
  const liveFlag = stock ? accts.data?.flags?.live_brokerage_trading : accts.data?.flags?.live_crypto_trading;
  const options = useMemo(() => list.filter((a) => classify(a).mode === mode).map((a) => ({ ...a, ok: canTrade(a, asset), group: classify(a).group })), [list, mode, asset]);
  const usable = options.filter((o) => o.ok);
  const selected = list.find((a) => a.id === value);
  useEffect(() => {
    if (!accts.data) return;
    if (selected && classify(selected).mode === mode && canTrade(selected, asset)) return;
    const pick = usable.find((o) => o.provider_id === "merod_wallet") ?? usable.find((o) => o.kind !== "paper") ?? usable[0];
    onChange(pick?.id ?? "", mode);
  }, [accts.data, mode, asset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function connectBroker(providerId: string, environment: "sandbox" | "production") {
    setBusy(providerId + environment);
    try { const r: any = await api("/api/wallet/accounts", { method: "POST", json: { type: "byo_broker", providerId, environment } }); toast(`${providerId === "alpaca_trading" ? "Alpaca" : providerId} ${environment === "sandbox" ? "paper" : "live"} account connected`, "up"); await accts.refresh(); onChange(r.id, environment === "sandbox" ? "paper" : "live"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function newWallet() {
    setBusy("wallet");
    try { const r: any = await api("/api/wallet/merod", { method: "POST", json: { action: "create" } }); toast(`Merod Wallet created. Fund ${r.address.slice(0, 4)}…${r.address.slice(-4)} with SOL or USDC to trade.`, "up"); await accts.refresh(); onChange(r.id, "live"); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  const has = (pred: (a: any) => boolean) => list.some(pred);
  // What's missing for this trade, with a fix button.
  const fixes: { key: string; text: string; action?: () => void; href?: string; label: string }[] = [];
  if (mode === "paper" && stock && byo.alpaca_trading?.sandbox === "connected" && !has((a) => a.provider_id === "alpaca_trading" && a.environment === "sandbox"))
    fixes.push({ key: "alp-s", text: "Your Alpaca paper keys are saved but not connected as an account.", action: () => connectBroker("alpaca_trading", "sandbox"), label: "Connect Alpaca paper" });
  if (mode === "live") {
    if (owner && !liveFlag) fixes.push({ key: "rm", text: `Real ${stock ? "stock" : "crypto"} trading is off.`, label: "Turn on in the top bar (Real money switch, needs 2FA)", href: "#" });
    if (stock && !has((a) => a.kind === "brokerage" && !EXCHANGES.has(a.provider_id) && a.environment !== "sandbox")) {
      if (byo.alpaca_trading?.production === "connected") fixes.push({ key: "alp-p", text: "Your Alpaca live keys are saved but not connected.", action: () => connectBroker("alpaca_trading", "production"), label: "Connect Alpaca live" });
      else fixes.push({ key: "alp-k", text: "No live stock broker connected.", href: "/broker-keys", label: "Add Alpaca live keys" });
    }
    if (!stock && asset?.venue === "solana" && owner && !has((a) => a.provider_id === "merod_wallet")) fixes.push({ key: "mw", text: "No Merod Wallet yet.", action: newWallet, label: "Create Merod Wallet" });
    if (!stock && asset && asset.venue !== "solana" && !has((a) => EXCHANGES.has(a.provider_id) && a.environment !== "sandbox")) fixes.push({ key: "ex", text: `${asset.symbol} isn't on Solana: it needs a crypto exchange.`, href: "/broker-keys", label: "Add exchange keys" });
  }
  const groups = [...new Set(options.map((o) => o.group))];
  const bal = (a: any) => a.kind === "paper" || a.cash_balance != null ? `$${Number(a.cash_balance ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
  return (
    <div className={cx("space-y-2", compact && "text-[12.5px]")}>
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg-2/60 p-1">
        <button onClick={() => setMode("paper")} className={cx("flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-medium", mode === "paper" ? "nav-active" : "text-muted hover:text-text")}><FlaskConical className="size-3.5" /> Paper</button>
        <button onClick={() => setMode("live")} className={cx("flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-medium", mode === "live" ? "bg-down-soft text-down ring-1 ring-down/40" : "text-muted hover:text-text")}><Zap className="size-3.5" /> Real money{liveOn && <span className="size-1.5 rounded-full bg-down pulse-dot" />}</button>
      </div>
      <div className="relative">
        <button onClick={() => setOpen(!open)} className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-line bg-panel-2/70 px-3 text-left text-sm hover:border-line-2">
          <span className="flex min-w-0 items-center gap-2">{selected ? (() => { const I = ICON[classify(selected).group] ?? Wallet; return <><I className="size-4 shrink-0 text-accent-2" /><span className="truncate">{selected.kind === "paper" ? "Merod paper account" : selected.label}</span></>; })() : <span className="text-muted">{mode === "live" ? "No real-money account for this asset" : "Choose an account"}</span>}</span>
          <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-11 z-30 max-h-80 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-2xl" onMouseLeave={() => setOpen(false)}>
            {groups.map((g) => { const I = ICON[g] ?? Wallet; return (
              <div key={g} className="py-1">
                <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10.5px] uppercase tracking-wide text-faint"><I className="size-3" />{g}</div>
                {options.filter((o) => o.group === g).map((o) => (
                  <button key={o.id} disabled={!o.ok} onClick={() => { onChange(o.id, mode); setOpen(false); }} title={o.ok ? "" : "Can't trade this asset"}
                    className={cx("flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40", o.id === value ? "bg-accent-soft" : "hover:bg-panel-2")}>
                    <span className="flex min-w-0 items-center gap-2">{o.id === value ? <Check className="size-3.5 text-accent-2" /> : <span className="w-3.5" />}<span className="truncate">{o.kind === "paper" ? "Merod paper account" : o.label}</span></span>
                    <span className="shrink-0 text-[11px] text-muted">{o.ok ? bal(o) : "not for this asset"}</span>
                  </button>
                ))}
              </div>
            ); })}
            {!options.length && <p className="px-3 py-3 text-[12px] text-muted">No {mode === "live" ? "real-money" : "paper"} accounts yet.</p>}
            <div className="mt-1 border-t border-line pt-1">
              {owner && <button onClick={newWallet} disabled={busy === "wallet"} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-muted hover:bg-panel-2 hover:text-text"><Plus className="size-3.5" /> New Merod Wallet</button>}
              <Link href="/broker-keys" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-muted hover:bg-panel-2 hover:text-text"><Link2 className="size-3.5" /> Connect a broker or exchange</Link>
            </div>
          </div>
        )}
      </div>
      {fixes.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/25 bg-warn-soft px-2.5 py-1.5 text-[11.5px] text-warn">
          <span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5" />{f.text}</span>
          {f.action ? <button onClick={f.action} disabled={!!busy} className="rounded-md bg-grad px-2 py-0.5 text-[11px] font-semibold">{f.label}</button>
            : f.href && f.href !== "#" ? <Link href={f.href} className="rounded-md border border-warn/40 px-2 py-0.5 text-[11px]">{f.label}</Link> : <span className="text-[11px]">{f.label}</span>}
        </div>
      ))}
      {mode === "live" && selected && classify(selected).mode === "live" && <p className="text-[10.5px] text-down">Real money: this order moves real funds in {selected.label}.</p>}
    </div>
  );
}
