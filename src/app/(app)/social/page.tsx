"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Users, Trophy, PenSquare, Flame, Info, MessagesSquare, Repeat, TrendingUp, Hash, CandlestickChart, Search, X, Crown } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usd, tone } from "@/lib/format";
import { Button, Empty, Skeleton, cx, useToast } from "@/components/ui";
import { usePageTitle, useShell, useRealtime } from "@/components/shell/context";
import { Avatar, PostCard } from "@/components/social/PostCard";

type Tab = "all" | "following" | "trades" | "analysis" | "strategies" | "bookmarks";
const TABS: [Tab, string][] = [["all", "For you"], ["following", "Following"], ["trades", "Verified trades"], ["analysis", "Analysis"], ["strategies", "Strategies"], ["bookmarks", "Saved"]];
const WEEK = 7 * 24 * 3600_000;

/** The Floor: share trades and ideas (trade tags verified against real orders), mimic what works, see what's trending. */
export default function SocialPage() {
  const { user } = useShell();
  usePageTitle({ section: "Insight · Social", title: "The Floor", accent: "Floor" });
  const [tab, setTab] = useState<Tab>("all");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const posts = useApi<{ posts: any[] }>(`/api/social/posts?tab=${tab}`);
  const recent = useApi<{ posts: any[] }>("/api/social/posts?tab=all&limit=100", { refreshMs: 60_000 });
  const board = useApi<any>(`/api/social/leaderboard?mode=${mode}`);
  useRealtime((e) => { if (e.channel === "social" && e.type === "post") { posts.refresh(); recent.refresh(); } });
  const owner = user.role === "super_admin";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <Composer onPosted={() => { posts.refresh(); recent.refresh(); }} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg-2/60 p-1 text-[12.5px]">
            {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx("rounded-lg px-3 py-1", tab === k ? "nav-active" : "text-muted hover:text-text")}>{l}</button>)}
          </div>
          <Link href="/chat" className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted hover:text-text"><MessagesSquare className="size-3.5" /> Community chat</Link>
        </div>
        <section className="surface overflow-hidden rounded-2xl">
          {posts.loading && !posts.data ? <div className="space-y-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
            : posts.error ? <div className="p-4 text-sm text-down">{posts.error}</div>
            : posts.data?.posts.length ? posts.data.posts.map((p) => <FloorPost key={p.id} post={p} me={user.handle} owner={owner} onChange={posts.refresh} copyTradingEnabled={board.data?.copyTradingEnabled} />)
            : <div className="p-6"><Empty icon={<PenSquare className="size-6" />} title={tab === "following" ? "No posts from people you follow" : tab === "bookmarks" ? "Nothing saved yet" : "No posts yet"}>Share your first trade idea above.</Empty></div>}
        </section>
        <p className="flex items-center gap-1.5 text-[11px] text-faint"><Info className="size-3" /> Verified live = a real filled order · Simulated = a paper order · Unverified = opinion. Badges are set by Merod from the order record, never by the poster.</p>
      </div>

      <aside className="space-y-4">
        <Trending posts={recent.data?.posts ?? []} />
        <TopPosters posts={recent.data?.posts ?? []} />
        <section className="surface rounded-2xl p-4">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Trophy className="size-4 text-warn" /> Leaderboard</h3>
            <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-bg-2/60 p-0.5 text-[11px]">
              {(["paper", "live"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cx("rounded-md px-2 py-0.5 capitalize", mode === m ? "nav-active" : "text-muted")}>{m}</button>)}
            </div>
          </header>
          {board.data?.leaders?.length ? (
            <table className="w-full text-[12.5px]">
              <thead className="text-[10.5px] text-faint"><tr><th className="py-1 text-left">#</th><th className="text-left">Trader</th><th className="text-right">P&L</th><th className="text-right">Win</th></tr></thead>
              <tbody>
                {board.data.leaders.slice(0, 10).map((l: any, i: number) => (
                  <tr key={l.handle} className="border-t border-line/60">
                    <td className="py-1.5 text-muted">{i + 1}</td>
                    <td><Link href={`/social/${l.handle}`} className="flex items-center gap-2"><Avatar name={l.display_name} color={l.avatar_color} size={22} /><span className="truncate">@{l.handle}</span></Link></td>
                    <td className={cx("num text-right", tone(l.realized_pnl))}>{usd(l.realized_pnl, { sign: true })}</td>
                    <td className="num text-right text-muted">{l.winRate == null ? "—" : `${l.winRate.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="py-3 text-center text-[12px] text-muted">No ranked traders yet. Turn on “Share performance” in Settings → Privacy to appear here.</p>}
          {mode === "paper" && board.data?.leaders?.length > 0 && <p className="mt-2 text-[10.5px] text-faint">Paper results are simulated.</p>}
        </section>
        <section className="surface rounded-2xl p-4">
          <h3 className="mb-1 flex items-center gap-2 text-[15px] font-semibold"><Flame className="size-4 text-down" /> Popular traders</h3>
          {board.data?.popular?.length ? board.data.popular.map((p: any) => <TraderRow key={p.handle} p={p} />) : <p className="py-3 text-center text-[12px] text-muted">No other traders yet.</p>}
        </section>
      </aside>
    </div>
  );
}

/** A post plus, for other people's tagged trades, "Mimic this trade" (open the same asset to trade) and Mimic the poster (owner). */
function FloorPost({ post, me, owner, onChange, copyTradingEnabled }: { post: any; me: string; owner: boolean; onChange: () => void; copyTradingEnabled?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mine = post.handle === me;
  const trade = (post.tagged ?? [])[0];
  async function mimicPoster() {
    setBusy(true);
    try {
      const r: any = await api("/api/traders", { method: "POST", json: { group: "merod", on: true, targets: [post.handle] } });
      toast(r.done ? `Mimicking @${post.handle}: their next trades are repeated for you (paper)` : r.skipped?.[0] ?? "Couldn't mimic", r.done ? "up" : "down");
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div className="border-b border-line/70 last:border-0">
      <PostCard post={post} me={me} onChange={onChange} copyTradingEnabled={copyTradingEnabled} />
      {!mine && trade && (
        <div className="-mt-2 flex flex-wrap items-center gap-2 px-4 pb-3 pl-[68px]">
          <Link href={`/terminal/${trade.asset_id}`} className="flex h-8 items-center gap-1.5 rounded-lg bg-grad px-3 text-[12px] font-semibold text-bg"><CandlestickChart className="size-3.5" /> Mimic this trade{trade.side ? ` · ${trade.side} ${trade.symbol}` : ` · ${trade.symbol}`}</Link>
          {owner && <button disabled={busy} onClick={mimicPoster} className="flex h-8 items-center gap-1.5 rounded-lg border border-line-2 px-3 text-[12px] text-muted hover:border-accent/50 hover:text-text disabled:opacity-50"><Repeat className="size-3.5" /> Mimic @{post.handle}</button>}
        </div>
      )}
    </div>
  );
}

/** Trending on the Floor: most-tagged assets and hashtags in recent posts (real counts from the feed). */
function Trending({ posts }: { posts: any[] }) {
  const { assets, tags } = useMemo(() => {
    const cut = Date.now() - WEEK;
    const a = new Map<string, { id: string; symbol: string; venue: string; n: number; buys: number; sells: number; ch: number | null }>();
    const t = new Map<string, number>();
    for (const p of posts) {
      if (+new Date(p.created_at) < cut) continue;
      for (const x of p.tagged ?? []) {
        const cur = a.get(x.asset_id) ?? { id: x.asset_id, symbol: x.symbol, venue: x.venue, n: 0, buys: 0, sells: 0, ch: null };
        cur.n++; if (x.side === "buy") cur.buys++; if (x.side === "sell") cur.sells++;
        if (x.entry_price && x.last_price) cur.ch = ((x.last_price - x.entry_price) / x.entry_price) * 100;
        a.set(x.asset_id, cur);
      }
      for (const tag of p.tags ?? []) t.set(tag, (t.get(tag) ?? 0) + 1);
    }
    return { assets: [...a.values()].sort((x, y) => y.n - x.n).slice(0, 8), tags: [...t.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10) };
  }, [posts]);
  return (
    <section className="surface rounded-2xl p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold"><TrendingUp className="size-4 text-accent-2" /> Trending on the Floor</h3>
      <p className="text-[11px] text-faint">Most-tagged in posts this week</p>
      {assets.length ? (
        <ul className="mt-2">
          {assets.map((x) => (
            <li key={x.id} className="flex items-center gap-2 border-t border-line/60 py-1.5 text-[12.5px] first:border-0">
              <Link href={`/terminal/${x.id}`} className="font-semibold hover:underline">{x.symbol}</Link>
              <span className="text-[11px] text-faint">{x.venue}</span>
              <span className="ml-auto text-[11px] text-muted">{x.n} post{x.n === 1 ? "" : "s"}{x.buys || x.sells ? ` · ${x.buys}B/${x.sells}S` : ""}</span>
              {x.ch != null && <span className={cx("num w-14 text-right text-[11.5px] font-semibold", x.ch >= 0 ? "text-up" : "text-down")}>{x.ch >= 0 ? "+" : ""}{x.ch.toFixed(1)}%</span>}
            </li>
          ))}
        </ul>
      ) : <p className="py-3 text-center text-[12px] text-muted">No tagged trades this week yet.</p>}
      {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tags.map(([t, n]) => <span key={t} className="flex items-center gap-0.5 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-accent-2"><Hash className="size-3" />{t}<span className="text-faint">{n}</span></span>)}</div>}
    </section>
  );
}

/** Top posters this week: by posts and likes in the last 7 days. */
function TopPosters({ posts }: { posts: any[] }) {
  const rows = useMemo(() => {
    const cut = Date.now() - WEEK;
    const m = new Map<string, { handle: string; name: string; color: string; posts: number; likes: number; verified: number }>();
    for (const p of posts) {
      if (+new Date(p.created_at) < cut) continue;
      const r = m.get(p.handle) ?? { handle: p.handle, name: p.display_name, color: p.avatar_color, posts: 0, likes: 0, verified: 0 };
      r.posts++; r.likes += Number(p.likes ?? 0); r.verified += (p.tagged ?? []).filter((t: any) => t.verification === "verified_live").length;
      m.set(p.handle, r);
    }
    return [...m.values()].sort((a, b) => b.likes * 2 + b.posts - (a.likes * 2 + a.posts)).slice(0, 6);
  }, [posts]);
  return (
    <section className="surface rounded-2xl p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Crown className="size-4 text-accent-2" /> Top posters this week</h3>
      {rows.length ? (
        <ul className="mt-2">
          {rows.map((r, i) => (
            <li key={r.handle} className="flex items-center gap-2.5 border-t border-line/60 py-2 first:border-0">
              <span className="w-4 text-[11px] font-semibold text-accent-2">{i + 1}</span>
              <Link href={`/social/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-2"><Avatar name={r.name} color={r.color} size={26} /><span className="min-w-0"><span className="block truncate text-[12.5px] font-medium">{r.name}</span><span className="text-[11px] text-muted">@{r.handle}</span></span></Link>
              <span className="text-right text-[11px] text-muted">{r.posts} post{r.posts === 1 ? "" : "s"}<br />{r.likes} ♥{r.verified ? ` · ${r.verified} verified` : ""}</span>
            </li>
          ))}
        </ul>
      ) : <p className="py-3 text-center text-[12px] text-muted">No posts this week yet.</p>}
    </section>
  );
}

