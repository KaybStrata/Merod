"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Flame, Star, ChevronDown, Plus, Search, Loader2, X } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { AssetIcon, ChangeText, Pills, SourceBadge, cx, useToast } from "@/components/ui";
import { price } from "@/lib/format";

type Row = { id: string; symbol: string; name: string; last_price: number | null; change_24h: number | null; price_source?: string | null; logo_url?: string | null };

function Rows({ rows, empty, onRemove }: { rows: Row[] | null; empty: React.ReactNode; onRemove?: (id: string) => void }) {
  if (!rows) return <div className="flex items-center gap-2 py-3 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Loading…</div>;
  if (!rows.length) return <div className="py-3 text-xs text-muted">{empty}</div>;
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((a) => (
        <li key={a.id} className="group flex items-center gap-2 py-1.5">
          <Link href={`/terminal/${a.id}`} className="flex min-w-0 flex-1 items-center gap-2">
            <AssetIcon symbol={a.symbol} size={22} logo={a.logo_url} />
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{a.symbol}</span><span className="block truncate text-[10px] text-faint">{a.name}</span></span>
            <span className="text-right"><span className="num block text-xs">{price(a.last_price)}</span><ChangeText value={a.change_24h} className="text-[10px]" /></span>
          </Link>
          {onRemove && <button onClick={() => onRemove(a.id)} className="hidden rounded p-0.5 text-faint hover:text-down group-hover:block" title="Remove from my list"><X className="size-3" /></button>}
        </li>
      ))}
    </ul>
  );
}

/** Two expandable button bars: trending/profitable assets, and the user's own list of stocks and crypto. */
export function QuickLists({ myList, onListChange }: { myList: Row[] | undefined; onListChange: () => void }) {
  const [open, setOpen] = useState<"trend" | "mine" | null>("trend");
  const [cls, setCls] = useState<"all" | "crypto" | "stocks">("all");
  const trending = useApi<{ assets: Row[] }>(open === "trend" ? `/api/assets?sort=gainers&limit=6${cls === "all" ? "" : `&class=${cls}`}` : null, { refreshMs: 20000 });
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 1) { setResults([]); return; }
    timer.current = setTimeout(() => {
      api<{ assets: Row[] }>(`/api/assets?q=${encodeURIComponent(q.trim())}&limit=5`).then((r) => setResults(r.assets ?? [])).catch(() => setResults([]));
    }, 250);
  }, [q]);

  async function toggle(id: string, label: string) {
    try {
      const r = await api<{ watched: boolean }>("/api/watchlists/items", { method: "POST", json: { assetId: id, action: "toggle" } });
      toast(r.watched ? `${label} added to your list` : `${label} removed from your list`, r.watched ? "up" : "neutral");
      setQ(""); setResults([]); onListChange();
    } catch (e: any) { toast(e.message, "down"); }
  }

  const bar = (key: "trend" | "mine", icon: React.ReactNode, label: string, sub: string) => (
    <button onClick={() => setOpen(open === key ? null : key)}
      className={cx("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
        open === key ? "border-accent/50 bg-accent-soft" : "border-line bg-panel-2/60 hover:border-line-2")}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-bg-2">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="block truncate text-[11px] text-faint">{sub}</span></span>
      <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open === key && "rotate-180")} />
    </button>
  );

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      {bar("trend", <Flame className="size-4 text-warn" />, "Trending & profitable", "Today's top gainers in crypto and stocks")}
      {open === "trend" && (
        <div className="fade-up rounded-xl border border-line px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <Pills size="sm" value={cls} onChange={setCls} options={[{ value: "all", label: "All" }, { value: "crypto", label: "Crypto" }, { value: "stocks", label: "Stocks" }]} />
            <Link href="/discover?tab=gainers" className="text-[11px] text-accent-2">See all</Link>
          </div>
          <Rows rows={trending.data?.assets ?? null} empty="No movers right now." />
          {trending.data?.assets?.[0]?.price_source && <div className="mt-1 flex justify-end"><SourceBadge source={trending.data.assets[0].price_source} /></div>}
        </div>
      )}

      {bar("mine", <Star className="size-4 text-accent-2" />, "My list", myList?.length ? `${myList.length} stock${myList.length > 1 ? "s" : ""} & coins you follow` : "Your own stocks and crypto")}
      {open === "mine" && (
        <div className="fade-up rounded-xl border border-line px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a stock or coin (e.g. AAPL, solana)"
              className="h-8 w-full rounded-lg border border-line bg-bg-2 pl-7 pr-2 text-xs outline-none focus:border-accent" />
            {results.length > 0 && (
              <ul className="absolute left-0 right-0 top-9 z-20 overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
                {results.map((a) => {
                  const inList = myList?.some((m) => m.id === a.id);
                  return (
                    <li key={a.id}><button onClick={() => toggle(a.id, a.symbol)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-panel-2">
                      <AssetIcon symbol={a.symbol} size={18} logo={a.logo_url} /><span className="font-medium">{a.symbol}</span><span className="min-w-0 flex-1 truncate text-faint">{a.name}</span>
                      {inList ? <span className="text-[10px] text-down">Remove</span> : <Plus className="size-3.5 text-accent-2" />}
                    </button></li>
                  );
                })}
              </ul>
            )}
          </div>
          <Rows rows={myList ?? null} empty="Nothing here yet. Search above to add stocks and coins you want to follow."
            onRemove={(id) => toggle(id, myList?.find((m) => m.id === id)?.symbol ?? "Asset")} />
          <div className="mt-1 flex justify-end"><Link href="/discover?tab=watchlist" className="text-[11px] text-accent-2">Manage lists</Link></div>
        </div>
      )}
    </div>
  );
}
