"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Plus, ArrowUp, Loader2, Bookmark, Trash2, ShieldCheck, Info, BookmarkPlus, Search, MessageSquare, Paperclip } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { usePageTitle, useShell } from "@/components/shell/context";
import { MerodReply } from "@/components/ask/PlanFrame";
import { ago } from "@/lib/format";

const EXAMPLES = [
  { group: "Trades", items: ["Buy $100 worth of Solana", "Sell 25% of my NVIDIA position", "Buy $2,500 of SOL if it dips below $130, take profit at 8%, stop at 4%"] },
  { group: "Automation", items: ["Buy at a 3% dip and sell at 5% increase, then rinse and repeat", "Pick the top 20 Solana meme coin gainers, buy $10 each, sell at 2% profit, repeat", "Buy $50 worth of Ethereum every Monday"] },
  { group: "Mimic & agents", items: ["Mimic the top 50 stock and crypto traders this week", "Create a bot that monitors my watchlist"] },
  { group: "Control & research", items: ["Cancel all my open orders", "Pause all my active trading bots", "How is my portfolio doing?"] },
];
const MODE_LABEL: Record<string, string> = { manual: "Manual approval", auto_within_limits: "Auto within limits", auto_until_approval: "Auto until approval" };

/** Group conversations into Today / Yesterday / This week / Earlier like the mockup. */
function groupConvs(list: any[]) {
  const day = 86_400_000, start = new Date(); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const g: Record<string, any[]> = { Today: [], Yesterday: [], "This week": [], Earlier: [] };
  for (const c of list) {
    const t = new Date(c.last_at ?? c.created_at).getTime();
    (t >= t0 ? g.Today : t >= t0 - day ? g.Yesterday : t >= t0 - 6 * day ? g["This week"] : g.Earlier).push(c);
  }
  return Object.entries(g).filter(([, v]) => v.length);
}