function TraderRow({ p }: { p: any }) {
  const [following, setFollowing] = useState<boolean>(p.following);
  const toast = useToast();
  return (
    <div className="flex items-center gap-2.5 border-t border-line/60 py-2 first:border-0">
      <Link href={`/social/${p.handle}`} className="flex min-w-0 flex-1 items-center gap-2">
        <Avatar name={p.display_name} color={p.avatar_color} size={28} />
        <span className="min-w-0"><span className="block truncate text-[12.5px] font-medium">{p.display_name}</span><span className="text-[11px] text-muted">@{p.handle} · {p.followers} followers</span></span>
      </Link>
      <Button size="sm" variant={following ? "secondary" : "outline"} onClick={async () => {
        try { await api("/api/social/follow", { method: "POST", json: { handle: p.handle, follow: !following } }); setFollowing(!following); } catch (e: any) { toast(e.message, "down"); }
      }}>{following ? "Following" : "Follow"}</Button>
    </div>
  );
}

/** Composer: one line to write, then type, visibility, a verified order or an asset tag, and #tags. */
function Composer({ onPosted }: { onPosted: () => void }) {
  const toast = useToast();
  const { user } = useShell();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("post");
  const [visibility, setVisibility] = useState("public");
  const [tags, setTags] = useState("");
  const [orderId, setOrderId] = useState("");
  const [assetQ, setAssetQ] = useState("");
  const [asset, setAsset] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const orders = useApi<{ orders: any[] }>(open ? "/api/orders?limit=30" : null);
  useEffect(() => {
    if (assetQ.length < 1) { setResults([]); return; }
    const t = setTimeout(() => api(`/api/assets?q=${encodeURIComponent(assetQ)}&limit=5`).then((r) => setResults(r.assets)).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [assetQ]);
  const filled = (orders.data?.orders ?? []).filter((o) => o.status === "filled");
  async function submit() {
    setBusy(true);
    try {
      await api("/api/social/posts", { method: "POST", json: {
        kind, body, visibility, orderId: orderId || null, assetId: orderId ? null : asset?.id ?? null,
        tags: tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean).slice(0, 8),
      } });
      setBody(""); setTags(""); setOrderId(""); setAsset(null); setAssetQ(""); setOpen(false);
      toast("Posted to the Floor", "up"); onPosted();
    } catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); } finally { setBusy(false); }
  }
  const sel = "h-8 rounded-lg border border-line bg-bg-2 px-2 text-[12px] text-text outline-none focus:border-accent/60";
  return (
    <section className="surface rounded-2xl p-3.5">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-grad text-[13px] font-semibold text-bg">{user.displayName.slice(0, 1).toUpperCase()}</span>
        <textarea value={body} onFocus={() => setOpen(true)} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={open ? 3 : 1} placeholder="Share a trade, a chart, or a thesis…"
          className="min-h-9 flex-1 resize-none rounded-xl border border-line bg-bg-2 px-3 py-2 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60" />
      </div>
      {open && (
        <div className="mt-2.5 space-y-2 pl-12">
          <div className="flex flex-wrap items-center gap-1.5">
            {[["post", "Post"], ["trade", "Trade"], ["analysis", "Analysis"], ["strategy", "Strategy"]].map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)} className={cx("rounded-lg border px-2.5 py-1 text-[12px]", kind === k ? "border-accent/60 bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>{l}</button>
            ))}
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={sel} aria-label="Visibility">
              <option value="public">Public</option><option value="followers">Followers only</option><option value="private">Only me</option>
            </select>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={cx(sel, "max-w-[230px]")} aria-label="Tag one of my filled orders">
              <option value="">Attach a filled order…</option>
              {filled.map((o) => <option key={o.id} value={o.id}>{o.side.toUpperCase()} {o.symbol} @ {Number(o.avg_fill_price).toPrecision(6)} {o.is_paper ? "(paper)" : "(live)"}</option>)}
            </select>
            <span className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input value={asset ? `${asset.symbol} · ${asset.venue}` : assetQ} disabled={!!orderId} onChange={(e) => { setAsset(null); setAssetQ(e.target.value); }} placeholder="Tag an asset" className={cx(sel, "w-40 pl-7 disabled:opacity-50")} />
              {asset && <button onClick={() => { setAsset(null); setAssetQ(""); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-faint hover:text-text" aria-label="Remove asset"><X className="size-3.5" /></button>}
              {!asset && results.length > 0 && (
                <div className="absolute z-10 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
                  {results.map((a) => <button key={a.id} onClick={() => { setAsset(a); setResults([]); }} className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-panel-2">{a.symbol} <span className="text-muted">{a.name} · {a.venue}</span></button>)}
                </div>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#tags" className={cx(sel, "min-w-0 flex-1")} />
            <span className="text-[11px] text-faint">{body.length}/2000</span>
            <button onClick={() => setOpen(false)} className="text-[12px] text-muted hover:text-text">Cancel</button>
            <Button variant="primary" size="sm" loading={busy} disabled={!body.trim()} onClick={submit}><PenSquare className="size-3.5" /> Post</Button>
          </div>
          {(orderId || asset) && <p className="text-[11px] text-muted">{orderId ? "Merod sets the trade badge (verified live / simulated) from the order record." : "Asset tags without an order show as Unverified."}</p>}
        </div>
      )}
    </section>
  );
}
