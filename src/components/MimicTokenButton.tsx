"use client";
import { useState } from "react";
import { Repeat, FlaskConical, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useShell } from "@/components/shell/context";
import { cx, useToast } from "@/components/ui";

/** Paper / Real money switch + sizing (same as the trader, or a custom $ per trade) used by every Mimic control. */
export function MimicSizing({ live, setLive, perTrade, setPerTrade }: { live: boolean; setLive: (v: boolean) => void; perTrade: string; setPerTrade: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg-2/60 p-0.5 text-[12px]">
        <button onClick={() => setLive(false)} className={cx("flex items-center justify-center gap-1 rounded-md py-1", !live ? "nav-active" : "text-muted")}><FlaskConical className="size-3.5" /> Paper</button>
        <button onClick={() => setLive(true)} className={cx("flex items-center justify-center gap-1 rounded-md py-1", live ? "bg-down-soft text-down ring-1 ring-down/40" : "text-muted")}><Zap className="size-3.5" /> Real money</button>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-muted">Amount
        <span className="relative flex-1"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint">$</span>
          <input type="number" min={1} value={perTrade} onChange={(e) => setPerTrade(e.target.value)} placeholder="same size as trader" className="h-8 w-full rounded-md border border-line bg-panel-2 pl-5 pr-2 text-[12px] text-text" /></span>
        <span className="text-[11px]">per trade</span>
      </label>
      {live && <p className="text-[10.5px] text-down">Real money: crypto uses your Merod Wallet, stocks your live broker. Real money must be switched on.</p>}
    </div>
  );
}

/** "Mimic" on a token row: copy the trades of that token's top public wallets (last 24h), paper or real money. */
export function MimicTokenButton({ asset }: { asset: any }) {
  const { user } = useShell();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [only, setOnly] = useState(true);
  const [live, setLive] = useState(false);
  const [perTrade, setPerTrade] = useState("");
  const [busy, setBusy] = useState(false);
  if (user.role !== "super_admin" || asset.venue !== "solana") return null;
  async function go() {
    if (live && !confirm(`Mimic ${asset.symbol}'s top ${count} wallets with REAL money?`)) return;
    setBusy(true);
    try {
      const r: any = await api("/api/traders", { method: "POST", json: { token: asset.id, count, onlyThisToken: only, live, perTradeUsd: perTrade ? Number(perTrade) : null } });
      toast(`Mimicking ${r.done} top ${r.symbol} wallet${r.done === 1 ? "" : "s"}${only ? ` (only their ${r.symbol} trades)` : ""} · ${r.account} · ${perTrade ? `$${perTrade}/trade` : "same size"}`, "up");
      if (r.skipped?.length) toast(`Skipped ${r.skipped.length}: ${r.skipped[0]}`, "down");
      setOpen(false);
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)} className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium", open ? "border-accent/60 text-accent-2" : "border-line-2 text-muted hover:border-accent/50 hover:text-text")}>
        <Repeat className="size-3.5" /> Mimic
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 rounded-xl border border-line bg-panel p-3 text-left shadow-2xl">
          <div className="text-[13px] font-semibold">Mimic {asset.symbol}&apos;s top traders</div>
          <p className="mt-0.5 text-[11px] text-muted">Copies the biggest public wallets trading {asset.symbol} in the last 24h, ranked by cash taken out (sold − bought).</p>
          <div className="mt-2 flex items-center gap-1 text-[12px]"><span className="mr-1 text-muted">Wallets</span>{[1, 3, 5, 10].map((n) => <button key={n} onClick={() => setCount(n)} className={cx("rounded-md px-2 py-0.5", count === n ? "nav-active" : "text-muted hover:text-text")}>{n}</button>)}</div>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="accent-[#d6b37a]" /> Only copy their {asset.symbol} trades</label>
          <div className="mt-2"><MimicSizing live={live} setLive={setLive} perTrade={perTrade} setPerTrade={setPerTrade} /></div>
          <button onClick={go} disabled={busy} className={cx("mt-3 h-9 w-full rounded-lg text-[12.5px] font-semibold disabled:opacity-50", live ? "bg-down text-white" : "bg-grad")}>{busy ? "Finding wallets…" : `Mimic top ${count}${live ? " · real money" : " · paper"}`}</button>
          <p className="mt-1.5 text-[10px] text-faint">Needs Birdeye to find wallets and Helius to read their swaps. Manage or pause them in Mimic trading.</p>
        </div>
      )}
    </div>
  );
}
