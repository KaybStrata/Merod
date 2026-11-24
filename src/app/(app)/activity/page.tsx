"use client";
import { SectionTabs } from "@/components/SectionTabs";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Radio, Pause, Play, Bot, ArrowRightLeft, Zap, Sparkles, GraduationCap, Globe2, User } from "lucide-react";
import { useApi } from "@/lib/api";
import { LearningFeed } from "@/components/LearningFeed";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, Card, Empty, PaperBadge, Pills, Stat, StatusPill, cx } from "@/components/ui";
import { ago, price, qty, usd, tone } from "@/lib/format";

type Ev = { key: string; kind: string; ts: number; title: string; detail?: string; tone?: "up" | "down" | "warn" | "accent" | "neutral"; href?: string; paper?: boolean; live?: boolean };
const KINDS = [
  { value: "all", label: "All" }, { value: "bot", label: "Bots" }, { value: "order", label: "Trades" },
  { value: "shortcut", label: "Shortcuts" }, { value: "prompt", label: "Prompts" }, { value: "training", label: "Auto-training" },
] as const;
const ICON: Record<string, any> = { bot: Bot, order: ArrowRightLeft, shortcut: Zap, prompt: Sparkles, training: GraduationCap };

function fromRow(r: any): Ev {
  const ts = new Date(r.ts).getTime();
  switch (r.kind) {
    case "bot": return { key: `b${r.id}`, kind: "bot", ts, title: r.bot_name, detail: `${r.level.toUpperCase()} · ${r.message}`, href: `/bots/${r.bot_id}`, tone: r.level === "error" ? "down" : r.level === "trigger" || r.level === "result" ? "accent" : "neutral" };
    case "order": {
      const amt = r.filled_quantity > 0 ? `${qty(r.filled_quantity)} @ ${price(r.avg_fill_price)}` : r.notional_usd ? usd(r.notional_usd) : qty(r.quantity);
      return { key: `o${r.id}${r.status}`, kind: "order", ts, title: `${r.side.toUpperCase()} ${r.symbol} · ${amt}`, detail: `${r.status.replace(/_/g, " ")} · via ${r.source}${r.status_reason ? ` · ${r.status_reason}` : ""}`, href: `/terminal/${r.asset_id}`, paper: r.paper, tone: r.status === "filled" ? (r.side === "buy" ? "up" : "down") : ["rejected", "failed"].includes(r.status) ? "warn" : "neutral" };
    }
    case "shortcut": return { key: `s${r.id}`, kind: "shortcut", ts, title: `Shortcut “${r.name}”`, detail: r.status, href: "/shortcuts" };
    case "prompt": return { key: `p${r.id}`, kind: "prompt", ts, title: "AI prompt", detail: `${r.status.replace(/_/g, " ")} · ${String(r.content).slice(0, 140)}`, href: `/ai?c=${r.conversation_id}` };
    case "training": return { key: `t${r.id}`, kind: "training", ts, title: `Auto-training · ${r.target_name}`, detail: r.reason, href: "/training", tone: "accent" };
  }
  return { key: String(Math.random()), kind: "other", ts, title: "Event" };
}

