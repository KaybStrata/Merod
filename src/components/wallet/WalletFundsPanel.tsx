"use client";
import Link from "next/link";
import { Wallet, ArrowDownToLine, ArrowLeftRight, Plus, Link2, FlaskConical, Zap, Building2, Bitcoin, ArrowRight } from "lucide-react";
import { useApi } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { cx } from "@/components/ui";
import { classify } from "./AccountPicker";

const money = (n: number | null | undefined) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Wallet & Funds at a glance (Home and Trade): paper funds, real-money wallets/brokers, quick actions. */
export function WalletFundsPanel({ compact = false }: { compact?: boolean }) {
  const { user } = useShell();
  const owner = user.role === "super_admin";
  const accts = useApi<any>("/api/wallet/accounts", { refreshMs: 60000 });
  const mw = useApi<any>(owner ? "/api/wallet/merod" : null, { refreshMs: 60000 });
  const list: any[] = (accts.data?.accounts ?? []).filter((a: any) => a.status === "active");
  const paper = list.filter((a) => classify(a).mode === "paper");
  const live = list.filter((a) => classify(a).mode === "live" && a.provider_id !== "merod_wallet");
  const liveOn = !!(accts.data?.flags?.live_crypto_trading || accts.data?.flags?.live_brokerage_trading);
  const wallets: any[] = mw.data?.wallets ?? [];
  const paperTotal = paper.reduce((s, a) => s + Number(a.cash_balance ?? 0), 0);
  const realTotal = (mw.data?.totalUsd ?? 0) + live.filter((a) => a.kind === "brokerage").reduce((s, a) => s + Number(a.cash_balance ?? 0), 0);
  return (
    <section className="surface rounded-2xl p-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Wallet className="size-4 text-accent-2" /> Wallet & Funds</h3>
        <span className={cx("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", liveOn ? "bg-down-soft text-down" : "bg-warn-soft text-warn")}><span className={cx("size-1.5 rounded-full", liveOn ? "bg-down pulse-dot" : "bg-warn")} />{liveOn ? "REAL MONEY ON" : "PAPER ONLY"}</span>
      </header>
      <div className={cx("mt-3 grid gap-2", compact ? "grid-cols-2" : "grid-cols-2")}>
        <div className="rounded-xl border border-line bg-bg-2/50 p-3"><div className="flex items-center gap-1.5 text-[11px] text-muted"><FlaskConical className="size-3.5" /> Paper</div><div className="num mt-1 text-[1.15rem] font-semibold">{money(paperTotal)}</div><div className="text-[10.5px] text-faint">{paper.length} account{paper.length === 1 ? "" : "s"}</div></div>
        <div className="rounded-xl border border-down/20 bg-bg-2/50 p-3"><div className="flex items-center gap-1.5 text-[11px] text-muted"><Zap className="size-3.5 text-down" /> Real money</div><div className="num mt-1 text-[1.15rem] font-semibold">{money(realTotal)}</div><div className="text-[10.5px] text-faint">{wallets.length + live.length} wallet{wallets.length + live.length === 1 ? "" : "s"} & accounts</div></div>
      </div>
      {!compact && (wallets.length > 0 || live.length > 0) && (
        <ul className="mt-3 space-y-1 text-[12.5px]">
          {wallets.map((w) => <li key={w.id} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><Wallet className="size-3.5 shrink-0 text-accent-2" /><span className="truncate">{w.name}</span></span><span className="num text-muted">{money(w.balances?.totalUsd)}</span></li>)}
          {live.map((a) => { const I = a.kind === "wallet" ? Wallet : classify(a).group === "Crypto exchanges" ? Bitcoin : Building2; return <li key={a.id} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><I className="size-3.5 shrink-0 text-accent-2" /><span className="truncate">{a.label}</span></span><span className="num text-muted">{a.kind === "brokerage" ? money(Number(a.cash_balance ?? 0)) : "signs in wallet"}</span></li>; })}
        </ul>
      )}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Link href="/wallet#buy" className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-grad text-[12.5px] font-semibold"><ArrowLeftRight className="size-3.5" /> Buy & sell</Link>
        <Link href="/wallet" className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-2 text-[12.5px] hover:border-accent/50"><ArrowDownToLine className="size-3.5" /> Deposit</Link>
        {owner && <Link href="/wallet#merod-wallets" className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-2 text-[12.5px] hover:border-accent/50"><Plus className="size-3.5" /> New wallet</Link>}
        <Link href="/broker-keys" className={cx("flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-2 text-[12.5px] hover:border-accent/50", !owner && "col-span-2")}><Link2 className="size-3.5" /> Connect broker</Link>
      </div>
      <Link href="/wallet" className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted hover:text-text">Open Wallet & Funds <ArrowRight className="size-3" /></Link>
    </section>
  );
}
