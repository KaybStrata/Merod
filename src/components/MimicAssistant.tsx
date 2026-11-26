"use client";
import Link from "next/link";
import { useState } from "react";
import { Sparkles, Send, Bot, Lightbulb, Trophy, Plus, ArrowRight, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useToast } from "@/components/ui";
import { FleetReview } from "@/components/agents/FleetReview";
import { StatusDot } from "@/components/agents/common";

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const ask = (t: string) => window.dispatchEvent(new CustomEvent("merod-prompt", { detail: t }));
const openModo = () => { try { localStorage.setItem("merod-rail-tab", "modo"); } catch {} window.dispatchEvent(new Event("merod-rail-tab")); };

/** Mimic trading side panel: Modo access, data-driven suggestions, suggested prompts and wallet/mimic agents. */
export function MimicAssistant() {
  const dir = useApi<any>("/api/traders", { refreshMs: 60000 });
  const ag = useApi<any>("/api/agents", { refreshMs: 30000 });
  const toast = useToast();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const d = dir.data;
  const gainers: any[] = d?.gainers ?? [];
  const wallets: any[] = d?.wallets ?? [];
  const traders: any[] = [...(d?.merod ?? []), ...(d?.stocks ?? [])].filter((t, i, a) => a.findIndex((x) => x.handle === t.handle) === i);
  const bestTrader = traders.filter((t) => t.copyable && t.winRate != null && t.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  const bestStock = (d?.stocks ?? []).filter((t: any) => t.copyable && t.stockTrades > 0).sort((a: any, b: any) => b.stockPnl - a.stockPnl)[0];
  const top = gainers[0], active = [...wallets].sort((a, b) => (b.trades ?? 0) - (a.trades ?? 0))[0];
  const mimicking = [...gainers, ...wallets].filter((w, i, a) => w.mimic && a.findIndex((x) => x.address === w.address) === i).length + traders.filter((t) => t.mimic).length;
  const agents: any[] = (ag.data?.agents ?? []).filter((a: any) => ["mimic", "copy_trading", "wallet_tracking"].includes(a.role));
  async function mimic(group: "wallets" | "merod" | "stocks", target: string) {
    setBusy(target);
    try { const r: any = await api("/api/traders", { method: "POST", json: { group, on: true, targets: [target] } }); toast(r.done ? `Mimicking ${group === "wallets" ? short(target) : `@${target}`}` : r.skipped?.[0] ?? "Couldn't mimic", r.done ? "up" : "down"); dir.refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  const topAddrs = (gainers.length ? gainers : wallets).slice(0, 5).map((w) => w.address);
  const watchFleet = () => setDraft({ name: "Top Wallet Watch", prompt: "Track the top public Solana wallets and flag mimic opportunities", operationMode: "parallel", capitalUsd: 0, reserveUsd: 0, dailyLossPct: 2,
    agents: topAddrs.map((w, i) => ({ key: `a${i + 1}`, name: `Wallet ${short(w)}`, role: "wallet_tracking", assets: [], wallets: [w], autonomy: 1, capitalUsd: 0, instructions: `Track public wallet ${w}: realised performance, liquidity, consistency, drawdown. Flag mimic opportunities for review.`, dependsOn: [] })),
    notes: ["Read-only trackers: they report, they never trade.", "Turn on Watch or Mimic for these wallets so their swaps are recorded (needs a Helius key)."], missing: [] });
  const mimicAgent = () => setDraft({ name: "Top Gainer Mimic", prompt: "Mimic the top gainer wallets within a budget", operationMode: "supervisor", capitalUsd: 1100, reserveUsd: 100, dailyLossPct: 2,
    agents: [{ key: "a1", name: "Top Gainer Mimic", role: "mimic", assets: [], wallets: topAddrs.slice(0, 3), autonomy: 5, capitalUsd: 1000, instructions: "Mirror the followed top-gainer wallets' trades within my budget, $50 per trade.", strategy: { kind: "mimic", tradeUsd: 50 }, dependsOn: [] },
      { key: "a2", name: "Mimic Risk Supervisor", role: "supervisor", assets: [], autonomy: 1, capitalUsd: 0, instructions: "Stop new mimic buys if the daily loss reaches 2%.", dependsOn: ["a1"] }],
    notes: ["The mimic agent copies trades seen by your watch-mode wallet follows.", "Paper only, with a 2% daily loss stop."], missing: topAddrs.length ? [] : ["No wallets yet: connect Birdeye or add wallets first."] });
  const prompts = [
    "Mimic the top ROI earner for Solana meme coins this week",
    top ? `Analyze wallet ${top.address}: what does it trade and how risky is it?` : "Which public wallets are the most profitable this week?",
    "Compare the top 3 gainer wallets and tell me which one to mimic",
    "Create 10 agents to monitor the top 10 profitable Solana wallets and flag mimic opportunities for review",
    bestStock ? `Mimic @${bestStock.handle}'s stock trades` : "Who are the best stock traders on Merod?",
    "Make a bot that buys SOL meme coins the top wallets are buying, $25 each, 20% profit",
  ];
  return (
    <aside className="space-y-4">
      <section className="surface rounded-2xl p-4">
        <header className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-accent-2" /> Modo</h3><button onClick={openModo} className="text-[11px] text-muted hover:text-text">Open Modo panel →</button></header>
        <p className="text-[12px] text-muted">Ask about any wallet or trader, or tell Modo who to mimic.</p>
        <div className="mt-2 flex gap-2"><input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { ask(text); setText(""); } }} placeholder="e.g. mimic the top gainer wallet" className="h-10 flex-1 rounded-xl border border-line bg-panel-2/60 px-3 text-sm outline-none focus:border-accent/60" />
          <button onClick={() => { if (text.trim()) { ask(text); setText(""); } }} className="flex size-10 items-center justify-center rounded-xl bg-grad" aria-label="Ask Modo"><Send className="size-4" /></button></div>
        <div className="mt-3 text-[11px] uppercase tracking-wide text-faint">Suggested prompts</div>
        <div className="mt-1.5 flex flex-col gap-1.5">{prompts.map((p) => <button key={p} onClick={() => ask(p)} className="rounded-xl border border-line-2 px-3 py-2 text-left text-[12px] text-muted hover:border-accent/40 hover:text-text">{p}</button>)}</div>
      </section>

      <section className="surface rounded-2xl p-4">
        <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><Lightbulb className="size-4 text-accent-2" /> Modo suggestions</h3>
        <ul className="space-y-2.5 text-[12.5px]">
          {top && <li className="rounded-xl border border-line bg-bg-2/50 p-2.5"><div className="flex items-center gap-1.5 font-medium"><Trophy className="size-3.5 text-accent-2" /> #1 {top.kind === "pnl" ? "gainer" : "net-flow"} wallet {short(top.address)}</div>
            <div className="mt-0.5 text-[11.5px] text-muted">{`+${money(top.value ?? 0)} ${top.kind === "pnl" ? "PnL" : "net flow"} (${top.window ?? "today"})`} over {top.trades?.toLocaleString() ?? "?"} trades. High trade counts often mean bots: mimic with a small cap.</div>
            <div className="mt-1.5 flex gap-2">{d?.canMimic && !top.mimic && <button disabled={busy === top.address} onClick={() => mimic("wallets", top.address)} className="rounded-lg bg-grad px-2.5 py-1 text-[11px] font-semibold">Mimic</button>}{top.mimic && <span className="text-[11px] text-up">Mimicking ✓</span>}<button onClick={() => ask(`Analyze wallet ${top.address}: what does it trade and how risky is it?`)} className="rounded-lg border border-line-2 px-2.5 py-1 text-[11px]">Ask Modo</button></div></li>}
          {active && active.address !== top?.address && <li className="rounded-xl border border-line bg-bg-2/50 p-2.5"><div className="font-medium">Most active wallet {short(active.address)}</div><div className="mt-0.5 text-[11.5px] text-muted">{active.trades?.toLocaleString()} trades in 24h on {[...new Set(active.tokens ?? [])].join(", ") || "Solana"}. Very active wallets can drain a mimic budget fast: set a low daily cap.</div></li>}
          {bestTrader && <li className="rounded-xl border border-line bg-bg-2/50 p-2.5"><div className="flex items-center gap-1.5 font-medium"><Users className="size-3.5" /> @{bestTrader.handle} wins {bestTrader.winRate.toFixed(0)}%</div><div className="mt-0.5 text-[11.5px] text-muted">{bestTrader.trades} trades in 30 days on Merod{bestTrader.live ? " (includes real money)" : " (paper)"}.</div>
            {d?.canMimic && !bestTrader.mimic && <button disabled={busy === bestTrader.handle} onClick={() => mimic("merod", bestTrader.handle)} className="mt-1.5 rounded-lg bg-grad px-2.5 py-1 text-[11px] font-semibold">Mimic</button>}</li>}
          <li className="rounded-xl border border-line bg-bg-2/50 p-2.5"><div className="font-medium">You&apos;re mimicking {mimicking} trader{mimicking === 1 ? "" : "s"}</div><div className="mt-0.5 text-[11.5px] text-muted">{mimicking ? "Each has a $1,000/day cap in your paper account. Add a supervisor agent to stop everything at a 2% daily loss." : "Start small: mimic one wallet, watch it for a few days, then add more."}</div></li>
          {!top && !active && !bestTrader && <li className="text-[11.5px] text-muted">Connect Birdeye to get wallet suggestions.</li>}
        </ul>
      </section>

      <section className="surface rounded-2xl p-4">
        <header className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-[15px] font-semibold"><Bot className="size-4 text-accent-2" /> Agents</h3><Link href="/agents" className="text-[11px] text-muted hover:text-text">All agents →</Link></header>
        <ul className="space-y-1">{agents.map((a) => <li key={a.id}><Link href={`/agents/${a.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 hover:bg-panel-2"><span className="min-w-0"><span className="block truncate text-[13px] font-medium">{a.name}</span><span className="text-[11px] text-muted">{a.roleName} · {(a.universe?.wallets ?? []).length} wallet{(a.universe?.wallets ?? []).length === 1 ? "" : "s"}</span></span><StatusDot status={a.status} /></Link></li>)}
          {!agents.length && <li className="text-[12px] text-muted">No mimic or wallet agents yet.</li>}</ul>
        <div className="mt-3 grid gap-2">
          <button onClick={watchFleet} disabled={!topAddrs.length} className="flex items-center justify-between rounded-xl border border-line-2 px-3 py-2 text-left text-[12.5px] hover:border-accent/40 disabled:opacity-50"><span><Plus className="mr-1 inline size-3.5" /> Track the top {topAddrs.length || 5} wallets</span><ArrowRight className="size-3.5 text-muted" /></button>
          {d?.canMimic && <button onClick={mimicAgent} className="flex items-center justify-between rounded-xl border border-line-2 px-3 py-2 text-left text-[12.5px] hover:border-accent/40"><span><Plus className="mr-1 inline size-3.5" /> Mimic agent + risk supervisor</span><ArrowRight className="size-3.5 text-muted" /></button>}
          <Link href="/agents/new" className="flex items-center justify-between rounded-xl border border-line-2 px-3 py-2 text-[12.5px] hover:border-accent/40"><span><Plus className="mr-1 inline size-3.5" /> Custom agent</span><ArrowRight className="size-3.5 text-muted" /></Link>
        </div>
      </section>
      {draft && <FleetReview draft={draft} onClose={() => setDraft(null)} />}
    </aside>
  );
}
