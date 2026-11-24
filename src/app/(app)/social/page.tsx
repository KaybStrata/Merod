"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Users, Trophy, PenSquare, Flame, Info } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usd, tone } from "@/lib/format";
import { Badge, Button, Card, Empty, Pills, Select, Skeleton, cx, useToast } from "@/components/ui";
import { useShell, useRealtime } from "@/components/shell/context";
import { Avatar, PostCard } from "@/components/social/PostCard";

type Tab = "all" | "following" | "trades" | "analysis" | "strategies" | "bookmarks";

export default function SocialPage() {
  const { user } = useShell();
  const [tab, setTab] = useState<Tab>("all");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const posts = useApi<{ posts: any[] }>(`/api/social/posts?tab=${tab}`);
  const board = useApi<any>(`/api/social/leaderboard?mode=${mode}`);
  useRealtime((e) => { if (e.channel === "social" && e.type === "post") posts.refresh(); });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Social Trading</h1>
          <p className="text-sm text-muted">Share trades and ideas. Trade tags are verified against real orders on Merod's servers.</p>
        </div>
        <Composer onPosted={posts.refresh} />
        <Card pad={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
            <Pills<Tab> size="sm" value={tab} onChange={setTab} options={[
              { value: "all", label: "All posts" }, { value: "following", label: "Following" }, { value: "trades", label: "Trades" },
              { value: "analysis", label: "Analysis" }, { value: "strategies", label: "Strategies" }, { value: "bookmarks", label: "Saved" },
            ]} />
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <Badge tone="up">Verified live = real filled order</Badge><Badge tone="warn">Simulated = paper order</Badge><Badge>Unverified = opinion</Badge>
            </div>
          </div>
          {posts.loading && !posts.data ? <div className="space-y-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
            : posts.error ? <div className="p-4 text-sm text-down">{posts.error}</div>
            : posts.data?.posts.length ? posts.data.posts.map((p) => <PostCard key={p.id} post={p} me={user.handle} onChange={posts.refresh} copyTradingEnabled={board.data?.copyTradingEnabled} />)
            : <div className="p-4"><Empty icon={<PenSquare className="size-6" />} title={tab === "following" ? "No posts from people you follow" : "No posts yet"}>Share your first trade idea above.</Empty></div>}
        </Card>
      </div>

      <aside className="space-y-4">
        <Card title="Leaderboard" icon={<Trophy className="size-4 text-warn" />} action={<Pills size="sm" value={mode} onChange={setMode} options={[{ value: "paper", label: "Paper" }, { value: "live", label: "Live" }]} />}>
          <p className="mb-2 flex gap-1 text-[11px] text-muted"><Info className="size-3 shrink-0" /> Only traders who opted in to share performance. Computed from filled orders. {mode === "paper" ? "Paper results are simulated." : ""}</p>
          {board.data?.leaders?.length ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-faint"><tr><th className="py-1 text-left">#</th><th className="text-left">Trader</th><th className="text-right">P&L</th><th className="text-right">Win</th></tr></thead>
              <tbody>
                {board.data.leaders.map((l: any, i: number) => (
                  <tr key={l.handle} className="border-t border-line">
                    <td className="py-2 text-muted">{i + 1}</td>
                    <td><Link href={`/social/${l.handle}`} className="flex items-center gap-2"><Avatar name={l.display_name} color={l.avatar_color} size={26} /><span className="truncate">@{l.handle}</span>{mode === "paper" && <Badge tone="warn">Paper</Badge>}</Link></td>
                    <td className={cx("num text-right", tone(l.realized_pnl))}>{usd(l.realized_pnl, { sign: true })}</td>
                    <td className="num text-right text-muted">{l.winRate == null ? "—" : `${l.winRate.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty title="No ranked traders yet">Enable “Share performance” in Settings → Privacy to appear here.</Empty>}
        </Card>
        <Card title="Popular traders" icon={<Flame className="size-4 text-down" />}>
          {board.data?.popular?.length ? board.data.popular.map((p: any) => <TraderRow key={p.handle} p={p} />) : <Empty icon={<Users className="size-5" />} title="No other traders yet" />}
        </Card>
        <Card title="Copy trading">
          <p className="text-sm text-muted">Copy-trading infrastructure exists but is <span className="font-medium text-warn">disabled until compliance approval</span> (feature flag <code className="text-xs">copy_trading</code>).</p>
        </Card>
      </aside>
    </div>
  );
}

function TraderRow({ p }: { p: any }) {
  const [following, setFollowing] = useState<boolean>(p.following);
  const toast = useToast();
  return (
    <div className="flex items-center gap-3 border-t border-line py-2.5 first:border-0">
      <Link href={`/social/${p.handle}`} className="flex min-w-0 flex-1 items-center gap-2.5">
        <Avatar name={p.display_name} color={p.avatar_color} size={34} />
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.display_name}</span><span className="text-xs text-muted">@{p.handle} · {p.followers} followers</span></span>
      </Link>
      <Button size="sm" variant={following ? "secondary" : "outline"} onClick={async () => {
        try { await api("/api/social/follow", { method: "POST", json: { handle: p.handle, follow: !following } }); setFollowing(!following); } catch (e: any) { toast(e.message, "down"); }
      }}>{following ? "Following" : "Follow"}</Button>
    </div>
  );
}

function Composer({ onPosted }: { onPosted: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("post");
  const [visibility, setVisibility] = useState("public");
  const [tags, setTags] = useState("");
  const [orderId, setOrderId] = useState("");
  const [assetQ, setAssetQ] = useState("");
  const [asset, setAsset] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const orders = useApi<{ orders: any[] }>("/api/orders?limit=30");
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
      setBody(""); setTags(""); setOrderId(""); setAsset(null); setAssetQ("");
      toast("Posted", "up"); onPosted();
    } catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); } finally { setBusy(false); }
  }

  return (
    <Card>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} placeholder="Share a trade, analysis or strategy…"
        className="w-full resize-none rounded-xl border border-line bg-bg-2 p-3 text-sm outline-none placeholder:text-faint focus:border-accent" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="post">Post</option><option value="trade">Trade</option><option value="analysis">Analysis</option><option value="strategy">Strategy</option>
        </Select>
        <Select label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
          <option value="public">Public</option><option value="followers">Followers only</option><option value="private">Private (only me)</option>
        </Select>
        <Select label="Tag one of my filled orders" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">— none —</option>
          {filled.map((o) => <option key={o.id} value={o.id}>{o.side.toUpperCase()} {o.symbol} @ {Number(o.avg_fill_price).toPrecision(6)} {o.is_paper ? "(paper)" : "(live)"}</option>)}
        </Select>
        <label className="relative block">
          <span className="mb-1 block text-xs font-medium text-muted">Or tag an asset</span>
          <input value={asset ? `${asset.symbol} · ${asset.venue}` : assetQ} disabled={!!orderId} onChange={(e) => { setAsset(null); setAssetQ(e.target.value); }} placeholder="Search…"
            className="h-10 w-full rounded-xl border border-line bg-bg-2 px-3 text-sm outline-none focus:border-accent disabled:opacity-50" />
          {!asset && results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
              {results.map((a) => <button key={a.id} onClick={() => { setAsset(a); setResults([]); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-panel-2">{a.symbol} <span className="text-muted">{a.name} · {a.venue}</span></button>)}
            </div>
          )}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#tags (space separated)" className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-bg-2 px-3 text-sm outline-none focus:border-accent" />
        <span className="text-xs text-faint">{body.length}/2000</span>
        <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={submit}><PenSquare className="size-4" /> Post</Button>
      </div>
      {(orderId || asset) && <p className="mt-2 text-[11px] text-muted">{orderId ? "The trade badge (verified live / simulated) is determined by Merod from the order record — you can't set it yourself." : "Asset tags without an order show as Unverified."}</p>}
    </Card>
  );
}
