"use client";
import { NewsFeed } from "@/components/NewsFeed";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Star, Filter, Plus, Trash2, ListPlus } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Card, Badge, Pills, Sparkline, Skeleton, Empty, ChangeText, AssetIcon, Input, Select, Button, Modal, SourceBadge, useToast, cx } from "@/components/ui";
import { price, compact, usd, ago } from "@/lib/format";
import { TradabilityBadge } from "@/components/terminal/TradabilityBadge";

type Tab = "trending" | "new" | "gainers" | "losers" | "volume" | "cap" | "articles";
const SORT: Record<Tab, string> = { trending: "volume", new: "new", gainers: "gainers", losers: "losers", volume: "volume", cap: "cap", articles: "volume" };

function DiscoverInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const tabParam = sp.get("tab") ?? "";
  const [tab, setTab] = useState<Tab>(tabParam in SORT ? (tabParam as Tab) : "trending");
  // Menu links (Stocks / Crypto / Articles) change the URL while this page stays open.
  useEffect(() => { setTab((t) => (tabParam in SORT ? (tabParam as Tab) : t === "articles" ? "trending" : t)); }, [tabParam]);
  const [term, setTerm] = useState(sp.get("q") ?? "");
  const [debounced, setDebounced] = useState(term);
  const clsParam = sp.get("class");
  const [cls, setCls] = useState<"" | "stocks" | "crypto">(clsParam === "stocks" || clsParam === "crypto" ? clsParam : "");
  // The menu's Stocks / Crypto links change ?class= while this page stays open.
  useEffect(() => { setCls(clsParam === "stocks" || clsParam === "crypto" ? clsParam : ""); }, [clsParam]);
  const [venue, setVenue] = useState("");
  const [minCap, setMinCap] = useState("");
  const [maxCap, setMaxCap] = useState("");
  const [minLiq, setMinLiq] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [listModal, setListModal] = useState(tabParam === "watchlist");
  useEffect(() => { const t = setTimeout(() => setDebounced(term), 200); return () => clearTimeout(t); }, [term]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ sort: SORT[tab], limit: "100" });
    if (debounced) p.set("q", debounced);
    if (cls) p.set("class", cls);
    if (venue) p.set("venue", venue);
    if (minCap) p.set("minCap", String(Number(minCap) * 1e6));
    if (maxCap) p.set("maxCap", String(Number(maxCap) * 1e6));
    if (minLiq) p.set("minLiq", minLiq);
    if (tab === "new") p.set("new", "1");
    return p.toString();
  }, [tab, debounced, cls, venue, minCap, maxCap, minLiq]);
  const res = useApi<any>(`/api/assets?${qs}`, { refreshMs: 20000 });
  const wl = useApi<any>("/api/watchlists");
  const watched = new Set<string>((wl.data?.watchlists ?? []).flatMap((w: any) => w.items.map((i: any) => i.id)));
  const isAddress = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(debounced.trim());

  async function toggleWatch(assetId: string) {
    try { const r = await api("/api/watchlists/items", { method: "POST", json: { assetId, action: "toggle" } }); toast(r.watched ? "Added to watchlist" : "Removed from watchlist"); wl.refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  const resetFilters = () => { setCls(""); setVenue(""); setMinCap(""); setMaxCap(""); setMinLiq(""); };
  const filterCount = [cls, venue, minCap, maxCap, minLiq].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="page-title">Discover</h1><p className="text-sm text-muted">Search every stock and token Merod knows about — by ticker, name or contract address.</p></div>
        <Button variant="secondary" onClick={() => setListModal(true)}><ListPlus className="size-4" /> Watchlists</Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Ticker, name, or contract / mint address…"
            className="h-11 w-full rounded-xl border border-line bg-panel/70 pl-9 pr-3 text-sm outline-none placeholder:text-faint focus:border-accent" />
        </div>
        <Button variant={showFilters ? "outline" : "secondary"} onClick={() => setShowFilters(!showFilters)}><Filter className="size-4" /> Filters{filterCount ? ` (${filterCount})` : ""}</Button>
      </div>

      {showFilters && (
        <Card className="fade-up">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Select label="Asset class" value={cls} onChange={(e) => setCls(e.target.value as any)}><option value="">All</option><option value="stocks">Stocks & ETFs</option><option value="crypto">Crypto</option></Select>
            <Select label="Exchange / blockchain" value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="">All venues</option>
              {(res.data?.venues ?? []).map((v: any) => <option key={v.venue} value={v.venue}>{v.venue} ({v.n})</option>)}
            </Select>
            <Input label="Min market cap ($M)" type="number" min="0" value={minCap} onChange={(e) => setMinCap(e.target.value)} />
            <Input label="Max market cap ($M)" type="number" min="0" value={maxCap} onChange={(e) => setMaxCap(e.target.value)} />
            <Input label="Min liquidity ($)" type="number" min="0" value={minLiq} onChange={(e) => setMinLiq(e.target.value)} />
            <div className="flex items-end"><Button variant="ghost" onClick={resetFilters} className="w-full">Reset</Button></div>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto">
        <Pills value={tab} onChange={setTab} options={[
          { value: "trending", label: "Trending" }, { value: "new", label: "New tokens" }, { value: "gainers", label: "Top gainers" },
          { value: "losers", label: "Top losers" }, { value: "volume", label: "Volume" }, { value: "cap", label: "Market cap" },
          { value: "articles", label: "Articles" },
        ]} />
      </div>

      {tab === "articles" ? <NewsFeed category={cls} query={debounced} /> : (
      <Card pad={false}>
        {!res.data ? <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : res.data.assets.length === 0 ? (
          <div className="p-4">
            <Empty title={isAddress ? "No asset with that address yet" : tab === "new" ? "No newly launched tokens" : "No matching assets"}>
              {isAddress ? "Merod discovers tokens through connected providers (DEX Screener, Helius, Birdeye). Once connected, new contracts are imported automatically."
                : tab === "new" ? "Connect DEX Screener and Helius in the Integration Center to stream new launches." : "Try a different search or reset filters."}
            </Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="w-10 px-4 py-2.5"></th><th className="px-2 py-2.5">Asset</th><th className="px-2 py-2.5">Venue</th><th className="px-2 py-2.5 text-right">Price</th>
                  <th className="px-2 py-2.5 text-right">24h</th><th className="px-2 py-2.5">24h trend</th><th className="px-2 py-2.5 text-right">Volume</th>
                  <th className="px-2 py-2.5 text-right">Mkt cap</th><th className="px-2 py-2.5 text-right">Liquidity</th><th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {res.data.assets.map((a: any) => (
                  <tr key={a.id} onClick={() => router.push(`/terminal/${a.id}`)} className="cursor-pointer border-b border-line/60 hover:bg-panel-2/70">
                    <td className="px-4 py-2" onClick={(e) => { e.stopPropagation(); toggleWatch(a.id); }}>
                      <Star className={cx("size-4", watched.has(a.id) ? "fill-warn text-warn" : "text-faint hover:text-warn")} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2.5">
                        <AssetIcon symbol={a.symbol} logo={a.logo_url} />
                        <div className="min-w-0"><div className="flex items-center gap-1.5 font-semibold">{a.symbol}{a.lifecycle === "bonding_curve" && <Badge tone="accent">Bonding curve</Badge>}{a.lifecycle === "graduated" && <Badge>Graduated</Badge>}</div>
                          <div className="max-w-[220px] truncate text-xs text-muted">{a.name}</div></div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted">{a.venue}<div className="max-w-[120px] truncate font-mono text-[10px] text-faint" title={a.identifier}>{a.identifier === "native" ? "native" : a.identifier}</div></td>
                    <td className="num px-2 py-2 text-right">{price(a.last_price)}</td>
                    <td className="px-2 py-2 text-right"><ChangeText value={a.change_24h} /></td>
                    <td className="px-2 py-2"><Sparkline data={(a.spark ?? []).map(Number)} width={88} height={26} /></td>
                    <td className="num px-2 py-2 text-right text-muted">{compact(a.volume_24h)}</td>
                    <td className="num px-2 py-2 text-right text-muted">{a.market_cap ? usd(a.market_cap, { compact: true }) : "—"}</td>
                    <td className="num px-2 py-2 text-right text-muted">{a.liquidity_usd ? usd(a.liquidity_usd, { compact: true }) : "—"}</td>
                    <td className="px-2 py-2"><div className="flex flex-wrap gap-1"><TradabilityBadge a={a} />{a.risk_flags?.filter((f: string) => f !== "demo_data").slice(0, 2).map((f: string) => <Badge key={f} tone="warn">{f.replace(/_/g, " ")}</Badge>)}</div></td>
                    <td className="px-4 py-2 text-right text-xs"><div className="flex flex-col items-end gap-0.5"><SourceBadge source={a.price_source} /><span className="text-faint">{ago(a.price_updated_at)}</span></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}

      <WatchlistModal open={listModal} onClose={() => setListModal(false)} data={wl.data} refresh={wl.refresh} />
    </div>
  );
}

function WatchlistModal({ open, onClose, data, refresh }: { open: boolean; onClose: () => void; data: any; refresh: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try { await api("/api/watchlists", { method: "POST", json: { name } }); setName(""); refresh(); } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  async function del(id: string) { await api(`/api/watchlists?id=${id}`, { method: "DELETE" }); refresh(); }
  async function remove(assetId: string, watchlistId: string) { await api("/api/watchlists/items", { method: "POST", json: { assetId, watchlistId, action: "remove" } }); refresh(); }
  return (
    <Modal open={open} onClose={onClose} title="Saved watchlists" wide>
      <div className="flex gap-2"><Input className="flex-1" placeholder="New watchlist name" value={name} onChange={(e) => setName(e.target.value)} /><Button variant="primary" loading={busy} onClick={create} className="h-10"><Plus className="size-4" /> Create</Button></div>
      <div className="mt-4 space-y-4">
        {(data?.watchlists ?? []).map((w: any) => (
          <div key={w.id} className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between"><div className="font-semibold">{w.name} <span className="text-xs text-faint">({w.items.length})</span></div>
              <button onClick={() => del(w.id)} className="rounded p-1 text-faint hover:text-down" aria-label="Delete watchlist"><Trash2 className="size-4" /></button></div>
            {w.items.length === 0 ? <p className="mt-2 text-xs text-faint">Star assets to add them (stars add to your first watchlist).</p> : (
              <div className="mt-2 divide-y divide-line/60">
                {w.items.map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <Link href={`/terminal/${i.id}`} onClick={onClose} className="font-semibold hover:text-accent-2">{i.symbol} <span className="text-xs font-normal text-muted">{i.venue}</span></Link>
                    <span className="flex items-center gap-3"><span className="num">{price(i.last_price)}</span><ChangeText value={i.change_24h} className="text-xs" />
                      <button onClick={() => remove(i.id, w.id)} className="text-faint hover:text-down" aria-label="Remove"><Trash2 className="size-3.5" /></button></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function DiscoverPage() { return <Suspense><DiscoverInner /></Suspense>; }
