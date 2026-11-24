"use client";
import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, Lock, BarChart3, Bot, FileText } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { pct, usd, ago } from "@/lib/format";
import { Badge, Button, Card, Empty, Pills, Skeleton, Stat, cx, useToast, PaperBadge } from "@/components/ui";
import { useShell } from "@/components/shell/context";
import { Avatar, PostCard } from "@/components/social/PostCard";

type Tab = "posts" | "performance" | "strategies";

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const { user } = useShell();
  const toast = useToast();
  const { data, error, loading, refresh } = useApi<any>(`/api/social/profiles/${encodeURIComponent(handle)}`);
  const [tab, setTab] = useState<Tab>("posts");
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (error) return <Empty title="Profile unavailable">{error}</Empty>;
  const p = data.profile;

  async function follow() {
    setBusy(true);
    try { await api("/api/social/follow", { method: "POST", json: { handle: p.handle, follow: !p.is_following } }); await refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }

  if (p.is_public === false && !data.self)
    return <Empty icon={<Lock className="size-6" />} title={`@${p.handle} has a private profile`}>Only public profiles can be viewed.</Empty>;

  const perf = data.performance;
  return (
    <div className="space-y-4">
      <Link href="/social" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" /> Social</Link>
      <Card>
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <Avatar name={p.display_name} color={p.avatar_color} size={76} />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">{p.display_name}</h1>
              <div className="text-sm text-muted">@{p.handle} · joined {ago(p.created_at)}</div>
              {p.bio && <p className="mt-1 max-w-md whitespace-pre-wrap text-sm">{p.bio}</p>}
            </div>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-4 md:border-l md:border-line md:pl-6 lg:grid-cols-5">
            <Stat label="Followers" value={p.followers} />
            <Stat label="Following" value={p.following} />
            <Stat label="Posts" value={p.post_count} />
            {perf ? (
              <>
                <Stat label="Live realized P&L" value={perf.live ? <span className={perf.live.realizedPnl >= 0 ? "text-up" : "text-down"}>{usd(perf.live.realizedPnl, { sign: true })}</span> : "—"} sub={perf.live ? <span className="text-muted">verified from filled orders</span> : <span className="text-faint">no live trades</span>} />
                <Stat label="Paper realized P&L" value={perf.paper ? usd(perf.paper.realizedPnl, { sign: true }) : "—"} sub={<span className="text-warn">simulated</span>} />
              </>
            ) : <div className="col-span-2 text-xs text-muted">Performance is private (shared only with the trader's consent).</div>}
          </div>
          {!data.self ? <Button variant={p.is_following ? "secondary" : "primary"} loading={busy} onClick={follow}>{p.is_following ? "Following" : "Follow +"}</Button>
            : <Link href="/settings?tab=account"><Button variant="secondary">Edit profile</Button></Link>}
        </div>
      </Card>

      <Pills<Tab> value={tab} onChange={setTab} options={[{ value: "posts", label: "Posts" }, { value: "performance", label: "Performance" }, { value: "strategies", label: "Public strategies" }]} />

      {tab === "posts" && (
        <Card pad={false}>{data.posts.length ? data.posts.map((x: any) => <PostCard key={x.id} post={x} me={user.handle} onChange={refresh} />) : <div className="p-4"><Empty icon={<FileText className="size-5" />} title="No visible posts" /></div>}</Card>
      )}

      {tab === "performance" && (perf ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(["live", "paper"] as const).map((k) => (
            <Card key={k} title={k === "live" ? "Live (real money)" : "Paper (simulated)"} icon={<BarChart3 className="size-4 text-accent-2" />} action={<PaperBadge paper={k === "paper"} />}>
              {perf[k] ? (
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Filled trades" value={perf[k].trades} />
                  <Stat label="Win rate" value={perf[k].winRate == null ? "—" : `${perf[k].winRate.toFixed(1)}%`} sub={<span className="text-muted">{perf[k].wins}W / {perf[k].losses}L</span>} />
                  <Stat label="Realized P&L" value={<span className={cx(perf[k].realizedPnl >= 0 ? "text-up" : "text-down")}>{usd(perf[k].realizedPnl, { sign: true })}</span>} />
                  <Stat label="Return on capital deployed" value={pct(perf[k].returnPct)} />
                </div>
              ) : <Empty title={`No ${k} trades`} />}
            </Card>
          ))}
          <p className="text-xs text-muted md:col-span-2">Figures are computed by Merod from filled orders. Past performance does not predict future results.</p>
        </div>
      ) : <Empty icon={<Lock className="size-5" />} title="Performance not shared">This trader hasn't consented to share performance.</Empty>)}

      {tab === "strategies" && (
        data.strategies.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.strategies.map((s: any, i: number) => (
              <Card key={i} title={s.name} icon={<Bot className="size-4 text-accent-2" />} action={<div className="flex gap-1"><PaperBadge paper={s.is_paper} /><Badge>{s.status}</Badge></div>}>
                <div className="text-sm text-muted">{s.strategy_name}</div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                  {Object.entries(s.params ?? {}).filter(([, v]) => v != null).map(([k, v]) => <div key={k}><span className="text-faint">{k.replace(/_/g, " ")}: </span>{String(v)}</div>)}
                </div>
              </Card>
            ))}
          </div>
        ) : <Empty icon={<Bot className="size-5" />} title="No public strategies">{perf ? "No active bots." : "Strategies are shown only when the trader shares performance."}</Empty>
      )}
    </div>
  );
}
