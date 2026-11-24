"use client";
import Link from "next/link";
import { useState } from "react";
import { Brain, RefreshCw, Check, X, Globe2, Undo2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, Button, Card, Empty, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const CAT_TONE: Record<string, "up" | "down" | "accent" | "info" | "warn" | "neutral"> = { performance: "accent", asset: "warn", execution: "info", strategy: "up", timing: "neutral", platform: "neutral" };

/** Live feed of what Merod AI has learned from trades. "Update" applies a learning to the user's data (revertible). */
export function LearningFeed({ compact = false }: { compact?: boolean }) {
  const toast = useToast();
  const { connected } = useShell();
  const { data, refresh } = useApi<any>("/api/learning", { refreshMs: connected ? 60000 : 15000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  useRealtime((e) => {
    if (e.type === "learning" || e.type === "training") { refresh(); if (e.payload?.fresh) { setPulse(true); setTimeout(() => setPulse(false), 2000); } }
  });

  async function act(id: string, action: "apply" | "dismiss") {
    setBusy(id + action);
    try { await api(`/api/learning/${id}`, { method: "POST", json: { action } }); toast(action === "apply" ? "Updated — you can revert it in Auto-Training history" : "Dismissed", action === "apply" ? "up" : "neutral"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function bulk(action: "refresh" | "apply_all") {
    setBusy(action);
    try {
      const r = await api("/api/learning", { method: "POST", json: { action } });
      toast(action === "refresh" ? (r.fresh ? `${r.fresh} new learning(s)` : "Up to date — no new learnings") : `Applied ${r.applied} update(s)`, "up");
      refresh();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  const personal: any[] = data?.personal ?? [];
  const updatable = personal.filter((l) => l.proposed_update).length;
  return (
    <Card
      title={<span className="flex items-center gap-2">Merod AI learning <span className={cx("flex items-center gap-1 text-[11px] font-normal", pulse ? "text-accent-2" : "text-up")}><span className={cx("size-1.5 rounded-full pulse-dot", pulse ? "bg-accent-2" : "bg-up")} />{pulse ? "new insight" : "live"}</span></span>}
      icon={<Brain className="size-4 text-accent-2" />}
      action={
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" loading={busy === "refresh"} onClick={() => bulk("refresh")} title="Re-learn from your latest trades"><RefreshCw className="size-3.5" />{!compact && " Learn now"}</Button>
          {updatable > 0 && <Button size="sm" variant="primary" loading={busy === "apply_all"} onClick={() => bulk("apply_all")}>Update all ({updatable})</Button>}
        </div>
      }>
      {!data ? <div className="h-24 animate-pulse rounded-xl bg-panel-2" /> : personal.length === 0 && !(data.platform ?? []).length ? (
        <Empty icon={<Brain className="size-6" />} title="Still learning">Merod learns from closed trades, rejected orders and bot cycles. Insights appear here as results come in.</Empty>
      ) : (
        <div className="space-y-2.5">
          {data.stats?.last_learned && <div className="text-[11px] text-faint">Last learned {ago(data.stats.last_learned)} · {data.stats.applied ?? 0} updates applied so far</div>}
          {personal.slice(0, compact ? 4 : 50).map((l) => (
            <div key={l.id} className="rounded-xl border border-line bg-bg-2/60 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={CAT_TONE[l.category] ?? "neutral"}>{l.category}</Badge>
                <Badge tone={l.confidence === "high" ? "up" : l.confidence === "medium" ? "accent" : "neutral"} title={`Based on ${l.sample_size} data points`}>{l.confidence} confidence · n={l.sample_size}</Badge>
                <span className="ml-auto text-[10px] text-faint">{ago(l.updated_at)}</span>
              </div>
              <div className="mt-1.5 text-sm font-medium">{l.title}</div>
              <p className="mt-0.5 text-xs text-muted">{l.insight}</p>
              {!compact && (
                <details className="mt-1 text-[11px] text-faint"><summary className="cursor-pointer">Evidence</summary>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-bg p-2">{JSON.stringify(l.evidence, null, 2)}</pre></details>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {l.proposed_update ? (
                  <>
                    <Button size="sm" variant="primary" loading={busy === l.id + "apply"} onClick={() => act(l.id, "apply")}><Check className="size-3.5" /> Update</Button>
                    <span className="text-xs text-accent-2">{l.proposed_update.label}</span>
                  </>
                ) : <span className="text-[11px] text-faint">Insight only — nothing to change</span>}
                <button onClick={() => act(l.id, "dismiss")} className="ml-auto text-faint hover:text-text" aria-label="Dismiss"><X className="size-3.5" /></button>
              </div>
            </div>
          ))}
          {compact && personal.length > 4 && <Link href="/learning" className="block text-center text-xs text-accent-2">See all {personal.length} learnings</Link>}
          {!compact && (data.platform ?? []).length > 0 && (
            <div className="pt-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><Globe2 className="size-3.5" /> Learned across Merod (anonymized)</div>
              {data.platform.map((l: any) => (
                <div key={l.id} className="border-t border-line py-2 text-xs"><span className="font-medium text-text">{l.title}</span><span className="text-muted"> — {l.insight}</span></div>
              ))}
            </div>
          )}
          {!compact && (data.applied ?? []).length > 0 && (
            <div className="pt-2">
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted"><span>Recently applied / dismissed</span><Link href="/training" className="flex items-center gap-1 text-accent-2"><Undo2 className="size-3" /> Revert in history</Link></div>
              {data.applied.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-xs"><span className="truncate">{l.title}</span><Badge tone={l.status === "applied" ? "up" : "neutral"}>{l.status}</Badge></div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-faint">Learnings come from your own results and anonymized platform data. Updates only tighten risk or adjust strategy settings you own, and every one can be reverted. Past results don't guarantee future performance.</p>
        </div>
      )}
    </Card>
  );
}
