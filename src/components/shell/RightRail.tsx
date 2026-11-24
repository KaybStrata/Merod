"use client";
import { useState } from "react";
import Link from "next/link";
import { Bot, Zap, Pause, Play, PanelRightClose, PanelRightOpen, Plus, OctagonX, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ShortcutBar } from "@/components/ShortcutBar";
import { StatusPill, cx, useToast } from "@/components/ui";
import { usd, tone } from "@/lib/format";
import { useRealtime, useShell } from "./context";

/** Right-hand control bar: one-click shortcut buttons and the user's bots, on every screen (xl and wider). */
export function RightRail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { screenAsset, connected } = useShell();
  const bots = useApi<any>(open ? "/api/bots" : null, { refreshMs: connected ? 30000 : 10000 });
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  useRealtime((e) => { if (open && (e.type === "bot_status" || e.type === "fill")) bots.refresh(); });

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
  return (
    <>
    {!open && (
      <button onClick={onToggle} title="Show bots & shortcuts" aria-label="Show bots and shortcuts"
        className="fade-up fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-line bg-bg-2 px-1 py-3 text-muted shadow-lg hover:text-accent-2 xl:flex">
        <PanelRightOpen className="size-4" /><Zap className="size-3.5" /><Bot className="size-3.5" />
      </button>
    )}
    <aside aria-hidden={!open} className={cx("fixed inset-y-0 right-0 z-30 hidden w-72 flex-col border-l border-line bg-bg-2 transition-transform duration-300 xl:flex", !open && "translate-x-full")}>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-sm font-semibold">Quick controls</span>
        <button onClick={onToggle} className="rounded-lg p-1.5 text-muted hover:text-text" title="Hide panel"><PanelRightClose className="size-4" /></button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-3 pb-40">
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
                      <span className={cx("num shrink-0", tone(b.pnl_usd))}>{usd(b.pnl_usd, { sign: true })}</span>
                    </div>
                    <div className="mt-1.5"><StatusPill status={b.status} /></div>
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
      </div>
    </aside>
    </>
  );
}
