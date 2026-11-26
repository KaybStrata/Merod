"use client";
import Link from "next/link";
import { useState } from "react";
import { Swords, Trophy, Plus } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Empty, Modal, cx, useToast } from "@/components/ui";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { AreaChart, PageHead, GoldButton, fmtPct, fmtSigned, fmtUsd, toneOf } from "@/components/agents/common";

const KINDS = [["momentum", "Momentum"], ["mean_reversion", "Mean Reversion"], ["news", "News Reaction"], ["breakout", "Breakout"], ["dip", "Dip buying"], ["dca", "DCA"]];

/** Agent Arena (screen 6): normalised paper competitions, benchmark, risk metrics, leaderboard and comparison. */
export default function Arena() {
  const { data, refresh } = useApi<any>("/api/agents/arena", { refreshMs: 60000 });
  const [open, setOpen] = useState(false);
  const comps: any[] = data?.competitions ?? [];
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[220px] w-[60%] opacity-70" />
      <PageHead eyebrow="Merod Arena" title="Agent" accent="Arena" sub="Same asset, same capital, same fees and slippage: compare strategies on risk-adjusted paper results, not raw gains." right={<GoldButton onClick={() => setOpen(true)}><Plus className="size-4" /> New competition</GoldButton>} />
      {!comps.length ? <Empty icon={<Swords className="size-6" />} title="No competitions yet">Start one here or prompt: &quot;Create five agents that trade SOL using different strategies with $10,000 each for 30 days&quot;.</Empty> : (
        <div className="relative z-10 space-y-5">
          {comps.map((c) => (
            <section key={c.id} className="surface rounded-2xl p-4">
              <header className="flex flex-wrap items-center gap-3">
                <Trophy className="size-5 text-accent-2" /><h3 className="text-[1.1rem] font-semibold">{c.name}</h3>
                <span className="rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn">PAPER</span>
                <span className="text-xs text-muted">{fmtUsd(Number(c.capital_each_usd), 0)} each · {c.days} days · ends {new Date(c.ends_at).toLocaleDateString()} · {c.status}</span>
                {c.benchmark && <span className="ml-auto text-xs text-muted">Benchmark: {c.benchmark.label} <b className={toneOf(c.benchmark.returnPct)}>{fmtPct(c.benchmark.returnPct)}</b></span>}
              </header>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-[11px] text-muted"><tr className="border-b border-line"><th className="py-2">#</th><th>Agent</th><th>Strategy</th><th className="text-right">Net return</th><th className="text-right">Max drawdown</th><th className="text-right">Sharpe</th><th className="text-right">Consistency</th><th className="text-right">Win rate</th><th className="text-right">Trades</th><th className="text-right">Fees</th><th className="w-32" /></tr></thead>
                  <tbody>
                    {c.entries.map((e: any, i: number) => (
                      <tr key={e.agentId} className={cx("border-b border-line/60 last:border-0", e.disqualified && "opacity-50")}>
                        <td className="py-2 font-semibold text-accent-2">{i + 1}</td>
                        <td><Link href={`/agents/${e.agentId}`} className="font-medium hover:underline">{e.name}</Link>{e.sampleWarning && <div className="text-[10px] text-faint">{e.sampleWarning}</div>}</td>
                        <td className="text-muted">{e.strategy}</td>
                        <td className={cx("num text-right font-semibold", toneOf(e.returnPct))}>{fmtPct(e.returnPct)}</td>
                        <td className="num text-right text-down">-{e.maxDrawdownPct.toFixed(1)}%</td>
                        <td className="num text-right">{e.sharpe == null ? "—" : e.sharpe.toFixed(2)}</td>
                        <td className="num text-right">{e.consistency == null ? "—" : `${e.consistency.toFixed(0)}%`}</td>
                        <td className="num text-right">{e.winRate == null ? "—" : `${e.winRate.toFixed(0)}%`}</td>
                        <td className="num text-right">{e.trades}</td>
                        <td className="num text-right">{fmtUsd(e.fees)}</td>
                        <td className="pl-3"><AreaChart data={e.spark.map((p: any) => p.v)} height={26} up={e.pnl >= 0} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-faint">{c.scoring} Strategies can&apos;t see future data or each other&apos;s capital and memory. Winners can move to further testing; live trading always needs separate authorisation.</p>
            </section>
          ))}
        </div>
      )}
      <NewCompetition open={open} onClose={() => setOpen(false)} onDone={refresh} />
    </div>
  );
}

function NewCompetition({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("SOL Strategy Arena"); const [asset, setAsset] = useState("SOL"); const [cap, setCap] = useState(10000); const [days, setDays] = useState(30);
  const [kinds, setKinds] = useState<string[]>(["momentum", "mean_reversion", "news", "breakout"]);
  const toast = useToast(); const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try { const r: any = await api("/api/agents/arena", { method: "POST", json: { name, asset, strategies: kinds, capitalEach: cap, days } }); await api(`/api/agents/fleets/${r.fleet.id}`, { method: "POST", json: { action: "approve" } }); toast("Competition started (paper)", "up"); onDone(); onClose(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const fld = "h-9 w-full rounded-lg border border-line bg-panel-2 px-2.5 text-sm";
  return (
    <Modal open={open} onClose={onClose} title="New paper competition">
      <div className="space-y-3 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} className={fld} />
        <div className="grid grid-cols-3 gap-2"><label><span className="text-xs text-muted">Asset</span><input value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} className={fld} /></label><label><span className="text-xs text-muted">Virtual $ each</span><input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} className={fld} /></label><label><span className="text-xs text-muted">Days</span><input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} className={fld} /></label></div>
        <div className="flex flex-wrap gap-1.5">{KINDS.map(([k, l]) => <button key={k} onClick={() => setKinds((s) => s.includes(k) ? s.filter((x) => x !== k) : [...s, k])} className={cx("rounded-full border px-3 py-1 text-xs", kinds.includes(k) ? "gold-ring border-transparent bg-accent-soft" : "border-line text-muted")}>{l}</button>)}</div>
        <p className="text-[11px] text-faint">Each strategy gets its own agent and virtual sub-ledger of {fmtUsd(cap, 0)} from your paper account ({fmtUsd(cap * kinds.length, 0)} total).</p>
        <div className="flex justify-end"><GoldButton onClick={create} disabled={busy || kinds.length < 2}>{busy ? "Starting…" : "Start competition"}</GoldButton></div>
      </div>
    </Modal>
  );
}
