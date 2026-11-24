"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Users, Wallet, ExternalLink, Info } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, Card, Empty, cx, useToast } from "@/components/ui";
import { TraderActions } from "@/components/CopyBots";
import { UserApiKeys } from "@/components/UserApiKeys";
import { ago, usd, qty } from "@/lib/format";

type Agg = { key: string; label: string; handle?: string; wallet?: string; copyable: boolean; buys: number; sells: number; usd: number; last: number; lastText: string };
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

/**
 * Who is trading: identifies traders behind trades where that's possible and lets you Follow, Copy or Mimic them.
 *  - Merod traders: people who made their profile and performance public (others stay anonymous).
 *  - On-chain wallets: public Solana wallets swapping the coins you watch (via Birdeye, when connected).
 * Crypto-exchange trades (Coinbase/Kraken/Binance) are anonymous by design, so they can't be identified.
 */
export function WorldTraders({ cryptoSymbols }: { cryptoSymbols: string[] }) {
  const { connected } = useShell();
  const [tab, setTab] = useState<"merod" | "wallets">("wallets");
  const toast = useToast();
  const platform = useApi<any>(tab === "merod" ? "/api/activity?scope=platform&limit=300" : null, { refreshMs: connected ? 20000 : 8000 });
  const onchain = useApi<any>(tab === "wallets" ? `/api/world/onchain?symbols=${encodeURIComponent(cryptoSymbols.slice(0, 8).join(","))}` : null, { refreshMs: 12000 });
  const [following, setFollowing] = useState<Set<string>>(new Set());
  useRealtime((e) => { if (tab === "merod" && e.channel === "activity" && e.type === "trade") platform.refresh(); });

  const merod = useMemo(() => {
    const map = new Map<string, Agg>(); let anon = 0;
    for (const t of platform.data?.trades ?? []) {
      if (!t.handle) { anon++; continue; }
      const a = map.get(t.handle) ?? { key: t.handle, label: t.display_name || t.handle, handle: t.handle, copyable: !!t.copyable, buys: 0, sells: 0, usd: 0, last: 0, lastText: "" };
      const ts = new Date(t.ts).getTime(), notional = Number(t.quantity) * Number(t.price);
      t.side === "buy" ? a.buys++ : a.sells++; a.usd += notional;
      if (ts > a.last) { a.last = ts; a.lastText = `${t.side === "buy" ? "Bought" : "Sold"} ${qty(t.quantity)} ${t.symbol}${t.paper ? " (paper)" : ""}`; }
      map.set(t.handle, a);
    }
    return { list: [...map.values()].sort((x, y) => y.last - x.last), anon };
  }, [platform.data]);

  const wallets = useMemo(() => {
    const map = new Map<string, Agg>();
    for (const t of onchain.data?.trades ?? []) {
      const a = map.get(t.wallet) ?? { key: t.wallet, label: short(t.wallet), wallet: t.wallet, copyable: true, buys: 0, sells: 0, usd: 0, last: 0, lastText: "" };
      t.side === "buy" ? a.buys++ : a.sells++; a.usd += Number(t.usd ?? 0);
      if (t.at > a.last) { a.last = t.at; a.lastText = `${t.side === "buy" ? "Bought" : "Sold"} ${qty(t.amount)} ${t.symbol}${t.usd ? ` (${usd(t.usd, { compact: true })})` : ""}${t.dex ? ` on ${t.dex}` : ""}`; }
      map.set(t.wallet, a);
    }
    return [...map.values()].sort((x, y) => y.usd - x.usd).slice(0, 30);
  }, [onchain.data]);

  async function follow(handle: string) {
    const now = !following.has(handle);
    try { await api("/api/social/follow", { method: "POST", json: { handle, follow: now } }); setFollowing((s) => { const n = new Set(s); now ? n.add(handle) : n.delete(handle); return n; }); toast(now ? `Following @${handle}` : `Unfollowed @${handle}`); }
    catch (e: any) { toast(e.message, "down"); }
  }

  const rows = tab === "merod" ? merod.list : wallets;
  return (
    <Card title={<span className="flex items-center gap-2">Who's trading</span>} icon={<Users className="size-4 text-accent-2" />}
      action={
        <div className="flex gap-1 rounded-lg border border-line bg-bg-2/60 p-0.5">
          {([["wallets", "On-chain wallets", Wallet], ["merod", "Merod traders", Users]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={cx("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium", tab === k ? "bg-accent-soft text-text" : "text-muted hover:text-text")}><Icon className="size-3.5" />{label}</button>
          ))}
        </div>
      }>
      <p className="mb-2 flex gap-1.5 text-[11px] text-faint"><Info className="mt-px size-3 shrink-0" />
        {tab === "wallets" ? "Public Solana wallets swapping the coins you're watching, biggest first. Exchange trades (Coinbase, Kraken, Binance) are anonymous by design, so they can't be traced to a person."
          : "Merod traders who chose to make their trading public. Copy and Mimic need the trader's permission (“Let others copy my trades”)."}</p>

      {tab === "wallets" && onchain.data && !onchain.data.connected ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">Paste a <b className="text-text">Birdeye</b> API key to see which Solana wallets are buying and selling, so you can follow, copy or mimic them. Get one at birdeye.so (API / data services). Press <b className="text-text">Save</b>, then <b className="text-text">Test my keys</b>; wallets appear within seconds.</p>
          <UserApiKeys providers={["birdeye"]} title="Paste your Birdeye API key" onChange={onchain.refresh} />
        </div>
      ) : !(tab === "wallets" ? onchain.data : platform.data) ? <div className="py-4 text-xs text-muted">Loading…</div>
        : rows.length === 0 ? <div className="py-4 text-xs text-muted">{tab === "wallets" ? "No wallet trades for these coins yet." : "No public Merod traders active right now."}</div> : (
        <ul className="divide-y divide-line/60">
          {rows.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {a.handle ? <Link href={`/social/${a.handle}`} className="truncate text-sm font-medium hover:text-accent-2">{a.label} <span className="text-faint">@{a.handle}</span></Link>
                  : <a href={`https://solscan.io/account/${a.wallet}`} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 font-mono text-sm hover:text-accent-2">{a.label}<ExternalLink className="size-3" /></a>}
                {a.handle && !a.copyable && <Badge>copy off</Badge>}
              </span>
              <span className="w-full text-[11px] text-muted sm:w-auto sm:flex-[2]">{a.lastText} · {ago(a.last)}</span>
              <span className="text-[11px]"><span className="text-up">{a.buys}B</span> / <span className="text-down">{a.sells}S</span>{a.usd ? <span className="ml-1 text-faint">{usd(a.usd, { compact: true })}</span> : null}</span>
              <TraderActions handle={a.handle} wallet={a.wallet} copyable={a.copyable} following={a.handle ? following.has(a.handle) : undefined} onFollow={a.handle ? () => follow(a.handle!) : undefined} />
            </li>
          ))}
        </ul>
      )}
      {tab === "merod" && merod.anon > 0 && <p className="mt-2 text-[11px] text-faint">+ {merod.anon} trades by traders who keep their activity private.</p>}
    </Card>
  );
}
