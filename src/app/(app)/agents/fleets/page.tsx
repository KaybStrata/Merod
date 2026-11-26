"use client";
import Link from "next/link";
import { useState } from "react";
import { GitBranch, Sparkles, Wand2, Layers, Bookmark } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Empty, cx, useToast } from "@/components/ui";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { FleetReview, EXAMPLES } from "@/components/agents/FleetReview";
import { PageHead, GoldButton, fmtSigned, fmtUsd, toneOf } from "@/components/agents/common";

/** Fleet Builder (screen 4): prompt → drafted fleet with roles, capital, dependencies → validation → deployment preview. */
export default function FleetBuilder() {
  const fleets = useApi<any>("/api/agents/fleets", { refreshMs: 30000 });
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function plan(text = prompt) {
    if (!text.trim()) return;
    setBusy(true);
    try { const r: any = await api("/api/agents/fleets/plan", { method: "POST", json: { prompt: text } }); if (r.errors?.length) toast(r.errors.join("; "), "down"); setDraft(r.draft); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  const list: any[] = fleets.data?.fleets ?? [];
  const collections = list.filter((f) => f.is_collection);
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[240px] w-[60%] opacity-80" />
      <PageHead eyebrow="Merod Fleet" title="Fleet" accent="Builder" sub="One prompt creates an entire trading operation: research, trading, mimic, risk and supervisor roles, with independent controls and a unified view." />
      <section className="surface relative z-10 rounded-2xl p-4">
        <div className="flex items-start gap-3"><Sparkles className="mt-1 size-6 text-accent-2" /><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe the fleet: assets, roles, budget, paper mode and a daily loss stop…" className="min-w-0 flex-1 resize-none bg-transparent text-[1.05rem] outline-none placeholder:text-muted" /></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {EXAMPLES.slice(0, 5).map((e) => <button key={e.title} onClick={() => { setPrompt(e.text); }} className="rounded-full border border-line-2 px-3 py-1.5 text-[12px] text-muted hover:border-accent/40 hover:text-text">{e.title}</button>)}
          <GoldButton className="ml-auto" onClick={() => plan()} disabled={busy || !prompt.trim()}><Wand2 className="size-4" /> {busy ? "Drafting…" : "Draft fleet"}</GoldButton>
        </div>
      </section>
      <ol className="relative z-10 mt-4 grid gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-6">
        {["Parse & clarify", "Draft the fleet", "Review capital", "Validate & approve", "Start paper workers", "Monitor"].map((s, i) => (
          <li key={s} className="surface rounded-xl px-3 py-2"><span className="mr-1.5 font-semibold text-accent-2">{i + 1}</span>{s}</li>
        ))}
      </ol>
      <h2 className="relative z-10 mb-2 mt-6 flex items-center gap-2 text-[1.1rem] font-semibold"><GitBranch className="size-5" /> Your fleets</h2>
      {!list.length ? <Empty icon={<Layers className="size-6" />} title="No fleets yet">Draft one above. Nothing runs until you approve it.</Empty> : (
        <div className="relative z-10 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((f) => (
            <Link key={f.id} href={`/agents/fleets/${f.id}`} className="surface surface-hover rounded-2xl p-4">
              <div className="flex items-center justify-between"><span className="font-semibold">{f.name}</span><span className={cx("text-xs", f.status === "running" ? "text-up" : f.status === "risk_blocked" ? "text-down" : f.status === "pending_approval" ? "text-accent-2" : "text-muted")}>{f.status.replace("_", " ")}</span></div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{f.prompt}</p>
              <div className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-2 text-[11.5px] text-muted"><span>{f.agents} agents</span><span className="capitalize">{f.operation_mode}</span><span>{fmtUsd(f.capital, 0)}</span><span className={cx("text-right", toneOf(f.pnl))}>{fmtSigned(f.pnl)}</span></div>
              {f.is_collection && <div className="mt-2 flex items-center gap-1 text-[11px] text-accent-2"><Bookmark className="size-3" /> Saved collection</div>}
            </Link>
          ))}
        </div>
      )}
      {collections.length > 0 && <p className="relative z-10 mt-3 text-xs text-muted">Agent Collections: open a saved fleet and press &quot;Deploy copy&quot; to run it again as a fresh paper fleet.</p>}
      {draft && <FleetReview draft={draft} onClose={() => setDraft(null)} onDone={() => fleets.refresh()} />}
    </div>
  );
}