export default function ActivityPage() {
  const { connected } = useShell();
  const [scope, setScope] = useState<"mine" | "platform">("mine");
  const [kind, setKind] = useState<string>("all");
  const [paused, setPaused] = useState(false);
  const mine = useApi<any>(scope === "mine" ? "/api/activity?scope=mine" : null, { refreshMs: connected ? 30000 : 5000 });
  const platform = useApi<any>(scope === "platform" ? "/api/activity?scope=platform" : null, { refreshMs: connected ? 30000 : 5000 });
  const [liveEvents, setLiveEvents] = useState<Ev[]>([]);
  const [tape, setTape] = useState<any[]>([]);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => { setLiveEvents([]); setTape([]); }, [scope]);

  useRealtime((e) => {
    if (pausedRef.current) return;
    const now = Date.now();
    if (e.channel === "activity" && e.type === "trade") {
      setTape((t) => [{ id: `live${now}${Math.random()}`, ts: new Date(e.payload.ts).toISOString(), live: true, ...e.payload }, ...t].slice(0, 200));
      return;
    }
    let ev: Ev | null = null;
    if (e.type === "bot_log") ev = { key: `lb${now}${Math.random()}`, kind: "bot", ts: now, title: e.payload.botName, detail: `${String(e.payload.level).toUpperCase()} · ${e.payload.message}`, href: `/bots/${e.payload.botId}`, live: true, tone: e.payload.level === "error" ? "down" : ["trigger", "result"].includes(e.payload.level) ? "accent" : "neutral" };
    if (e.type === "fill") ev = { key: `lf${now}`, kind: "order", ts: now, title: `${String(e.payload.side).toUpperCase()} ${e.payload.symbol} · ${qty(e.payload.quantity)} @ ${price(e.payload.price)}`, detail: `filled · via ${e.payload.source ?? "—"}`, paper: e.payload.paper, live: true, tone: e.payload.side === "buy" ? "up" : "down" };
    if (e.type === "order") { mine.refresh(); return; }
    if (e.type === "training") ev = { key: `lt${now}`, kind: "training", ts: now, title: `Auto-training · ${e.payload.targetName}`, detail: e.payload.reason, href: "/training", live: true, tone: "accent" };
    if (ev) { setLiveEvents((l) => [ev!, ...l].slice(0, 300)); setFlash(ev.key); setTimeout(() => setFlash(null), 1200); }
  });

  const events = useMemo(() => {
    const base: Ev[] = (mine.data?.events ?? []).map(fromRow);
    const seen = new Set<string>();
    return [...liveEvents, ...base].filter((e) => (kind === "all" || e.kind === kind) && !seen.has(e.key) && seen.add(e.key)).sort((a, b) => b.ts - a.ts).slice(0, 300);
  }, [mine.data, liveEvents, kind]);

  const trades = useMemo(() => {
    const seen = new Set<string>();
    return [...tape, ...(platform.data?.trades ?? [])].filter((t) => { const k = t.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 200);
  }, [tape, platform.data]);

  return (
    <div className="space-y-5">
      <SectionTabs tabs={[{ href: "/activity", label: "My live activity", icon: Radio }, { href: "/world", label: "World trades", icon: Globe2 }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Radio className="size-6 text-accent-2" /> Live Activity</h1>
          <p className="mt-1 text-sm text-muted">Every bot decision, trade, shortcut and prompt as it happens.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs", connected ? "bg-up-soft text-up" : "bg-panel-2 text-muted")}>
            <span className={cx("size-1.5 rounded-full", connected ? "bg-up pulse-dot" : "bg-faint")} /> {connected ? "Live" : "Polling every 5s"}
          </span>
          <Pills value={scope} onChange={setScope} options={[{ value: "mine", label: <span className="flex items-center gap-1"><User className="size-3.5" /> My activity</span> }, { value: "platform", label: <span className="flex items-center gap-1"><Globe2 className="size-3.5" /> All of Merod</span> }]} />
          <button onClick={() => setPaused(!paused)} className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 text-sm">{paused ? <><Play className="size-4" /> Resume</> : <><Pause className="size-4" /> Pause stream</>}</button>
        </div>
      </div>

      {scope === "mine" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          <Card title="Activity stream" action={<Pills size="sm" value={kind} onChange={setKind} options={KINDS as any} />}>
            {events.length === 0 ? (
              <Empty icon={<Radio className="size-6" />} title="Nothing yet">Place a trade, run a shortcut or start a bot — events stream here live.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {events.map((e) => {
                  const Icon = ICON[e.kind] ?? Radio;
                  const body = (
                    <div className={cx("flex items-start gap-3 py-2.5 transition-colors", flash === e.key && "bg-accent-soft")}>
                      <span className={cx("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                        e.tone === "up" ? "bg-up-soft text-up" : e.tone === "down" ? "bg-down-soft text-down" : e.tone === "warn" ? "bg-warn-soft text-warn" : e.tone === "accent" ? "bg-accent-soft text-accent-2" : "bg-panel-2 text-muted")}><Icon className="size-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{e.title}{e.paper !== undefined && <PaperBadge paper={e.paper} />}{e.live && <Badge tone="up">live</Badge>}</div>
                        {e.detail && <div className="mt-0.5 break-words text-xs text-muted">{e.detail}</div>}
                      </div>
                      <span className="shrink-0 text-[11px] text-faint">{ago(e.ts)}</span>
                    </div>
                  );
                  return <li key={e.key}>{e.href ? <Link href={e.href} className="block hover:bg-panel-2/40">{body}</Link> : body}</li>;
                })}
              </ul>
            )}
          </Card>
          <div className="space-y-4">
          <LearningFeed compact />
          <Card title="Bots right now" icon={<Bot className="size-4 text-accent-2" />} action={<Link href="/bots" className="text-xs text-accent-2">All bots</Link>}>
            {(mine.data?.bots ?? []).length === 0 ? <Empty title="No active bots">Try the prompt: “buy at 3% dip and sell at 5% increase, rinse and repeat”.</Empty> : (
              <div className="space-y-2">
                {mine.data.bots.map((b: any) => (
                  <Link key={b.id} href={`/bots/${b.id}`} className="block rounded-xl border border-line bg-bg-2/60 p-3 hover:border-line-2">
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{b.name}</span><StatusPill status={b.status} /></div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>{(b.symbols ?? []).join(", ") || "multi-asset"}</span>
                      <span className={tone(b.pnl_usd)}>P&L {usd(b.pnl_usd, { sign: true })}</span>
                      <span>{b.trades_today} trades today</span>
                      <span>checked {ago(b.last_tick_at)}</span>
                    </div>
                    {b.last_message && <div className="mt-1 truncate text-[11px] text-faint">{b.last_message}</div>}
                  </Link>
                ))}
              </div>
            )}
          </Card>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card><Stat label="Fills (24h)" value={platform.data?.stats?.fills ?? "—"} /></Card>
            <Card><Stat label="Active traders (24h)" value={platform.data?.stats?.traders ?? "—"} /></Card>
            <Card><Stat label="Volume (24h)" value={usd(platform.data?.stats?.volume ?? 0, { compact: true })} /></Card>
            <Card><Stat label="Bots running now" value={platform.data?.stats?.runningBots ?? "—"} sub={<span className="text-muted">{platform.data?.stats?.bot_fills ?? 0} bot fills today</span>} /></Card>
          </div>
          <Card title="Live trade tape" action={<span className="text-xs text-faint">Anonymized · handles shown only for traders who share performance publicly</span>}>
            {trades.length === 0 ? <Empty title="No trades yet" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="text-left text-xs text-faint"><th className="py-2 font-medium">Time</th><th className="font-medium">Asset</th><th className="font-medium">Side</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Price</th><th className="font-medium pl-4">Via</th><th className="font-medium">Trader</th><th /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {trades.map((t: any) => (
                      <tr key={t.id} className={cx(t.live && "bg-accent-soft/40")}>
                        <td className="py-2 text-xs text-muted">{ago(t.ts)}</td>
                        <td><Link href={`/terminal/${t.asset_id ?? t.assetId}`} className="font-medium hover:text-accent-2">{t.symbol}</Link></td>
                        <td className={t.side === "buy" ? "text-up" : "text-down"}>{String(t.side).toUpperCase()}</td>
                        <td className="num text-right">{qty(t.quantity)}</td>
                        <td className="num text-right">{price(t.price)}</td>
                        <td className="pl-4 text-xs text-muted">{t.source}</td>
                        <td className="text-xs">{t.handle ? <Link href={`/social/${t.handle}`} className="text-accent-2">@{t.handle}</Link> : <span className="text-faint">anonymous</span>}</td>
                        <td><PaperBadge paper={t.paper} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
