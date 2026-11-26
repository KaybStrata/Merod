"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Store, Download, ShieldCheck, Info } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Modal, cx, useToast } from "@/components/ui";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { FleetReview } from "@/components/agents/FleetReview";
import { PageHead, GoldButton, ROLE_ICON } from "@/components/agents/common";

const CATS = ["All", "Crypto", "Stocks", "Discovery", "Research", "Oversight", "Fleet", "Strategy"];

/** Agent Marketplace (screen 9 / Merod Exchange): search, filter, listing details, provenance, creator, licence, install review. */
export default function Marketplace() {
  const [q, setQ] = useState(""); const [cat, setCat] = useState("All");
  const { data } = useApi<any>(`/api/agents/marketplace?${new URLSearchParams({ ...(q ? { q } : {}), ...(cat !== "All" ? { category: cat } : {}) })}`);
  const [sel, setSel] = useState<any>(null); const [draft, setDraft] = useState<any>(null); const [busy, setBusy] = useState(false);
  const toast = useToast(); const router = useRouter();
  async function install(l: any) {
    setBusy(true);
    try {
      const r: any = await api(`/api/agents/marketplace/${encodeURIComponent(l.id)}`, { method: "POST" });
      if (r.kind === "fleet") { setDraft(r.draft); setSel(null); }
      else { toast(`${r.agent.name} installed as a stopped paper agent. Review it, then start.`, "up"); router.push(`/agents/${r.agent.id}?tab=settings`); }
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const list: any[] = data?.listings ?? [];
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[220px] w-[60%] opacity-70" />
      <PageHead eyebrow="Merod Exchange" title="Agent" accent="Marketplace" sub="Install agent and fleet templates into your workspace. Every install starts stopped, in paper mode, after you review its permissions." />
      <div className="relative z-10 mb-3 flex items-start gap-2 rounded-xl border border-line bg-panel-2/60 p-3 text-xs text-muted"><Info className="mt-0.5 size-4 shrink-0 text-accent-2" />{data?.paymentsNote ?? "Purchases, rentals and subscriptions are off until compliance review."} Templates are treated as untrusted: performance is labelled backtest, paper or live, and none can switch on live execution.</div>
      <div className="relative z-10 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="h-10 w-full rounded-xl border border-line bg-panel/70 pl-9 pr-3 text-sm outline-none focus:border-accent/60" /></div>
        <div className="flex flex-wrap gap-1">{CATS.map((c) => <button key={c} onClick={() => setCat(c)} className={cx("rounded-full px-3 py-1.5 text-xs", cat === c ? "nav-active" : "text-muted hover:text-text")}>{c}</button>)}</div>
      </div>
      <div className="relative z-10 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((l) => { const I = ROLE_ICON[l.config?.role] ?? Store; return (
          <button key={l.id} onClick={() => setSel(l)} className="surface surface-hover rounded-2xl p-4 text-left">
            <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-accent-2"><I className="size-5" /></span><div className="min-w-0"><div className="truncate font-semibold">{l.name}</div><div className="text-[11px] text-muted">{l.creator} · v{l.version} · {l.kind}</div></div>
              <span className={cx("ml-auto rounded-full px-2 py-0.5 text-[10px]", l.risk === "high" ? "bg-down-soft text-down" : l.risk === "low" ? "bg-up-soft text-up" : "bg-warn-soft text-warn")}>{l.risk} risk</span></div>
            <p className="mt-2 line-clamp-2 text-[12.5px] text-muted">{l.description}</p>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[11px] text-muted"><span>{l.performance?.label ?? (l.performance?.environment ? `${l.performance.environment} results` : "No track record")}</span><span>{l.installs != null ? `${l.installs} installs` : "Merod template"} · Free</span></div>
          </button>
        ); })}
        {!list.length && <p className="text-sm text-muted">No templates match.</p>}
      </div>
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.name ?? ""}>
        {sel && <div className="space-y-3 text-sm">
          <p className="text-muted">{sel.description}</p>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-faint">Creator</dt><dd>{sel.creator}</dd></div><div><dt className="text-faint">Category</dt><dd>{sel.category}</dd></div>
            <div><dt className="text-faint">Version</dt><dd>v{sel.version}</dd></div><div><dt className="text-faint">Licence</dt><dd>Free · personal use</dd></div>
            <div className="col-span-2"><dt className="text-faint">Performance provenance</dt><dd>{sel.performance?.label ?? "Template: no verified track record"}{sel.performance?.returnPct != null && ` · ${Number(sel.performance.returnPct).toFixed(2)}% over ${sel.performance.trades} trades (paper)`}</dd></div>
          </dl>
          <div className="rounded-xl border border-line bg-panel-2/60 p-3 text-xs"><div className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldCheck className="size-4 text-accent-2" /> Permission review</div>
            {sel.permissions?.note ? <p className="text-muted">{sel.permissions.note}</p> : <ul className="space-y-0.5 text-muted"><li>Role: {sel.permissions?.role}</li><li>Tools: {(sel.permissions?.tools ?? []).join(", ") || "—"}</li><li>Trading: {sel.permissions?.trading ? `yes, autonomy ${sel.permissions.autonomy} (capital starts at $0)` : "no (read-only)"}</li><li>Live execution: never</li></ul>}
          </div>
          <div className="flex justify-end"><GoldButton onClick={() => install(sel)} disabled={busy}><Download className="size-4" /> {busy ? "Installing…" : sel.kind === "fleet" ? "Review fleet" : "Install (paper, stopped)"}</GoldButton></div>
        </div>}
      </Modal>
      {draft && <FleetReview draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
