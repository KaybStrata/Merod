"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Brain, Target, CheckCircle2, Flag, Search, Pause, Play, Cpu, Sparkles } from "lucide-react";
import { useApi } from "@/lib/api";
import { useRealtime, usePageTitle } from "@/components/shell/context";
import { MimicTabs } from "@/components/MimicTabs";
import { cx } from "@/components/ui";

type Ev = { at: string; kind: "decision" | "execution" | "close" | "thought"; text: string };
const KINDS: { k: Ev["kind"]; label: string; icon: any; cls: string }[] = [
  { k: "thought", label: "Thoughts", icon: Brain, cls: "text-[#c9b6ff] bg-[rgba(185,163,240,.14)]" },
  { k: "decision", label: "Decisions", icon: Target, cls: "text-[#8fbcff] bg-[rgba(106,168,255,.14)]" },
  { k: "execution", label: "Executions", icon: CheckCircle2, cls: "text-up bg-up-soft" },
  { k: "close", label: "Closes", icon: Flag, cls: "text-accent-2 bg-accent-soft" },
];
const SINGULAR: Record<string, string> = { thought: "Thought", decision: "Decision", execution: "Execution", close: "Close" };
const time = (t: string) => {
  const d = new Date(t), today = d.toDateString() === new Date().toDateString();
  const hms = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  return today ? hms : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hms.slice(0, 5)}`;
};

/** Full-page live feed of auto trading (origin=auto) or Modo (origin=modo): thoughts, decisions, executions and closes. */
export function AutoActivityPage({ origin }: { origin: "auto" | "modo" }) {
  const modo = origin === "modo";
  usePageTitle({ section: "Automate · Auto trading", title: modo ? "Modo activity" : "Auto trade activity", accent: "activity" });
  const [paused, setPaused] = useState(false);
  const { data, refresh, error } = useApi<any>(`/api/auto/activity?origin=${origin}&full=1`, { refreshMs: paused ? 0 : 5000 });
  useRealtime((e: any) => { if (!paused && (e.type === "auto" || e.type === "modo")) refresh(); });
  const [kinds, setKinds] = useState<Set<string>>(new Set(KINDS.map((k) => k.k)));
  const [q, setQ] = useState("");
  const events: Ev[] = data?.events ?? [];
  const shown = useMemo(() => events.filter((e) => kinds.has(e.kind) && (!q || e.text.toLowerCase().includes(q.toLowerCase()))), [events, kinds, q]);
  const live = modo ? data?.modoAutopilot : data?.enabled;
  const s = data?.stats;
  const count = (k: string) => events.filter((e) => e.kind === k).length;
  const hour = events.filter((e) => Date.now() - new Date(e.at).getTime() < 3_600_000).length;

  return (
    <div className="space-y-4">
      <MimicTabs />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {KINDS.map(({ k, label, icon: I, cls }) => (
              <button key={k} onClick={() => setKinds((cur) => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); return n; })}
                className={cx("flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-opacity", cls, !kinds.has(k) && "opacity-35")}>
                <I className="size-3.5" />{label}<span className="num text-[11px] opacity-70">{count(k)}</span>
              </button>
            ))}
            <div className="relative ml-auto"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by coin, stock, word…" className="h-8 w-56 rounded-lg border border-line bg-panel/70 pl-8 pr-3 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60" /></div>
            <button onClick={() => { setPaused(!paused); if (paused) refresh(); }} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] hover:border-accent/50">
              {paused ? <><Play className="size-3.5" /> Resume</> : <><Pause className="size-3.5" /> Pause</>}
            </button>
          </div>
          <section className="surface rounded-2xl">
            {error && <p className="p-8 text-center text-sm text-muted">{String((error as any)?.message ?? error)}</p>}
            {!error && !shown.length && (
              <p className="p-10 text-center text-sm text-muted">
                {events.length ? "Nothing matches these filters." : live ? (modo ? "Modo is watching the markets. Its thoughts and trades stream here." : "Auto trading is on and watching the markets. Decisions stream here.")
                  : <>{modo ? "Modo Autopilot is off." : "Auto trading is off."} Turn it on in <Link href="/auto" className="text-accent-2 underline">Auto trading</Link> and every thought, decision and trade streams here live.</>}
              </p>
            )}
            <ol>
              {shown.map((e, i) => {
                const K = KINDS.find((k) => k.k === e.kind) ?? KINDS[0];
                return (
                  <li key={`${e.at}-${i}`} className="flex items-start gap-3 border-b border-line/60 px-4 py-3 last:border-0 hover:bg-panel-2/40">
                    <span className="num w-[70px] shrink-0 pt-0.5 text-[11.5px] text-faint">{time(e.at)}</span>
                    <span className={cx("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", K.cls)}><K.icon className="size-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <span className={cx("rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", K.cls)}>{SINGULAR[e.kind]}</span>
                      <div className="mt-1 text-[13.5px] leading-snug">{e.text}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="space-y-3">
          <div className="surface rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[13px] font-semibold">{modo ? <Sparkles className="size-4 text-accent-2" /> : <Cpu className="size-4 text-accent-2" />}{modo ? "Modo Autopilot" : "Auto trading"}</span>
              <span className={cx("flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", paused ? "border-warn/40 text-warn" : live ? "border-up/40 text-up" : "border-line text-faint")}>
                <span className={cx("size-1.5 rounded-full", paused ? "bg-warn" : live ? "bg-up pulse-dot" : "bg-faint")} />{paused ? "PAUSED" : live ? "LIVE" : "OFF"}
              </span>
            </div>
            {modo && data?.lastRun && <p className="mt-1 text-[11.5px] text-muted">Last run {time(new Date(data.lastRun).toISOString())}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[["Events / hour", hour], ["Trades", s?.trades ?? 0], ["Real money", s?.real ?? 0], ["Theoretical", s?.theory ?? 0], ["Closed", s?.closed ?? 0],
                ["Win rate", s?.closed ? `${Math.round((s.wins / s.closed) * 100)}%` : "—"]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-line bg-bg/40 px-2.5 py-2"><div className="text-[10.5px] uppercase tracking-wide text-faint">{l}</div><div className="num text-[15px] font-semibold">{v}</div></div>
              ))}
            </div>
            {s?.avgReturn != null && <p className={cx("mt-2 text-[12px]", s.avgReturn >= 0 ? "text-up" : "text-down")}>Average closed return {s.avgReturn >= 0 ? "+" : ""}{Number(s.avgReturn).toFixed(2)}%</p>}
            <Link href="/auto" className="mt-3 flex h-8 items-center justify-center rounded-lg bg-grad text-[12.5px] font-semibold text-bg">{modo ? "Modo settings" : "Auto trading settings"}</Link>
          </div>
          <div className="surface rounded-2xl p-4 text-[12px] text-muted">
            <div className="mb-1 font-semibold text-text">Also see</div>
            <Link href={modo ? "/auto/activity" : "/modo/activity"} className="block py-0.5 text-accent-2 hover:underline">{modo ? "Auto trade activity →" : "Modo activity →"}</Link>
            <Link href="/live" className="block py-0.5 text-accent-2 hover:underline">Everything (Activity) →</Link>
            <p className="mt-2 text-[11px] text-faint">Updates every 5 seconds and instantly on live events. Decision summaries only, never private model chain-of-thought.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
