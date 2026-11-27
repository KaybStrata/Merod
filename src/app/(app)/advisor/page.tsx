"use client";
import { useState } from "react";
import { Lightbulb, RefreshCw, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle, useRealtime } from "@/components/shell/context";
import { cx, Empty, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { TipRow, TOPIC_LABEL, advisorChanged, useAdvisorSync } from "@/components/shell/AdvisorPanel";

const EVERY: [string, number][] = [["2 min", 2], ["5 min", 5], ["10 min", 10], ["30 min", 30], ["1 hour", 60], ["4 hours", 240]];
const TOPIC_HELP: Record<string, string> = {
  market: "Coins and stocks you hold or watch: big moves, profit to take, losses to protect, targets hit, plus the strongest liquid movers.",
  trades: "Your win rate and P&L, coins that keep losing.",
  bots: "Bots that keep losing, loose stop-losses, winners that deserve more, bots in error or never trading.",
  agents: "Agents that keep losing, are blocked by risk limits, failed or wait for approval.",
  prompts: "Prompts Merod couldn't act on, and prompts you repeat that could run on a schedule.",
};

export default function AdvisorPage() {
  usePageTitle({ section: "Insight · Advisor", title: "Your always-on trading advisor", accent: "always-on" });
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/advisor?limit=200", { refreshMs: 30_000 });
  useRealtime((e) => { if (e.type === "advisor") refresh(); });
  useAdvisorSync(refresh);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const s = data?.settings, on = !!s?.active;
  const tips: any[] = (data?.tips ?? []).filter((t: any) => filter === "all" || t.topic === filter);
  async function save(patch: any) {
    try { await api("/api/advisor", { method: "POST", json: patch }); await refresh(); advisorChanged(); } catch (e: any) { toast(e.message, "down"); }
  }
  async function checkNow() {
    setBusy(true);
    try { const r = await api("/api/advisor/run", { method: "POST" }); toast(r.added ? `${r.added} new suggestion${r.added === 1 ? "" : "s"}` : "Nothing new right now", "up"); await refresh(); advisorChanged(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <section className="surface rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Lightbulb className={cx("size-5", on ? "text-accent-2" : "text-faint")} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Advisor is {on ? "on" : "off"}</div>
            <div className="text-[12.5px] text-muted">{on ? `Analysing every ${s.every_min} min, around the clock, until you turn it off${s.last_run_at ? ` · last check ${ago(s.last_run_at)}` : ""}.` : "Turn it on and Merod keeps analysing coin and stock data and your trades, bots, agents and prompts, and suggests improvements. Nothing changes unless you press Apply."}</div>
          </div>
          <button onClick={checkNow} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted hover:text-text disabled:opacity-60">{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Check now</button>
          <button onClick={() => save({ active: !on }).then(() => { if (!on) void checkNow(); })} className={cx("rounded-lg px-4 py-1.5 text-[13px] font-semibold", on ? "border border-down/50 text-down" : "bg-grad text-bg")}>{on ? "Turn off" : "Turn on"}</button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {Object.keys(TOPIC_LABEL).map((k) => {
            const v = s?.topics?.[k] !== false;
            return (
              <label key={k} className={cx("cursor-pointer rounded-xl border p-2.5", v ? "border-accent/40 bg-accent/5" : "border-line")}>
                <div className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={v} onChange={(e) => save({ topics: { [k]: e.target.checked } })} />{TOPIC_LABEL[k]}</div>
                <div className="mt-1 text-[11.5px] leading-snug text-muted">{TOPIC_HELP[k]}</div>
              </label>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px]">
          <label className="flex items-center gap-1.5 text-muted">Check every
            <select value={s?.every_min ?? 10} onChange={(e) => save({ everyMin: Number(e.target.value) })} className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5">{EVERY.map(([l, m]) => <option key={m} value={m}>{l}</option>)}</select>
          </label>
          <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={!!s?.notify} onChange={(e) => save({ notify: e.target.checked })} />Also send important suggestions as notifications</label>
        </div>
      </section>

      <section className="surface rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-2 text-[14px] font-semibold">Suggestions</span>
          {["all", ...Object.keys(TOPIC_LABEL)].map((k) => <button key={k} onClick={() => setFilter(k)} className={cx("rounded-md px-2 py-0.5 text-[12px]", filter === k ? "bg-accent/20 text-accent-2" : "text-muted hover:text-text")}>{k === "all" ? "All" : TOPIC_LABEL[k]}</button>)}
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {tips.map((t) => <TipRow key={t.id} t={t} onDone={refresh} />)}
        </div>
        {!tips.length && <Empty icon={<Lightbulb className="size-6" />} title={on ? "No suggestions right now" : "Advisor is off"}>{on ? "New ones appear here automatically as markets move and you trade." : "Turn it on above."}</Empty>}
      </section>
    </div>
  );
}
