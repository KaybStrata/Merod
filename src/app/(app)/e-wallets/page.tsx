"use client";
import { useState } from "react";
import { PiggyBank, Plus, ArrowRightLeft, Trash2, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle, useRealtime } from "@/components/shell/context";
import { cx, Empty, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const money = (n: number) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inp = "rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/60";
const SOURCES: [string, string][] = [["copy", "Mimic / copy"], ["auto", "Auto trading"], ["manual", "Manual trades"], ["prompt", "Prompt trades"], ["signal", "Signal bots"]];

/**
 * E-wallets: named money pots inside Merod (not crypto wallets). Profit rules channel a share of every winning sell into
 * them automatically; you can also move money between them and your trading cash.
 */
export default function EWalletsPage() {
  usePageTitle({ section: "Wallet · E-wallets", title: "Channel your profits into e-wallets", accent: "e-wallets" });
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/e-wallets", { refreshMs: 20_000 });
  useRealtime((e) => { if (e.type === "e_wallet") refresh(); });
  const [name, setName] = useState(""), [goal, setGoal] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const wallets: any[] = data?.wallets ?? [], sources: any[] = data?.sources ?? [];
  const total = wallets.reduce((s, w) => s + w.balance, 0), set = wallets.reduce((s, w) => s + w.earmarked, 0);

  async function act(key: string, fn: () => Promise<any>, ok?: string) {
    setBusy(key);
    try { await fn(); if (ok) toast(ok, "up"); await refresh(); } catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  return (
    <div className="space-y-4">
      <section className="surface rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div><div className="text-[11px] uppercase tracking-wide text-faint">In e-wallets</div><div className="num text-[1.6rem] font-semibold">{money(total)}</div>{set > 0 && <div className="text-[11.5px] text-muted">+ {money(set)} real-money profit set aside at your broker</div>}</div>
          <form className="ml-auto flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void act("create", () => api("/api/e-wallets", { method: "POST", json: { name, goalUsd: goal ? Number(goal) : null } }), `E-wallet “${name}” created`).then(() => { setName(""); setGoal(""); }); }}>
            <label className="text-[11px] text-muted">New e-wallet<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Savings, Vacation, Taxes…" className={cx(inp, "mt-0.5 block w-48")} /></label>
            <label className="text-[11px] text-muted">Goal (optional)<input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" placeholder="$5,000" className={cx(inp, "mt-0.5 block w-28")} /></label>
            <button disabled={busy === "create" || !name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-grad px-3 py-1.5 text-[12.5px] font-semibold text-bg disabled:opacity-50"><Plus className="size-4" />Create</button>
          </form>
        </div>
        <p className="mt-3 text-[12px] text-muted">E-wallets are money pots inside Merod, not crypto wallets. Add a rule like “20% of all profits” and after every winning sell that share moves out of your trading cash into the e-wallet, so it's kept, not traded again. Paper profits really move; real-money profits are set aside here and stay in your broker account. You can also type it: “send 20% of all my profits to Savings”, “move $100 from Savings to trading”.</p>
      </section>

      {!data ? <div className="flex items-center gap-2 p-4 text-muted"><Loader2 className="size-4 animate-spin" />Loading…</div> : !wallets.length ? (
        <Empty icon={<PiggyBank className="size-6" />} title="No e-wallets yet">Create one above, then add a profit rule.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {wallets.map((w) => <WalletCard key={w.id} w={w} wallets={wallets} sources={sources} busy={busy} act={act} />)}
        </div>
      )}
    </div>
  );
}

function WalletCard({ w, wallets, sources, busy, act }: { w: any; wallets: any[]; sources: any[]; busy: string | null; act: (k: string, fn: () => Promise<any>, ok?: string) => Promise<void> }) {
  const [pct, setPct] = useState("20"), [scope, setScope] = useState("all");
  const [amount, setAmount] = useState(""), [dir, setDir] = useState("in"), [other, setOther] = useState("trading");
  const prog = w.goal_usd ? Math.min(100, ((w.balance + w.earmarked) / w.goal_usd) * 100) : null;
  function addRule() {
    const [kind, ref] = scope.split(":");
    const label = kind === "source" ? SOURCES.find(([k]) => k === ref)?.[1] : kind === "bot" || kind === "agent" ? sources.find((s) => s.id === ref)?.name : null;
    return act(`rule-${w.id}`, () => api("/api/e-wallets/rules", { method: "POST", json: { walletId: w.id, percent: Number(pct), scope: kind, scopeRef: ref ?? null, scopeLabel: label ?? null } }), "Profit rule saved");
  }
  function move() {
    const a = Number(amount);
    const end = other === "trading" ? { trading: true } : { wallet: other };
    const body = dir === "in" ? { from: end, to: { wallet: w.id }, amount: a } : { from: { wallet: w.id }, to: end, amount: a };
    return act(`move-${w.id}`, () => api("/api/e-wallets/move", { method: "POST", json: body }), `Moved ${money(a)}`).then(() => setAmount(""));
  }
  return (
    <section className="surface rounded-2xl p-4">
      <div className="flex items-start gap-2">
        <PiggyBank className="mt-0.5 size-5 text-accent-2" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{w.name}</div>
          <div className="num text-[1.35rem] font-semibold">{money(w.balance)}</div>
          {w.earmarked > 0 && <div className="text-[11.5px] text-muted">+ {money(w.earmarked)} real-money profit set aside</div>}
        </div>
        <button onClick={() => { if (confirm(`Delete “${w.name}”? Its ${money(w.balance)} goes back to your trading cash.`)) void act(`del-${w.id}`, () => api(`/api/e-wallets/${w.id}`, { method: "DELETE" }), "E-wallet deleted"); }} className="rounded-md p-1.5 text-faint hover:text-down" aria-label="Delete"><Trash2 className="size-4" /></button>
      </div>
      {prog != null && (
        <div className="mt-2"><div className="h-1.5 rounded-full bg-panel-2"><div className="h-1.5 rounded-full bg-grad" style={{ width: `${prog}%` }} /></div><div className="mt-0.5 text-[10.5px] text-faint">{prog.toFixed(0)}% of {money(w.goal_usd)} goal</div></div>
      )}

      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Profit rules</div>
      <div className="mt-1 space-y-1">
        {w.rules.map((r: any) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-[12px]">
            <input type="checkbox" checked={r.active} onChange={(e) => void act(`r-${r.id}`, () => api("/api/e-wallets/rules", { method: "PATCH", json: { id: r.id, active: e.target.checked } }))} aria-label="Rule on/off" />
            <span className={cx(!r.active && "text-faint line-through")}><b>{r.percent}%</b> of {r.scope === "all" ? "all profits" : `${r.scope_label ?? r.scope} profits`}</span>
            <button onClick={() => void act(`rd-${r.id}`, () => api(`/api/e-wallets/rules?id=${r.id}`, { method: "DELETE" }))} className="ml-auto text-faint hover:text-down" aria-label="Remove rule"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
        {!w.rules.length && <p className="text-[12px] text-muted">No rules yet: nothing flows in automatically.</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className={cx(inp, "w-16")} aria-label="Percent" /><span className="text-muted">% of</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={cx(inp, "max-w-[12rem]")}>
          <option value="all">all profits</option>
          <optgroup label="From a kind of trading">{SOURCES.map(([k, l]) => <option key={k} value={`source:${k}`}>{l}</option>)}</optgroup>
          {sources.length > 0 && <optgroup label="From one bot or agent">{sources.map((s) => <option key={s.id} value={`${s.kind}:${s.id}`}>{s.name} ({s.kind})</option>)}</optgroup>}
        </select>
        <button onClick={() => void addRule()} disabled={busy === `rule-${w.id}` || !(Number(pct) > 0 && Number(pct) <= 100)} className="rounded-lg border border-accent/50 px-2.5 py-1.5 text-accent-2 hover:bg-accent/10 disabled:opacity-50">Add rule</button>
      </div>

      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Move money</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
        <select value={dir} onChange={(e) => setDir(e.target.value)} className={inp}><option value="in">Into {w.name} from</option><option value="out">Out of {w.name} to</option></select>
        <select value={other} onChange={(e) => setOther(e.target.value)} className={inp}>
          <option value="trading">trading cash</option>
          {wallets.filter((x) => x.id !== w.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="$100" className={cx(inp, "w-24")} />
        <button onClick={() => void move()} disabled={busy === `move-${w.id}` || !(Number(amount) > 0)} className="inline-flex items-center gap-1 rounded-lg bg-grad px-2.5 py-1.5 font-semibold text-bg disabled:opacity-50"><ArrowRightLeft className="size-3.5" />Move</button>
      </div>

      {w.entries.length > 0 && (
        <>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">History</div>
          <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
            {w.entries.map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 text-[11.5px]">
                <span className={cx("num w-20 shrink-0 text-right font-semibold", e.amount >= 0 ? "text-up" : "text-down")}>{e.amount >= 0 ? "+" : "−"}{money(Math.abs(e.amount))}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{e.note ?? e.kind.replace("_", " ")}</span>
                <span className="shrink-0 text-faint">{ago(e.created_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
