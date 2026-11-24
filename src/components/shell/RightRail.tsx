"use client";
import { useEffect, useRef, useState } from "react";
import { ModoPanel } from "./ModoPanel";
import Link from "next/link";
import { Bot, Zap, Pause, Play, PanelRightClose, PanelRightOpen, Plus, OctagonX, Loader2, Activity, Sparkles } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ShortcutBar } from "@/components/ShortcutBar";
import { PaperBadge, StatusPill, cx, useToast } from "@/components/ui";
import { ago, price, qty, usd, tone } from "@/lib/format";
import { useRealtime, useShell } from "./context";

/** Right-hand control bar: one-click shortcut buttons and the user's bots, on every screen (xl and wider). */
export function RightRail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  // Which view the right panel shows (remembered in this browser).
  const [tab, setTabState] = useState<"controls" | "modo">("controls");
  useEffect(() => { try { const t = localStorage.getItem("merod-rail-tab"); if (t === "modo" || t === "controls") setTabState(t); } catch { /* ignore */ } }, []);
  const setTab = (t: "controls" | "modo") => { setTabState(t); try { localStorage.setItem("merod-rail-tab", t); } catch { /* ignore */ } };
  const { screenAsset, connected } = useShell();
  const bots = useApi<any>(open ? "/api/bots" : null, { refreshMs: connected ? 30000 : 10000 });
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  // Live bot feed: every decision/trade a bot makes streams in; stats refresh (throttled) on each one.
  const [feed, setFeed] = useState<{ k: string; bot: string; level: string; msg: string; ts: number }[]>([]);
  const lastRefresh = useRef(0);
  useRealtime((e) => {
    if (!open) return;
    if (e.type === "bot_log") setFeed((f) => [{ k: `${e.payload.ts}${Math.random()}`, bot: e.payload.botName, level: e.payload.level, msg: e.payload.message, ts: e.payload.ts ?? Date.now() }, ...f].slice(0, 25));
    if (["bot_status", "fill", "bot_log"].includes(e.type) && Date.now() - lastRefresh.current > 2000) { lastRefresh.current = Date.now(); bots.refresh(); }
  });

  async function act(id: string, action: "pause" | "resume" | "start") {
    setBusy(id);
    try { await api(`/api/bots/${id}`, { method: "POST", json: { action } }); bots.refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function stopAll() {
    if (!confirm("Emergency stop: halt every bot and cancel open orders?")) return;
    setBusy("all");
    try { await api("/api/bots/emergency", { method: "POST", json: { action: "stop" } }); toast("All bots stopped and open orders cancelled", "neutral"); bots.refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  const list: any[] = bots.data?.bots ?? [];
  const running = list.filter((b) => b.status === "running").length;
  const totals = list.reduce((t, b) => ({ pnl: t.pnl + Number(b.pnl_usd || 0), trades: t.trades + (b.trades_today || 0), wins: t.wins + (b.wins || 0), losses: t.losses + (b.losses || 0), volume: t.volume + Number(b.volume_24h || 0) }), { pnl: 0, trades: 0, wins: 0, losses: 0, volume: 0 });
  const decided = totals.wins + totals.losses;
  return (
    <>
    {!open && (
      <button onClick={onToggle} title="Show bots & shortcuts" aria-label="Show bots and shortcuts"
        className="fade-up fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-line bg-bg-2 px-1 py-3 text-muted shadow-lg hover:text-accent-2 xl:flex">
        <PanelRightOpen className="size-4" /><Zap className="size-3.5" /><Bot className="size-3.5" />
      </button>
    )}
    <aside aria-hidden={!open} className={cx("fixed inset-y-0 right-0 z-30 hidden w-72 flex-col border-l border-line bg-bg-2 transition-transform duration-300 xl:flex", !open && "translate-x-full")}>
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-line px-2">
        <div className="flex flex-1 gap-0.5 rounded-lg border border-line bg-bg-2/60 p-0.5">
          {([["controls", "Bots & shortcuts", Zap], ["modo", "Modo", Sparkles]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={cx("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors", tab === k ? "bg-accent-soft text-text" : "text-muted hover:text-text")}>
              <Icon className={cx("size-3.5", tab === k && "text-accent-2")} />{label}
            </button>
          ))}
        </div>
        <button onClick={onToggle} className="rounded-lg p-1.5 text-muted hover:text-text" title="Hide panel"><PanelRightClose className="size-4" /></button>
      </div>

      {tab === "modo" && <div className="flex-1 overflow-y-auto p-3 pb-40"><ModoPanel active={open && tab === "modo"} /></div>}
      <div className={cx("flex-1 space-y-5 overflow-y-auto p-3 pb-40", tab !== "controls" && "hidden")}>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Zap className="size-3.5 text-accent-2" /> Shortcuts</h3>
            {screenAsset && <span className="text-[10px] text-faint">on {screenAsset.symbol}</span>}
          </div>
          <ShortcutBar rail assetId={screenAsset?.id} />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Bot className="size-3.5 text-accent-2" /> Bots {list.length > 0 && <span className="font-normal normal-case text-faint">· {running} running</span>}</h3>
            <Link href="/bots" className="flex items-center gap-0.5 text-[11px] text-accent-2"><Plus className="size-3" /> New</Link>
          </div>
          {list.length > 0 && (
            <div className="mb-2 rounded-xl border border-line bg-panel p-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-faint">
                <span className="flex items-center gap-1"><Activity className="size-3 text-accent-2" /> Live trading stats</span>
                <span className={cx("flex items-center gap-1 normal-case", connected ? "text-up" : "")}><span className={cx("size-1.5 rounded-full", connected ? "bg-up pulse-dot" : "bg-faint")} />{connected ? "live" : "polling"}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div><div className="text-faint">Total P&L</div><div className={cx("num text-sm font-semibold", tone(totals.pnl))}>{usd(totals.pnl, { sign: true })}</div></div>
                <div><div className="text-faint">Win rate</div><div className="num text-sm font-semibold">{decided ? `${Math.round((totals.wins / decided) * 100)}%` : "—"}<span className="ml-1 text-[10px] font-normal text-faint">{totals.wins}W/{totals.losses}L</span></div></div>
                <div><div className="text-faint">Trades today</div><div className="num font-medium">{totals.trades}</div></div>
                <div><div className="text-faint">Volume 24h</div><div className="num font-medium">{usd(totals.volume, { compact: true })}</div></div>
              </div>
            </div>
          )}
          {bots.loading && !bots.data ? <div className="text-xs text-faint">Loading bots…</div>
            : list.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-3 text-xs text-muted">No bots yet. <Link href="/bots" className="text-accent-2">Create one</Link> or type a strategy in the prompt box.</div>
            ) : (
              <ul className="space-y-1.5">
                {list.slice(0, 20).map((b) => (
                  <li key={b.id} className="rounded-xl border border-line bg-panel p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/bots/${b.id}`} className="min-w-0 truncate text-xs font-medium hover:text-accent-2">{b.name}</Link>
                      {b.status === "running" ? (
                        <button onClick={() => act(b.id, "pause")} disabled={!!busy} className="rounded-md p-1 text-muted hover:text-warn disabled:opacity-50" title="Pause bot">
                          {busy === b.id ? <Loader2 className="size-3.5 animate-spin" /> : <Pause className="size-3.5" />}
                        </button>
                      ) : ["paused", "draft", "stopped"].includes(b.status) ? (
                        <button onClick={() => act(b.id, b.status === "paused" ? "resume" : "start")} disabled={!!busy} className="rounded-md p-1 text-muted hover:text-up disabled:opacity-50" title={b.status === "paused" ? "Resume bot" : "Start bot"}>
                          {busy === b.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-faint">{(b.symbols ?? []).join(", ") || b.strategy_name}</span>
                      <span className={cx("num shrink-0 font-medium", tone(b.pnl_usd))}>{usd(b.pnl_usd, { sign: true })}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px]">
                      <div className="rounded-md bg-panel-2 px-1.5 py-1"><div className="text-faint">Trades</div><div className="num text-text">{b.trades_today}/{b.max_trades_per_day}</div></div>
                      <div className="rounded-md bg-panel-2 px-1.5 py-1"><div className="text-faint">Win</div><div className="num text-text">{(b.wins || 0) + (b.losses || 0) ? `${Math.round(((b.wins || 0) / ((b.wins || 0) + (b.losses || 0))) * 100)}%` : "—"}</div></div>
                      <div className="rounded-md bg-panel-2 px-1.5 py-1"><div className="text-faint">Spent</div><div className="num text-text">{usd(b.spent_today_usd, { compact: true })}</div></div>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-2" title="Trades used today"><div className="h-full rounded-full bg-grad" style={{ width: `${Math.min(100, (b.trades_today / Math.max(1, b.max_trades_per_day)) * 100)}%` }} /></div>
                    {b.last_fill && (
                      <div className="mt-1 truncate text-[10px] text-muted">Last: <span className={b.last_fill.side === "buy" ? "text-up" : "text-down"}>{b.last_fill.side.toUpperCase()}</span> {qty(b.last_fill.filled_quantity)} {b.last_fill.symbol} @ {price(b.last_fill.avg_fill_price)} · {ago(b.last_fill.updated_at)}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5"><StatusPill status={b.status} /><PaperBadge paper={b.is_paper} /></div>
                  </li>
                ))}
              </ul>
            )}
          {running > 0 && (
            <button onClick={stopAll} disabled={!!busy} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-down/40 bg-down-soft px-3 py-1.5 text-xs font-medium text-down hover:bg-down/20 disabled:opacity-50">
              <OctagonX className="size-3.5" /> Emergency stop all
            </button>
          )}
        </section>

        {list.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Activity className="size-3.5 text-accent-2" /> Bot activity</h3>
            {feed.length === 0 ? (
              <div className="text-[11px] text-faint">{(list.find((b) => b.last_log)?.last_log?.message) ? <>Latest: {list.find((b) => b.last_log).last_log.message}</> : "Waiting for your bots' next move…"}</div>
            ) : (
              <ul className="space-y-1">
                {feed.map((f) => (
                  <li key={f.k} className="fade-up text-[11px] leading-snug">
                    <span className={cx("font-medium", f.level === "error" ? "text-down" : ["trigger", "result"].includes(f.level) ? "text-accent-2" : "text-text")}>{f.bot}</span>
                    <span className="text-muted"> · {f.msg}</span> <span className="text-faint">{ago(f.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
    </>
  );
}
