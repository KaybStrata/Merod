"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, Zap, TrendingUp, TrendingDown, ShieldCheck, Target, XCircle, PauseCircle, Repeat, Eye, Sparkles, Bot, Flame, DollarSign, CheckCircle2, AlertTriangle, SlidersHorizontal,
} from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Modal, PaperBadge, SourceBadge, cx, useToast } from "@/components/ui";
import { useShell } from "@/components/shell/context";
import { price, usd, qty } from "@/lib/format";

export const SHORTCUT_ICONS: Record<string, any> = {
  zap: Zap, "trending-up": TrendingUp, "trending-down": TrendingDown, shield: ShieldCheck, target: Target, x: XCircle, pause: PauseCircle,
  repeat: Repeat, eye: Eye, sparkles: Sparkles, bot: Bot, flame: Flame, dollar: DollarSign,
};
export function ShortcutIcon({ name, className }: { name: string; className?: string }) {
  const I = SHORTCUT_ICONS[name] ?? Zap;
  return <I className={className} />;
}

/** Custom one-click trading buttons. Every click previews through the trading engine before anything executes. */
export function ShortcutBar({ placement, assetId }: { placement: "terminal" | "dashboard"; assetId?: string }) {
  const { data, loading } = useApi<any>(`/api/shortcuts?placement=${placement}`);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [results, setResults] = useState<any | null>(null);
  const [executing, setExecuting] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const { openPrompt } = useShell();

  function handleClientActions(res: any, symbol?: string) {
    for (const r of res.results ?? []) {
      if (r.client === "analyze_asset") openPrompt(`Analyze ${symbol ?? "this asset"}`);
      if (r.client === "open_watchlist") router.push("/discover?tab=watchlist");
    }
  }

  async function execute(p: any, confirmed: boolean) {
    setExecuting(true);
    try {
      const r = await api(`/api/shortcuts/${p.shortcut.id}/execute`, { method: "POST", json: { mode: "execute", executionId: p.executionId, confirmed } });
      setResults(r); setPreview(null);
      handleClientActions(r, p.asset?.symbol);
      const okCount = r.results.filter((x: any) => x.ok).length;
      toast(`${p.shortcut.name}: ${okCount}/${r.results.length} actions completed`, r.status === "executed" ? "up" : r.status === "failed" ? "down" : "neutral");
    } catch (e: any) { toast(e.message, "down"); } finally { setExecuting(false); }
  }

  async function run(s: any) {
    setBusyId(s.id); setResults(null);
    try {
      const p = await api(`/api/shortcuts/${s.id}/execute`, { method: "POST", json: { mode: "preview", assetId: assetId ?? null } });
      const hasFinancial = p.plans.some((x: any) => x.kind === "order");
      // Shortcuts with no money at stake (e.g. "Analyze") or with confirmation disabled run straight away.
      if (!hasFinancial || !p.shortcut.requireConfirmation) await execute(p, false);
      else setPreview(p);
    } catch (e: any) { toast(e.message, "down"); } finally { setBusyId(null); }
  }

  const list: any[] = data?.shortcuts ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {loading && <span className="text-xs text-faint">Loading shortcuts…</span>}
      {!loading && list.length === 0 && <span className="text-xs text-muted">No shortcuts here yet.</span>}
      {list.map((s) => {
        const expired = s.expires_at && new Date(s.expires_at) < new Date();
        return (
          <button key={s.id} onClick={() => run(s)} disabled={!!busyId || expired} title={expired ? "Expired" : s.asset_symbol ? `Applies to ${s.asset_symbol}` : "Applies to the asset on screen"}
            style={s.color ? { borderColor: `${s.color}66`, color: s.color } : undefined}
            className={cx("inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 text-sm font-medium transition-colors hover:border-accent/60 disabled:opacity-50",
              !s.color && "text-text")}>
            <ShortcutIcon name={s.icon} className={cx("size-4", busyId === s.id && "animate-pulse")} />
            {s.name}
            {s.asset_symbol && <span className="text-[10px] text-faint">{s.asset_symbol}</span>}
          </button>
        );
      })}
      <Link href="/shortcuts" className="inline-flex h-9 items-center gap-1 rounded-xl border border-dashed border-line px-3 text-sm text-muted hover:border-accent/60 hover:text-text" title="Add a shortcut">
        <Plus className="size-4" />{list.length === 0 && "Add shortcut"}
      </Link>
      {list.length > 0 && (
        <Link href="/shortcuts" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 text-sm font-medium text-accent-2 hover:bg-accent/20"
          title="Customize your shortcut buttons: rename, recolor, change icons, amounts and order, duplicate or delete">
          <SlidersHorizontal className="size-4" /> Customize
        </Link>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `Confirm “${preview.shortcut.name}”` : ""} wide>
        {preview && (
          <div className="space-y-3">
            {preview.asset && <div className="text-sm text-muted">Applies to <span className="font-semibold text-text">{preview.asset.symbol}</span> · {preview.asset.venue}</div>}
            {preview.plans.map((p: any) => <ActionPreview key={p.index} p={p} />)}
            <p className="text-[11px] text-muted">Each order is re-validated by the trading engine at execution. Prices can move within your slippage limits.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
              <Button variant="primary" loading={executing} disabled={preview.plans.every((p: any) => p.blocked || (!p.deferred && p.plan?.decision === "rejected"))} onClick={() => execute(preview, true)}>
                Confirm {preview.plans.filter((p: any) => p.kind === "order" && !p.blocked && p.plan?.decision !== "rejected").length} order(s)
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!results} onClose={() => setResults(null)} title="Shortcut results">
        {results && (
          <ul className="space-y-2 text-sm">
            {results.results.map((r: any) => (
              <li key={r.index} className="flex items-start gap-2">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-down" />}
                <span><span className="font-medium">{r.description}</span> — <span className="text-muted">{r.message}</span>{r.status && <> <Badge>{r.status.replace(/_/g, " ")}</Badge></>}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function ActionPreview({ p }: { p: any }) {
  if (p.kind !== "order") return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-bg-2/60 px-3 py-2 text-sm">
      <span>{p.description}</span>{p.blocked ? <Badge tone="down">{p.error}</Badge> : <Badge>{p.kind === "client" ? "opens in app" : "account action"}</Badge>}
    </div>
  );
  if (p.deferred) return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-bg-2/60 px-3 py-2 text-sm"><span>{p.description}</span><Badge tone="info">after fill</Badge></div>
  );
  if (p.blocked || !p.plan) return (
    <div className="rounded-xl border border-down/30 bg-down-soft px-3 py-2 text-sm"><div className="font-medium">{p.description}</div><div className="text-xs text-down">{p.error}</div></div>
  );
  const pl = p.plan;
  const failed = pl.checks.filter((c: any) => !c.ok);
  return (
    <div className={cx("rounded-xl border px-3 py-2.5 text-sm", pl.decision === "rejected" ? "border-down/30 bg-down-soft" : "border-line bg-bg-2/60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{p.description}</span>
        <span className="flex gap-1.5"><PaperBadge paper={pl.isPaper} /><SourceBadge source={pl.price?.source} /></span>
      </div>
      <div className="num mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted sm:grid-cols-4">
        <span>Qty <span className="text-text">{qty(pl.quantity)}</span></span>
        <span>Price <span className="text-text">{price(pl.quote?.price ?? pl.price?.value)}</span></span>
        <span>Notional <span className="text-text">{usd(pl.notionalUsd)}</span></span>
        <span>Fees <span className="text-text">{usd(pl.quote?.feeUsd ?? 0)}</span></span>
      </div>
      {failed.length > 0 && <ul className="mt-1.5 space-y-0.5 text-[11px]">{failed.map((c: any) => <li key={c.name} className={c.severity === "warn" ? "text-warn" : "text-down"}>• {c.message}</li>)}</ul>}
      {pl.risks?.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-warn">{pl.risks.map((r: string) => <li key={r} className="flex gap-1"><AlertTriangle className="mt-px size-3 shrink-0" />{r}</li>)}</ul>}
      {pl.decision === "rejected" && <div className="mt-1 text-xs text-down">Will not execute: {pl.decisionReason}</div>}
    </div>
  );
}
