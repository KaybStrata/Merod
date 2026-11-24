"use client";
import { useEffect, useRef, useState } from "react";
import { Lightbulb, Zap, Sparkles, TrendingUp, Save, RefreshCw } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, Button, Card, Empty, Modal, PaperBadge, SourceBadge, cx, useToast } from "@/components/ui";
import { price, usd, qty, ago } from "@/lib/format";

/**
 * Live suggested shortcut buttons, prompts and trade ideas computed from current market data.
 * Ideas only — every action opens an engine preview and requires confirmation.
 */
export function LiveSuggestions({ assetId, title = "Live suggestions", compact = false }: { assetId?: string; title?: string; compact?: boolean }) {
  const { openPrompt } = useShell();
  const toast = useToast();
  const { data, refresh, loading } = useApi<any>(`/api/suggestions${assetId ? `?assetId=${assetId}` : ""}`, { refreshMs: 20000 });
  const [preview, setPreview] = useState<{ s: any; plan: any } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const last = useRef(0);
  // Re-score on live ticks (throttled) so suggestions track the market.
  useRealtime((e) => {
    if (e.channel !== "market" || Date.now() - last.current < 8000) return;
    if (assetId && Array.isArray(e.payload) && !e.payload.some((t: any) => t.id === assetId)) return;
    last.current = Date.now(); refresh();
  });

  async function doPreview(s: any) {
    setBusy(s.id);
    try { const r = await api("/api/orders", { method: "POST", json: { mode: "preview", intent: s.intent } }); setPreview({ s, plan: r.plan }); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function place() {
    if (!preview) return;
    setBusy("place");
    try {
      const r = await api("/api/orders", { method: "POST", json: { mode: "place", intent: preview.s.intent, idempotencyKey: crypto.randomUUID() } });
      toast(`Order ${r.order.status}${r.order.status_reason ? ` — ${r.order.status_reason}` : ""}`, r.order.status === "filled" ? "up" : "neutral");
      setPreview(null); refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function saveShortcut(s: any) {
    setBusy(`save${s.id}`);
    try { await api("/api/shortcuts", { method: "POST", json: { ...s.shortcut, assetId: s.assetId } }); toast("Saved as a shortcut button", "up"); }
    catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); } finally { setBusy(null); }
  }

  const list: any[] = data?.suggestions ?? [];
  const shortcuts = list.filter((s) => s.kind === "shortcut");
  const prompts = list.filter((s) => s.kind === "prompt");
  const trades = list.filter((s) => s.kind === "trade");
  return (
    <Card title={<span className="flex items-center gap-2">{title} <span className="flex items-center gap-1 text-[11px] font-normal text-up"><span className="size-1.5 rounded-full bg-up pulse-dot" />live</span></span>}
      icon={<Lightbulb className="size-4 text-warn" />}
      action={<span className="flex items-center gap-2 text-[11px] text-faint">{data?.dataSource && <SourceBadge source={data.dataSource} />}{data && `updated ${ago(data.asOf)}`}<button onClick={refresh} className="hover:text-text" aria-label="Refresh"><RefreshCw className="size-3.5" /></button></span>}>
      {loading && !data ? <div className="h-24 animate-pulse rounded-xl bg-panel-2" /> : list.length === 0 ? (
        <Empty title="No suggestions right now">Signals appear when prices pull back, trend, or your positions move meaningfully.</Empty>
      ) : (
        <div className="space-y-3">
          {shortcuts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {shortcuts.map((s) => (
                <div key={s.id} className="flex items-center overflow-hidden rounded-xl border border-accent/40 bg-accent-soft">
                  <button onClick={() => doPreview(s)} title={s.rationale} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-2 hover:bg-accent/20">
                    <Zap className="size-3.5" />{s.title}{busy === s.id && "…"}
                  </button>
                  <button onClick={() => saveShortcut(s)} title="Save as a shortcut button" className="border-l border-accent/30 px-2 py-1.5 text-accent-2 hover:bg-accent/20"><Save className="size-3.5" /></button>
                </div>
              ))}
            </div>
          )}
          {trades.length > 0 && (
            <div className={cx("grid gap-2", !compact && "md:grid-cols-2")}>
              {trades.slice(0, compact ? 3 : 6).map((s) => (
                <div key={s.id} className="rounded-xl border border-line bg-bg-2/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium"><TrendingUp className="size-4 text-up" />{s.title}</div>
                    <Badge tone={s.strength === "high" ? "up" : s.strength === "medium" ? "accent" : "neutral"}>{s.strength}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{s.rationale}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" loading={busy === s.id} onClick={() => doPreview(s)}>Preview trade</Button>
                    {s.tags.map((t: string) => <Badge key={t} tone={t === "simulated data" ? "warn" : "neutral"}>{t}</Badge>)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {prompts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {prompts.slice(0, compact ? 3 : 6).map((s) => (
                <button key={s.id} onClick={() => openPrompt(s.prompt)} title={s.rationale}
                  className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent/50 hover:text-text">
                  <Sparkles className="size-3 text-accent-2" />{s.prompt}
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-faint">Generated from live market data and your positions. Ideas, not financial advice — every order is previewed and checked by the trading engine.</p>
        </div>
      )}
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Review suggested trade">
        {preview && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><b>{preview.plan.intent.side.toUpperCase()} {qty(preview.plan.quantity)} {preview.plan.asset.symbol}</b><PaperBadge paper={preview.plan.isPaper} /></div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>Est. price: <b className="num">{price(preview.plan.quote?.price)}</b></div><div>Notional: <b className="num">{usd(preview.plan.notionalUsd)}</b></div>
              <div>Fees: <b className="num">{usd(preview.plan.quote?.feeUsd ?? 0)}</b></div><div>Slippage: <b>{preview.plan.quote?.slippageBps ?? "—"} bps</b></div>
            </div>
            <p className="text-xs text-muted">{preview.s.rationale}</p>
            <ul className="space-y-0.5 text-[11px] text-warn">{preview.plan.risks.map((r: string) => <li key={r}>• {r}</li>)}</ul>
            <div className="text-xs text-muted">{preview.plan.checks.filter((c: any) => c.ok).length}/{preview.plan.checks.length} checks passed · {preview.plan.decisionReason}</div>
            <div className="flex gap-2">
              <Button variant="primary" loading={busy === "place"} disabled={preview.plan.decision === "rejected"} onClick={place}>Confirm & place</Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
