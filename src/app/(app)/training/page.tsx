"use client";
import Link from "next/link";
import { useState } from "react";
import { GraduationCap, ShieldCheck, Undo2, Bot, Zap, Sparkles } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { Badge, Button, Card, Empty, Select, Skeleton, Stat, StatusPill, Toggle, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

export default function TrainingPage() {
  const { data, refresh, loading } = useApi<any>("/api/training");
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  useRealtime((e) => { if (e.type === "training") { refresh(); toast(`Auto-training: ${e.payload.reason}`); } });

  async function patch(body: any) {
    try { await api("/api/training", { method: "PATCH", json: body }); refresh(); } catch (e: any) { toast(e.message, "down"); }
  }
  async function override(kind: "bot" | "shortcut", id: string, mode: string) {
    try { await api("/api/training", { method: "POST", json: { kind, id, mode } }); refresh(); } catch (e: any) { toast(e.message, "down"); }
  }
  async function revert(id: string) {
    setBusy(id);
    try { await api(`/api/training/${id}`, { method: "POST" }); toast("Change reverted", "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  if (loading || !data) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  const s = data.settings;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><GraduationCap className="size-6 text-accent-2" /> Auto-Training</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Automatically corrects your bots, shortcuts and prompt-trade defaults after mistakes, wrong trades or losses — and only ever in the
            direction of <b className="text-text">less risk</b>. Every change is logged and can be reverted.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3">
          <span className="text-sm font-medium">{s.enabled ? "On" : "Off"}</span>
          <Toggle checked={s.enabled} onChange={(v) => patch({ enabled: v })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="What it adjusts" icon={<ShieldCheck className="size-4 text-up" />} className="lg:col-span-2">
          <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
            <li>• <b className="text-text">Dip loops:</b> wait for a deeper dip after a losing cycle; add / tighten the stop-loss</li>
            <li>• <b className="text-text">All bots:</b> shrink trade size after losses or engine rejections (never below 25% or above your original)</li>
            <li>• <b className="text-text">Trend bots:</b> lengthen the slow moving average to filter false signals</li>
            <li>• <b className="text-text">Loss streaks:</b> pause a bot after {s.pause_after_losses} consecutive losses for your review</li>
            <li>• <b className="text-text">Shortcuts:</b> reduce buy sizes after rejections/losses; add a protective stop-loss</li>
            <li>• <b className="text-text">Prompt trades:</b> learn an automatic stop-loss and a size threshold that asks for approval</li>
          </ul>
          <p className="mt-3 text-xs text-faint">Never changes your permissions, risk limits or feature flags; never widens slippage or raises budgets. Rule-based and transparent — it cannot guarantee profit.</p>
        </Card>
        <Card title="Status">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Active changes" value={data.stats?.active ?? 0} />
            <Stat label="Reverted" value={data.stats?.reverted ?? 0} />
            <Stat label="Today" value={`${data.stats?.today ?? 0}/${s.max_adjustments_per_day}`} />
          </div>
        </Card>
      </div>

      <Card title="Scope & limits">
        <div className="flex flex-wrap gap-6">
          <Toggle checked={s.scope_bots} disabled={!s.enabled} onChange={(v) => patch({ scope_bots: v })} label="Bots & agents" />
          <Toggle checked={s.scope_shortcuts} disabled={!s.enabled} onChange={(v) => patch({ scope_shortcuts: v })} label="Shortcut buttons" />
          <Toggle checked={s.scope_prompts} disabled={!s.enabled} onChange={(v) => patch({ scope_prompts: v })} label="Prompt-to-trade" />
          <Select label="Pause bot after consecutive losses" value={s.pause_after_losses} onChange={(e) => patch({ pause_after_losses: Number(e.target.value) })} className="w-56">
            {[1, 2, 3, 4, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <Select label="Max adjustments per day" value={s.max_adjustments_per_day} onChange={(e) => patch({ max_adjustments_per_day: Number(e.target.value) })} className="w-48">
            {[3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
        {data.defaults && (data.defaults.default_stop_loss_pct || data.defaults.max_prompt_order_usd) && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium"><Sparkles className="size-4 text-accent-2" /> Learned prompt-trade defaults</div>
            <div className="mt-1 text-muted">
              {data.defaults.default_stop_loss_pct && <>Automatic stop-loss: <b className="text-text">{data.defaults.default_stop_loss_pct}%</b>. </>}
              {data.defaults.max_prompt_order_usd && <>Prompt orders above <b className="text-text">${data.defaults.max_prompt_order_usd}</b> ask for approval.</>}
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Bots" icon={<Bot className="size-4 text-accent-2" />}>
          {data.bots.length === 0 ? <Empty title="No bots yet"><Link href="/bots" className="text-accent-2">Create a bot</Link></Empty> : (
            <div className="divide-y divide-line">
              {data.bots.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/bots/${b.id}`} className="truncate text-sm font-medium hover:text-accent-2">{b.name}</Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-faint"><StatusPill status={b.status} /> {b.loss_streak > 0 && <Badge tone="down">{b.loss_streak} loss streak</Badge>} {b.original_config && <Badge tone="accent">tuned</Badge>}</div>
                  </div>
                  <Select value={b.auto_training} onChange={(e) => override("bot", b.id, e.target.value)} className="w-40">
                    <option value="inherit">Inherit ({s.enabled && s.scope_bots ? "on" : "off"})</option><option value="on">Always on</option><option value="off">Off for this bot</option>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Shortcuts" icon={<Zap className="size-4 text-accent-2" />}>
          {data.shortcuts.length === 0 ? <Empty title="No shortcuts yet"><Link href="/shortcuts" className="text-accent-2">Create a shortcut</Link></Empty> : (
            <div className="divide-y divide-line">
              {data.shortcuts.map((sc: any) => (
                <div key={sc.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 truncate text-sm font-medium">{sc.name} {sc.original_config && <Badge tone="accent">tuned</Badge>}</div>
                  <Select value={sc.auto_training} onChange={(e) => override("shortcut", sc.id, e.target.value)} className="w-40">
                    <option value="inherit">Inherit ({s.enabled && s.scope_shortcuts ? "on" : "off"})</option><option value="on">Always on</option><option value="off">Off</option>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Change history">
        {data.adjustments.length === 0 ? (
          <Empty icon={<GraduationCap className="size-6" />} title="No corrections yet">Auto-training reviews results every minute. Changes appear here after a losing trade or a rejected order.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {data.adjustments.map((a: any) => (
              <div key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={a.target_type === "bot" ? "accent" : a.target_type === "shortcut" ? "info" : "neutral"}>{a.target_type.replace("_", " ")}</Badge>
                    <span className="font-medium">{a.target_name}</span>
                    <span className="text-xs text-faint">{ago(a.created_at)}</span>
                    {a.status === "reverted" && <Badge tone="warn">reverted</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">{a.reason}</p>
                  <details className="mt-1 text-xs text-faint">
                    <summary className="cursor-pointer">Before / after</summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-bg-2 p-2 text-[11px]">{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                  </details>
                </div>
                {a.status === "applied" && <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => revert(a.id)}><Undo2 className="size-3.5" /> Revert</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
