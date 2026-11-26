"use client";
import Link from "next/link";
import { useState } from "react";
import { Building2, Bitcoin, Link2, Database, Plug, ArrowRight, Landmark } from "lucide-react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";

const GROUPS = [
  { title: "Stock brokers", icon: Building2, cats: ["stock_execution"] },
  { title: "Crypto exchanges", icon: Bitcoin, cats: ["crypto_exchange"] },
  { title: "On-chain swaps", icon: Link2, cats: ["crypto_execution"] },
  { title: "Market data, wallets & AI", icon: Database, cats: ["market_data", "blockchain_infra", "wallet", "ai"] },
];
const RANK: Record<string, number> = { production_connected: 6, sandbox_connected: 5, credentials_configured: 4, awaiting_approval: 3, degraded: 2, disabled: 1, not_configured: 0 };
const LABEL: Record<string, [string, string]> = {
  production_connected: ["Live", "bg-up-soft text-up"], sandbox_connected: ["Sandbox", "bg-[rgba(106,168,255,.14)] text-[#8fbcff]"],
  credentials_configured: ["Keys saved", "bg-accent-soft text-accent-2"], awaiting_approval: ["Awaiting approval", "bg-warn-soft text-warn"],
  degraded: ["Degraded", "bg-warn-soft text-warn"], disabled: ["Off", "bg-panel-2 text-muted"], not_configured: ["Not set up", "bg-panel-2 text-faint"],
};

/**
 * MEROD PLATFORM APIs: the keys Merod itself uses on behalf of the platform and every Merod user
 * (set in Admin → Integrations). Read-only here; secrets are never shown.
 */
export function PlatformApis() {
  const { data, error } = useApi<any>("/api/admin/integrations");
  const [all, setAll] = useState(false);
  if (error) return null; // not an admin
  const providers: any[] = data?.providers ?? [];
  const best = (p: any) => (p.envs ?? []).reduce((b: any, e: any) => (RANK[e.status] ?? 0) > (RANK[b?.status] ?? -1) ? e : b, null);
  const connected = providers.filter((p) => (RANK[best(p)?.status] ?? 0) >= 3).length;
  return (
    <section className="rounded-2xl border-2 border-accent/40 bg-panel/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Landmark className="size-5 text-accent-2" /><h2 className="text-[1.25rem] font-semibold">Merod platform APIs</h2>
            <span className="rounded-md bg-grad px-2 py-0.5 text-[10px] font-bold">MEROD · ALL USERS</span></div>
          <p className="mt-1 max-w-3xl text-[13px] text-muted">The crypto, stock broker, swap and data APIs Merod itself runs on. They represent <b className="text-text">Merod and every Merod user</b>: prices, discovery, paper trading, and live routing for anyone without their own keys. Managed by you as super admin in Admin → Integrations.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">{connected} of {providers.length} connected</span>
          <Link href="/admin/integrations" className="flex h-9 items-center gap-1.5 rounded-xl bg-grad px-3 text-sm font-semibold"><Plug className="size-4" /> Manage <ArrowRight className="size-3.5" /></Link>
        </div>
      </div>
      {!data ? <div className="mt-4 h-24 animate-pulse rounded-xl bg-panel-2" /> : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {GROUPS.map((g) => {
            const list = providers.filter((p) => g.cats.includes(p.category)).sort((a, b) => (RANK[best(b)?.status] ?? 0) - (RANK[best(a)?.status] ?? 0));
            const shown = all ? list : list.filter((p) => (RANK[best(p)?.status] ?? 0) >= 1);
            return (
              <div key={g.title} className="rounded-xl border border-line bg-bg-2/50 p-3">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><g.icon className="size-4 text-accent-2" />{g.title}<span className="ml-auto text-[11px] font-normal text-faint">{list.length}</span></div>
                <ul className="space-y-1">
                  {shown.map((p) => { const b = best(p); const [l, cls] = LABEL[b?.status ?? "not_configured"] ?? LABEL.not_configured; return (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="truncate">{p.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5">{b?.stats?.requests_24h > 0 && <span className="text-[10px] text-faint">{b.stats.requests_24h} calls/24h</span>}<span className={cx("rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", cls)}>{l}</span></span>
                    </li>
                  ); })}
                  {!shown.length && <li className="text-[11.5px] text-faint">None set up.</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <button onClick={() => setAll(!all)} className="mt-3 text-[11.5px] text-muted hover:text-text">{all ? "Hide providers that aren't set up" : "Show every available provider"}</button>
    </section>
  );
}
