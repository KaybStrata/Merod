"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Brain, GraduationCap, RefreshCw, Check, X, Globe2, Sparkles, ShieldCheck, Radio } from "lucide-react";
import { SectionTabs } from "@/components/SectionTabs";
import { TeachMerod } from "@/components/TeachMerod";
import { api, useApi } from "@/lib/api";
import { usePageTitle, useRealtime } from "@/components/shell/context";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { fmtUsd } from "@/components/agents/common";

const CONF: Record<string, number> = { low: 0.4, medium: 0.65, high: 0.9 };
const CATS: [string, string][] = [["performance", "Performance & sizing"], ["strategy", "Strategy selection"], ["asset", "Asset picking"], ["timing", "Entry timing"], ["execution", "Execution quality"]];

/** Teach Merod (design 16): confidence ring, skill bars, risk profile, recent lessons with Apply, and the teaching box. */
export default function LearningPage() {
  usePageTitle({ section: "Insight · AI Learning", title: "Teach Merod", accent: "Merod" });
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/learning", { refreshMs: 30000 });
  const materials = useApi<any>("/api/learning/materials", { refreshMs: 30000 });
  const settings = useApi<any>("/api/settings");
  const training = useApi<any>("/api/training");
  const [busy, setBusy] = useState<string | null>(null);
  useRealtime((e) => { if (e.type === "learning" || e.type === "training") refresh(); });
  const personal: any[] = data?.personal ?? [], platform: any[] = data?.platform ?? [], applied: any[] = data?.applied ?? [];
  const stats = data?.stats ?? {};

  const { overall, samples, byCat } = useMemo(() => {
    const all = [...personal, ...applied.filter((a) => a.status === "applied")];
    const w = personal.reduce((s, l) => s + Math.max(1, l.sample_size), 0);
    const overall = w ? Math.round((personal.reduce((s, l) => s + CONF[l.confidence] * Math.max(1, l.sample_size), 0) / w) * 100) : null;
    const byCat = CATS.map(([k, label]) => {
      const ls = personal.filter((l) => l.category === k);
      return { k, label, n: ls.length, pct: ls.length ? Math.round((ls.reduce((s, l) => s + CONF[l.confidence], 0) / ls.length) * 100) : null };
    });
    return { overall, samples: all.reduce((s, l) => s + Number(l.sample_size ?? 0), 0), byCat };
  }, [personal, applied]);

  const risk = settings.data?.risk, ts = training.data?.settings, defaults = training.data?.defaults;
  const caps = [risk?.max_order_usd, risk?.max_daily_spend_usd, risk?.max_daily_loss_usd].map(Number);
  const profile = !risk ? "—" : caps.every((c) => !(c > 0)) ? "Bold" : caps.some((c) => !(c > 0)) ? "Measured bold" : "Measured";

  async function act(id: string, action: "apply" | "dismiss") {
    setBusy(id + action);
    try { await api(`/api/learning/${id}`, { method: "POST", json: { action } }); toast(action === "apply" ? "Applied. You can revert it in Auto-Training history." : "Dismissed", action === "apply" ? "up" : "neutral"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function bulk(action: "refresh" | "apply_all") {
    setBusy(action);
    try { const r: any = await api("/api/learning", { method: "POST", json: { action } }); toast(action === "refresh" ? (r.fresh ? `${r.fresh} new lesson(s)` : "Up to date: no new lessons") : `Applied ${r.applied} update(s)`, "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  const ring = overall ?? 0, R = 46, C = 2 * Math.PI * R;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTabs tabs={[{ href: "/learning", label: "AI Learning", icon: Brain }, { href: "/training", label: "Auto-Training", icon: GraduationCap }]} />
        <div className="flex gap-1.5">
          <Link href="/live" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-2 px-2.5 text-[12px] hover:border-accent/50"><Radio className="size-3.5" /> Live activity</Link>
          <button onClick={() => bulk("refresh")} disabled={!!busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-2 px-2.5 text-[12px] hover:border-accent/50 disabled:opacity-50"><RefreshCw className={cx("size-3.5", busy === "refresh" && "animate-spin")} /> Learn now</button>
          <button onClick={() => bulk("apply_all")} disabled={!!busy || !stats.updatable} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-grad px-3 text-[12px] font-semibold text-bg disabled:opacity-50"><Check className="size-3.5" /> Apply {stats.updatable || 0} update{stats.updatable === 1 ? "" : "s"}</button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
            <section className="surface flex items-center gap-4 rounded-2xl p-4">
              <div className="relative shrink-0">
                <svg width="112" height="112" className="-rotate-90"><circle cx="56" cy="56" r={R} stroke="var(--line-2)" strokeWidth="7" fill="none" /><circle cx="56" cy="56" r={R} stroke="var(--accent)" strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C - (ring / 100) * C} /></svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="num text-[1.6rem] font-semibold leading-none">{overall == null ? "—" : `${overall}%`}</span><span className="mt-0.5 text-[10px] text-faint">confidence</span></div>
              </div>
              <div className="min-w-0 text-[12px]">
                <div className="text-[14px] font-semibold">{overall == null ? "Still learning you" : overall >= 75 ? "Knows your style" : overall >= 55 ? "Getting to know you" : "Early read"}</div>
                <p className="mt-1 text-muted">From {samples.toLocaleString()} trades and cycles reviewed{stats.last_learned ? `, last lesson ${ago(stats.last_learned)}` : ""}.</p>
              </div>
            </section>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile k="Active lessons" v={String(stats.active ?? 0)} />
              <Tile k="Updates ready" v={String(stats.updatable ?? 0)} accent />
              <Tile k="Applied" v={String(stats.applied ?? 0)} />
              <Tile k="Materials taught" v={String(materials.data?.materials?.length ?? 0)} />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="surface rounded-2xl p-4">
              <h3 className="text-[13px] font-semibold">Skill confidence</h3>
              <ul className="mt-3 space-y-2.5">
                {byCat.map((c) => (
                  <li key={c.k} className="flex items-center gap-3 text-[12px]">
                    <span className="w-36 shrink-0 text-muted">{c.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-grad" style={{ width: `${c.pct ?? 0}%` }} /></span>
                    <span className="num w-10 text-right">{c.pct == null ? "—" : `${c.pct}%`}</span>
                    <span className="w-14 text-right text-[10.5px] text-faint">{c.n} lesson{c.n === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="surface rounded-2xl p-4">
              <div className="flex items-baseline justify-between"><h3 className="text-[13px] font-semibold">Risk tolerance</h3><Link href="/settings" className="text-[11px] text-muted hover:text-text">Edit limits →</Link></div>
              <div className="mt-1 text-[1.35rem] font-semibold">{profile.split(" ").map((w, i) => i === 1 ? <span key={i} className="serif-accent ml-1.5 text-[1.55rem] text-accent-2">{w}</span> : <span key={i}>{w}</span>)}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Tile k="Max order" v={Number(risk?.max_order_usd) > 0 ? fmtUsd(Number(risk.max_order_usd), 0) : "No limit"} small />
                <Tile k="Daily loss cap" v={Number(risk?.max_daily_loss_usd) > 0 ? fmtUsd(Number(risk.max_daily_loss_usd), 0) : "No limit"} small />
                <Tile k="Learned stop-loss" v={defaults?.default_stop_loss_pct ? `${defaults.default_stop_loss_pct}%` : "—"} small />
                <Tile k="Pause after losses" v={ts ? `${ts.pause_after_losses} in a row` : "—"} small />
              </div>
            </section>
          </div>

          <section className="surface rounded-2xl">
            <header className="flex items-center gap-2 border-b border-line px-4 py-2.5"><Sparkles className="size-4 text-accent-2" /><h3 className="text-[13px] font-semibold">Recent lessons</h3><span className="text-[11px] text-faint">Nothing changes until you press Apply</span></header>
            {!personal.length && !platform.length ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted">No lessons yet. Merod reviews closed trades, rejected orders and bot cycles every few minutes, or teach it directly on the right.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-[10px] uppercase tracking-[0.12em] text-faint"><tr><th className="px-4 py-2 font-semibold">Lesson</th><th className="font-semibold">Area</th><th className="font-semibold">Confidence</th><th className="text-right font-semibold">Sample</th><th className="text-right font-semibold">Learned</th><th className="px-4 text-right font-semibold" /></tr></thead>
                  <tbody>
                    {personal.map((l) => (
                      <tr key={l.id} className="border-t border-line/60 align-top">
                        <td className="max-w-[440px] px-4 py-2.5"><div className="font-medium">{l.title}</div><div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{l.insight}</div></td>
                        <td className="py-2.5 capitalize text-muted">{l.category}</td>
                        <td className="py-2.5"><Conf c={l.confidence} /></td>
                        <td className="num py-2.5 text-right">{l.sample_size}</td>
                        <td className="py-2.5 text-right text-[11px] text-faint">{ago(l.updated_at)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          {l.proposed_update && <button onClick={() => act(l.id, "apply")} disabled={!!busy} className="mr-1 inline-flex h-7 items-center gap-1 rounded-md bg-grad px-2.5 text-[11.5px] font-semibold text-bg disabled:opacity-50"><Check className="size-3" /> Apply</button>}
                          <button onClick={() => act(l.id, "dismiss")} disabled={!!busy} className="inline-flex size-7 items-center justify-center rounded-md border border-line-2 text-muted hover:text-text disabled:opacity-50" aria-label="Dismiss"><X className="size-3" /></button>
                        </td>
                      </tr>
                    ))}
                    {platform.map((l) => (
                      <tr key={l.id} className="border-t border-line/60 align-top">
                        <td className="max-w-[440px] px-4 py-2.5"><div className="flex items-center gap-1.5 font-medium"><Globe2 className="size-3.5 text-faint" />{l.title}</div><div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{l.insight}</div></td>
                        <td className="py-2.5 text-muted">Platform</td>
                        <td className="py-2.5"><Conf c={l.confidence} /></td>
                        <td className="num py-2.5 text-right">{l.sample_size}</td>
                        <td className="py-2.5 text-right text-[11px] text-faint">{ago(l.updated_at)}</td>
                        <td className="px-4 py-2 text-right text-[11px] text-faint">Insight</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {applied.length > 0 && (
              <details className="border-t border-line px-4 py-2.5 text-[12px]">
                <summary className="cursor-pointer text-muted">History ({applied.length})</summary>
                <ul className="mt-2 space-y-1">{applied.map((a) => <li key={a.id} className="flex items-center gap-2"><span className={cx("rounded px-1.5 py-px text-[10px]", a.status === "applied" ? "bg-up-soft text-up" : "bg-panel-2 text-muted")}>{a.status}</span><span className="flex-1 truncate">{a.title}</span><span className="text-[11px] text-faint">{ago(a.applied_at ?? a.updated_at)}</span></li>)}</ul>
                <Link href="/training" className="mt-2 inline-block text-[11px] text-accent-2">Revert changes in Auto-Training →</Link>
              </details>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          <TeachMerod />
          <section className="surface rounded-2xl p-4 text-[12px] text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-text"><ShieldCheck className="size-4 text-up" /> How learning works</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Every few minutes Merod reviews closed trades, rejected orders and bot cycles.</li>
              <li>It finds patterns: losing methods and assets, execution problems, timing, better bot settings.</li>
              <li>Each lesson shows its evidence, sample size and confidence.</li>
              <li><b className="text-text">Apply</b> makes the proposed change. Every change is logged and revertible.</li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Tile({ k, v, accent, small }: { k: string; v: string; accent?: boolean; small?: boolean }) {
  return <div className="rounded-xl border border-line bg-bg-2/60 px-3 py-2.5"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{k}</div><div className={cx("num mt-1 font-semibold", small ? "text-[14px]" : "text-[1.35rem]", accent && "text-accent-2")}>{v}</div></div>;
}
function Conf({ c }: { c: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium capitalize", c === "high" ? "bg-up-soft text-up" : c === "medium" ? "bg-accent-soft text-accent-2" : "bg-panel-2 text-muted")}>{c}</span>;
}
