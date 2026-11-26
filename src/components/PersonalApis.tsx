"use client";
import Link from "next/link";
import { Building2, Bitcoin, Link2, Database, UserRound, ArrowDown, Wallet } from "lucide-react";
import { useApi } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { cx } from "@/components/ui";

const GROUPS = [
  { title: "Stock brokers", icon: Building2, cats: ["stock_execution"] },
  { title: "Crypto exchanges", icon: Bitcoin, cats: ["crypto_exchange"] },
  { title: "On-chain swaps", icon: Link2, cats: ["crypto_execution"] },
  { title: "Market data, wallets & AI", icon: Database, cats: ["market_data", "blockchain_infra", "wallet", "ai"] },
];
const ST: Record<string, [string, string]> = {
  connected: ["Working", "bg-up-soft text-up"], saved: ["Saved · untested", "bg-accent-soft text-accent-2"], untested: ["Saved · untested", "bg-accent-soft text-accent-2"],
  failed: ["Key check failed", "bg-down-soft text-down"], error: ["Key check failed", "bg-down-soft text-down"],
};

/**
 * MY PERSONAL TRADING APIs: the keys you pasted for YOUR OWN accounts (never used for Merod or other users),
 * grouped like the platform section, plus the trading accounts connected from them.
 */
export function PersonalApis() {
  const { user } = useShell();
  const owner = user.role === "super_admin";
  const keys = useApi<any>("/api/me/keys");
  const accts = useApi<any>("/api/wallet/accounts");
  const providers: any[] = keys.data?.providers ?? [];
  const rows: any[] = keys.data?.keys ?? [];
  // One entry per provider+environment (keys are stored per credential name).
  const byPe = new Map<string, any>();
  for (const r of rows) { const k = `${r.provider_id}:${r.environment}`; const cur = byPe.get(k); if (!cur || (cur.status !== "connected" && r.status === "connected")) byPe.set(k, r); }
  const entries = [...byPe.values()].map((r) => ({ ...r, provider: providers.find((p) => p.id === r.provider_id) }));
  const accounts: any[] = (accts.data?.accounts ?? []).filter((a: any) => a.status === "active" && a.kind !== "paper");
  const working = entries.filter((e) => e.status === "connected").length;
  return (
    <section className="rounded-2xl border-2 border-up/35 bg-panel/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><UserRound className="size-5 text-up" /><h2 className="text-[1.25rem] font-semibold">{owner ? "My personal trading APIs" : "My API keys"}</h2>
            <span className="rounded-md bg-up px-2 py-0.5 text-[10px] font-bold text-[#04130d]">{owner ? "SUPER ADMIN · PERSONAL" : "PERSONAL"}</span></div>
          <p className="mt-1 max-w-3xl text-[13px] text-muted">{owner ? "Your own brokerage, exchange and swap keys, for trading your own money as yourself. They're never used for Merod or for any other user." : "Your own brokerage, exchange and swap keys. Merod encrypts them and uses them only for your account."}</p>
        </div>
        <span className="text-[12px] text-muted">{working} working · {entries.length} saved</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {GROUPS.map((g) => {
          const list = entries.filter((e) => g.cats.includes(e.provider?.category));
          return (
            <div key={g.title} className="rounded-xl border border-line bg-bg-2/50 p-3">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><g.icon className="size-4 text-up" />{g.title}</div>
              <ul className="space-y-1">
                {list.map((e) => { const [l, cls] = ST[e.status] ?? [e.status, "bg-panel-2 text-muted"]; return (
                  <li key={`${e.provider_id}${e.environment}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="truncate">{e.provider?.name ?? e.provider_id} <span className="text-[11px] text-faint">{e.environment === "sandbox" ? "paper / sandbox" : "live"}</span></span>
                    <span className={cx("shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", cls)}>{l}</span>
                  </li>
                ); })}
                {!list.length && <li className="text-[11.5px] text-faint">No keys yet.</li>}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-3 rounded-xl border border-line bg-bg-2/50 p-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Wallet className="size-4 text-up" /> Connected trading accounts</div>
        {accounts.length ? (
          <ul className="grid gap-1 sm:grid-cols-2">{accounts.map((a) => <li key={a.id} className="flex items-center justify-between gap-2 text-[12.5px]"><span className="truncate">{a.label}</span><span className={cx("shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]", a.environment === "sandbox" ? "bg-panel-2 text-muted" : "bg-down-soft text-down")}>{a.environment === "sandbox" ? "Paper" : "Real money"}</span></li>)}</ul>
        ) : <p className="text-[11.5px] text-faint">No accounts connected yet. After your keys pass the check, connect the account on <Link href="/wallet" className="underline">Wallet & Funds</Link> (or with the Connect button in any trade box).</p>}
      </div>
      <a href="#my-keys" className="mt-3 inline-flex items-center gap-1 text-[12px] text-up hover:underline"><ArrowDown className="size-3.5" /> Add or edit my keys below</a>
    </section>
  );
}
