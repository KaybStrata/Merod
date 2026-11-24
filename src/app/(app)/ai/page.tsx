"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Plus, MessageSquare, ArrowUp, Loader2, Bookmark, Trash2, ShieldCheck, Info, BookmarkPlus } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Card, Select, cx, useToast } from "@/components/ui";
import { PlanCard } from "@/components/shell/PlanCard";
import { useShell } from "@/components/shell/context";
import { ago } from "@/lib/format";

const EXAMPLES = [
  { group: "Trades", items: ["Buy $100 worth of Solana", "Sell 25% of my NVIDIA position", "Buy $200 worth of Bitcoin", "Buy 2 shares of AAPL with take profit of 10%"] },
  { group: "Automation", items: ["Buy at a 3% dip and sell at 5% increase, then rinse and repeat", "Buy $50 worth of Ethereum every Monday", "Sell half of my position when it reaches a 20% gain", "Create a bot that monitors my watchlist", "Monitor newly launched Solana coins matching my selected liquidity requirements"] },
  { group: "Control", items: ["Notify me when Tesla drops below my target price", "Cancel all my open orders", "Pause all my active trading bots"] },
  { group: "Research", items: ["What's the outlook for ETH?", "How is my portfolio doing?"] },
];
const MODE_LABEL: Record<string, string> = { manual: "Manual Approval", auto_within_limits: "Automated Within Permissions", auto_until_approval: "Automated Until Approval Required" };

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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (models.data?.preference) { setProvider(models.data.preference.provider); setModel(models.data.preference.model); } }, [models.data]);
  useEffect(() => { setCid(params.get("c")); }, [params]);
  useEffect(() => {
    if (!cid) { setMessages([]); return; }
    api(`/api/ai/conversations?c=${cid}`).then((r) => setMessages(r.messages)).catch((e) => toast(e.message, "down"));
  }, [cid, toast]);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages]);

  const providers: any[] = models.data?.providers ?? [];
  const current = providers.find((p) => p.id === provider);
  const usingParser = provider === "merod" || (current && !current.connected);

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
      setMessages((m) => [...m, r.message]);
      if (r.conversationId !== cid) { setCid(r.conversationId); router.replace(`/ai?c=${r.conversationId}`); convs.refresh(); }
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

  const perms = models.data?.permissions;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
      {/* History */}
      <div className="space-y-4">
        <Button variant="primary" className="w-full" onClick={() => { setCid(null); setMessages([]); router.replace("/ai"); }}><Plus className="size-4" /> New conversation</Button>
        <Card title="History" icon={<MessageSquare className="size-4 text-accent-2" />}>
          <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
            {(convs.data?.conversations ?? []).length === 0 && <p className="text-xs text-muted">No conversations yet.</p>}
            {(convs.data?.conversations ?? []).map((c: any) => (
              <button key={c.id} onClick={() => router.replace(`/ai?c=${c.id}`)} className={cx("block w-full rounded-lg px-2.5 py-2 text-left", c.id === cid ? "bg-accent-soft" : "hover:bg-panel-2")}>
                <div className="truncate text-sm">{c.title}</div>
                <div className="text-[11px] text-faint">{ago(c.last_at ?? c.created_at)}</div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Chat */}
      <div className="flex min-h-[70vh] flex-col rounded-xl border border-line bg-panel/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2"><Sparkles className="size-4 text-accent-2" /><h1 className="font-semibold">Prompt history</h1>
            {screenAsset && <Badge tone="accent">Context: {screenAsset.symbol}</Badge>}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={provider} onChange={(e) => { const p = providers.find((x) => x.id === e.target.value); savePreference(e.target.value, p?.models[0]?.id ?? ""); }} className="w-40">
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.connected ? "" : " (not connected)"}</option>)}
            </Select>
            <Select value={model} onChange={(e) => savePreference(provider, e.target.value)} className="w-full sm:w-52">
              {(current?.models ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </div>
        </div>
        {usingParser && (
          <div className="flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-2 text-xs text-warn">
            <Info className="mt-px size-3.5 shrink-0" />
            {provider === "merod" ? "Using Merod's built-in rule parser (no AI model). Trading commands work; open-ended research needs an AI provider."
              : `${current?.name ?? "This provider"} isn't connected yet, so prompts are interpreted by Merod's built-in rule parser. An admin can connect it in the Integration Center.`}
          </div>
        )}
        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="mx-auto max-w-xl py-8 text-center">
              <Sparkles className="mx-auto size-8 text-accent-2" />
              <h2 className="mt-3 text-lg font-semibold">Trade in plain English</h2>
              <p className="mt-1 text-sm text-muted">Merod interprets your request, resolves the exact asset, validates it against your risk limits, and shows price, fees and risks before anything executes.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cx("group text-sm", m.role === "user" ? "ml-auto max-w-[80%]" : "max-w-full")}>
              {m.role === "user" ? (
                <div className="flex items-start justify-end gap-1.5">
                  <button onClick={() => savePrompt(m.content)} title="Save as reusable prompt" className="mt-2 opacity-0 transition-opacity group-hover:opacity-100"><BookmarkPlus className="size-3.5 text-faint hover:text-text" /></button>
                  <div className="rounded-xl rounded-br-md bg-accent px-3.5 py-2 text-white">{m.content}</div>
                </div>
              ) : (
                <div className={cx("rounded-xl rounded-bl-md border border-line bg-bg-2/50 px-3.5 py-2.5", m.status === "error" && "border-down/40 text-down")}>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  <PlanCard message={m} onChip={(s) => send(s)} />
                  {m.ai_provider && <div className="mt-1.5 text-[10px] text-faint">{m.ai_provider === "merod" ? "Rule parser" : `${m.ai_provider} · ${m.ai_model}`}</div>}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Interpreting and validating with the trading engine…</div>}
          {note && !busy && <div className="text-[11px] text-warn">{note}</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 border-t border-line p-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="e.g. Buy at a 3% dip and sell at 5% increase, then rinse and repeat" className="min-h-12 flex-1 resize-none rounded-xl border border-line bg-bg-2 px-3 py-2 text-sm outline-none focus:border-accent" />
          <Button type="button" variant="ghost" title="Save prompt" disabled={!text.trim()} onClick={() => savePrompt(text)}><Bookmark className="size-4" /></Button>
          <Button type="submit" variant="primary" disabled={!text.trim() || busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</Button>
        </form>
      </div>

      {/* Side */}
      <div className="space-y-4">
        <Card title="Approval & automation" icon={<ShieldCheck className="size-4 text-accent-2" />}>
          {perms ? (
            <div className="space-y-1.5 text-sm">
              <div className="font-medium">{MODE_LABEL[perms.mode] ?? perms.mode}</div>
              <div className="text-xs text-muted">{perms.mode === "manual" ? "Every trade needs your confirmation." : `Auto-executes up to $${perms.auto_max_order_usd}/order and $${perms.auto_daily_cap_usd}/day.`}</div>
              {!perms.allow_ai_prompts && <Badge tone="down">AI prompt trading disabled</Badge>}
              <Link href="/settings?tab=automation" className="inline-block text-xs text-accent-2 hover:underline">Change automation settings →</Link>
            </div>
          ) : <p className="text-xs text-muted">Loading…</p>}
          <p className="mt-3 text-[11px] text-muted">AI never sees your keys or wallets and cannot change its own permissions. Ambiguous requests get a clarifying question instead of a guess.</p>
        </Card>
        <Card title="Saved prompts" icon={<Bookmark className="size-4 text-accent-2" />}>
          {(saved.data?.prompts ?? []).length === 0 && <p className="text-xs text-muted">Hover a message and click the bookmark to save it.</p>}
          <div className="space-y-1">
            {(saved.data?.prompts ?? []).map((p: any) => (
              <div key={p.id} className="group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-panel-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => send(p.content)} title={p.content}>
                  <div className="truncate text-sm">{p.title}</div><div className="truncate text-[11px] text-faint">{p.content}</div>
                </button>
                <button className="opacity-0 group-hover:opacity-100" onClick={async () => { await api("/api/ai/saved-prompts", { method: "DELETE", json: { id: p.id } }); saved.refresh(); }}><Trash2 className="size-3.5 text-faint hover:text-down" /></button>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Try asking">
          <div className="space-y-3">
            {EXAMPLES.map((g) => (
              <div key={g.group}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{g.group}</div>
                <div className="flex flex-wrap gap-1">{g.items.map((e) => <button key={e} onClick={() => send(e)} className="rounded-lg border border-line px-2 py-1 text-left text-xs text-muted hover:border-accent/50 hover:text-text">{e}</button>)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function Page() { return <Suspense><AIPage /></Suspense>; }