function AIPage() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { screenAsset } = useShell();
  const convs = useApi<any>("/api/ai/conversations");
  const models = useApi<any>("/api/ai/models");
  const saved = useApi<any>("/api/ai/saved-prompts");
  const [cid, setCid] = useState<string | null>(params.get("c"));
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-opus-5-5");
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const list: any[] = convs.data?.conversations ?? [];
  const active = list.find((c) => c.id === cid);
  usePageTitle({ section: "Ask Merod", title: active?.title ? active.title.slice(0, 60) : "Ask Merod", accent: active?.title ? undefined : "Merod" }, [active?.title]);

  useEffect(() => { if (models.data?.preference) { setProvider(models.data.preference.provider); setModel(models.data.preference.model); } }, [models.data]);
  useEffect(() => { setCid(params.get("c")); }, [params]);
  useEffect(() => {
    if (!cid) { setMessages([]); return; }
    api(`/api/ai/conversations?c=${cid}`).then((r) => setMessages(r.messages)).catch((e) => toast(e.message, "down"));
  }, [cid, toast]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages, busy]);

  const providers: any[] = models.data?.providers ?? [];
  const current = providers.find((p) => p.id === provider);
  const usingParser = provider === "merod" || (current && !current.connected);
  const groups = useMemo(() => groupConvs(list.filter((c) => !filter || c.title?.toLowerCase().includes(filter.toLowerCase()))), [list, filter]);

  async function savePreference(p: string, m: string) {
    setProvider(p); setModel(m);
    try { await api("/api/ai/preferences", { method: "PUT", json: { provider: p, model: m } }); toast("AI model preference saved", "up"); }
    catch (e: any) { toast(e.message, "down"); }
  }

  async function send(t = text) {
    const v = t.trim();
    if (!v || busy) return;
    setBusy(true); setText("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: v, created_at: new Date().toISOString() }]);
    try {
      const r = await api("/api/ai/prompt", { method: "POST", json: { text: v, conversationId: cid, screenAssetId: screenAsset?.id ?? null, provider, model } });
      setNote(r.fallbackReason);
      // One prompt can produce several replies (multi-instruction prompts).
      const replies = Array.isArray(r.messages) && r.messages.length ? r.messages : [r.message];
      setMessages((m) => [...m, ...replies.filter(Boolean)]);
      if (r.conversationId !== cid) { setCid(r.conversationId); router.replace(`/ai?c=${r.conversationId}`); }
      convs.refresh();
    } catch (e: any) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: e.message, status: "error" }]);
    } finally { setBusy(false); }
  }

  async function savePrompt(content: string) {
    const title = prompt("Name this prompt", content.slice(0, 40));
    if (!title) return;
    try { await api("/api/ai/saved-prompts", { method: "POST", json: { title, content } }); saved.refresh(); toast("Prompt saved", "up"); }
    catch (e: any) { toast(e.message, "down"); }
  }
  const newChat = () => { setCid(null); setMessages([]); router.replace("/ai"); inputRef.current?.focus(); };

  const perms = models.data?.permissions;
  return (
    <div className="grid h-[calc(100vh-150px)] min-h-[560px] grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_280px]">
      {/* Conversations */}
      <aside className="surface flex min-h-0 flex-col rounded-2xl p-2.5">
        <button onClick={newChat} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-grad text-[13px] font-semibold text-bg"><Plus className="size-4" /> New prompt</button>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search conversations" className="h-8 w-full rounded-lg border border-line bg-bg-2/60 pl-8 pr-2 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60" />
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {!list.length && <p className="px-2 py-6 text-center text-xs text-muted">No conversations yet. Ask Merod anything to start one.</p>}
          {groups.map(([label, items]) => (
            <div key={label} className="mb-2">
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</div>
              {items.map((c: any) => (
                <button key={c.id} onClick={() => router.replace(`/ai?c=${c.id}`)} className={cx("block w-full rounded-lg px-2.5 py-2 text-left", c.id === cid ? "nav-active" : "hover:bg-panel-2")}>
                  <div className="truncate text-[12.5px] font-medium">{c.title}</div>
                  <div className="text-[10.5px] text-faint">{ago(c.last_at ?? c.created_at)}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-line pt-2">
          <div className="flex items-center justify-between px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint"><span>Saved prompts</span><Bookmark className="size-3" /></div>
          <div className="max-h-40 overflow-y-auto">
            {(saved.data?.prompts ?? []).length === 0 && <p className="px-1 text-[11px] text-faint">Hover any message and bookmark it to save it here.</p>}
            {(saved.data?.prompts ?? []).map((p: any) => (
              <div key={p.id} className="group flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-panel-2">
                <button className="min-w-0 flex-1 truncate text-left text-[12px]" onClick={() => send(p.content)} title={p.content}>{p.title}</button>
                <button className="opacity-0 group-hover:opacity-100" onClick={async () => { await api("/api/ai/saved-prompts", { method: "DELETE", json: { id: p.id } }); saved.refresh(); }} aria-label="Delete saved prompt"><Trash2 className="size-3 text-faint hover:text-down" /></button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Thread */}
      <section className="surface flex min-h-0 flex-col rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <MessageSquare className="size-4 text-accent-2" />
            <span className="truncate font-semibold">{active?.title ?? "New conversation"}</span>
            {screenAsset && <span className="rounded-md border border-accent/40 bg-accent-soft px-1.5 py-px text-[10.5px] text-accent-2">Context: {screenAsset.symbol}</span>}
          </div>
          {perms && <Link href="/settings?tab=automation" className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted hover:text-text"><ShieldCheck className="size-3 text-accent-2" />{MODE_LABEL[perms.mode] ?? perms.mode}</Link>}
        </div>
        {usingParser && (
          <div className="flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-1.5 text-[11.5px] text-warn">
            <Info className="mt-px size-3.5 shrink-0" />
            {provider === "merod" ? "Using Merod's built-in rule parser. Trading commands work; open-ended research needs an AI provider."
              : `${current?.name ?? "This provider"} isn't connected, so Merod's rule parser reads your prompts. Connect it under Broker & AI keys.`}
          </div>
        )}
        <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl py-6">
              <div className="text-center">
                <Sparkles className="mx-auto size-7 text-accent-2" />
                <h2 className="mt-3 text-[22px] font-semibold tracking-tight">What should Merod <span className="serif-accent text-[26px] text-accent-2">do</span>?</h2>
                <p className="mx-auto mt-1 max-w-lg text-[13px] text-muted">Describe a trade, an automation or a question. Merod resolves the exact asset, runs every risk check, and shows the plan before anything executes. You can put several instructions in one prompt.</p>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {EXAMPLES.map((g) => (
                  <div key={g.group} className="rounded-xl border border-line bg-bg-2/40 p-3">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{g.group}</div>
                    <div className="space-y-1">{g.items.map((e) => <button key={e} onClick={() => send(e)} className="block w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-panel-2 hover:text-text">{e}</button>)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => m.role === "user" ? (
            <div key={m.id} className="group ml-auto flex max-w-[78%] items-start justify-end gap-1.5">
              <button onClick={() => savePrompt(m.content)} title="Save as reusable prompt" className="mt-2 opacity-0 transition-opacity group-hover:opacity-100"><BookmarkPlus className="size-3.5 text-faint hover:text-text" /></button>
              <div className="rounded-2xl rounded-br-md bg-grad px-3.5 py-2 text-[13.5px] font-medium text-bg">{m.content}</div>
            </div>
          ) : (
            <MerodReply key={m.id} message={m} onChip={(s) => send(s)} />
          ))}
          {busy && <div className="flex items-center gap-2 pl-10 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Interpreting and validating with the trading engine…</div>}
          {note && !busy && <div className="pl-10 text-[11px] text-warn">{note}</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-line p-3">
          <div className="gold-ring flex items-end gap-2 rounded-xl border border-line-2 bg-bg-2/70 p-2">
            <Paperclip className="mb-2 ml-1 size-4 shrink-0 text-faint" />
            <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} rows={1} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Refine the plan, or ask Merod anything…" className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[13.5px] outline-none placeholder:text-faint" />
            <select value={provider} onChange={(e) => { const p = providers.find((x) => x.id === e.target.value); savePreference(e.target.value, p?.models[0]?.id ?? ""); }}
              className="mb-1 hidden h-8 rounded-lg border border-line bg-panel px-2 text-[11.5px] text-muted md:block" aria-label="AI provider">
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.connected ? "" : " (off)"}</option>)}
            </select>
            <select value={model} onChange={(e) => savePreference(provider, e.target.value)} className="mb-1 hidden h-8 max-w-40 rounded-lg border border-line bg-panel px-2 text-[11.5px] text-muted md:block" aria-label="AI model">
              {(current?.models ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button type="button" title="Save prompt" disabled={!text.trim()} onClick={() => savePrompt(text)} className="mb-1 rounded-lg p-2 text-faint hover:text-text disabled:opacity-40"><Bookmark className="size-4" /></button>
            <button type="submit" disabled={!text.trim() || busy} className="mb-0.5 flex size-9 items-center justify-center rounded-lg bg-grad text-bg disabled:opacity-50" aria-label="Send">{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button>
          </div>
          <div className="mt-1.5 px-1 text-[10.5px] text-faint">Merod never sees your keys and can't change its own permissions. Ambiguous requests get a question, not a guess.</div>
        </form>
      </section>

      {/* Context */}
      <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto xl:flex">
        <div className="surface rounded-2xl p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold"><ShieldCheck className="size-4 text-accent-2" /> Approval & automation</div>
          {perms ? (
            <div className="mt-2 space-y-1.5 text-[12.5px]">
              <div className="font-medium">{MODE_LABEL[perms.mode] ?? perms.mode}</div>
              <div className="text-muted">{perms.mode === "manual" ? "Every trade needs your confirmation." : `Auto-executes up to ${Number(perms.auto_max_order_usd) > 0 ? `$${perms.auto_max_order_usd}` : "any amount"} per order, ${Number(perms.auto_daily_cap_usd) > 0 ? `$${perms.auto_daily_cap_usd}` : "no limit"} a day.`}</div>
              {!perms.allow_ai_prompts && <div className="text-down">AI prompt trading is off.</div>}
              <Link href="/settings?tab=automation" className="inline-block text-accent-2 hover:underline">Change automation settings →</Link>
            </div>
          ) : <p className="mt-2 text-xs text-muted">Loading…</p>}
        </div>
        <div className="surface rounded-2xl p-4">
          <div className="text-[13px] font-semibold">Try asking</div>
          <div className="mt-2 space-y-1">
            {EXAMPLES.flatMap((g) => g.items).slice(0, 8).map((e) => (
              <button key={e} onClick={() => send(e)} className="block w-full rounded-lg border border-line px-2.5 py-1.5 text-left text-[12px] text-muted hover:border-accent/50 hover:text-text">{e}</button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function Page() { return <Suspense><AIPage /></Suspense>; }
