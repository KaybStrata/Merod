"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Copy, Trash2, Pencil, FolderPlus, Folder, Wand2, X, History, Zap, Bot } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Card, Empty, Input, Modal, Select, Toggle, StatusPill, cx, useToast } from "@/components/ui";
import { ShortcutIcon, SHORTCUT_ICONS } from "@/components/ShortcutBar";
import { ago } from "@/lib/format";
import { usePageTitle } from "@/components/shell/context";

const ACTIONS: { type: string; label: string; amount?: "usd" | "qty" | "pct"; order?: boolean }[] = [
  { type: "buy_usd", label: "Buy $ amount", amount: "usd", order: true },
  { type: "buy_qty", label: "Buy quantity", amount: "qty", order: true },
  { type: "sell_pct", label: "Sell % of position", amount: "pct", order: true },
  { type: "close_position", label: "Close position" },
  { type: "cancel_open_orders", label: "Cancel open orders" },
  { type: "set_stop_loss_pct", label: "Set stop-loss (% below cost)", amount: "pct" },
  { type: "set_take_profit_pct", label: "Set take-profit (% above cost)", amount: "pct" },
  { type: "start_recurring_buy", label: "Start recurring purchase", amount: "usd" },
  { type: "pause_all_bots", label: "Pause all bots" },
  { type: "activate_bot", label: "Activate saved bot" },
  { type: "open_watchlist", label: "Open watchlist" },
  { type: "analyze_asset", label: "Analyze asset (AI)" },
];
const COLORS = ["", "#14c3bb", "#22c993", "#f0506e", "#f5b84a", "#4aa8ff", "#c084fc"];
const PRESETS = [
  { name: "Buy $50", icon: "trending-up", color: "#22c993", actions: [{ type: "buy_usd", amount: 50, orderType: "market" }] },
  { name: "Buy $100", icon: "trending-up", color: "#22c993", actions: [{ type: "buy_usd", amount: 100, orderType: "market" }] },
  { name: "Sell 25%", icon: "trending-down", color: "#f0506e", actions: [{ type: "sell_pct", amount: 25, orderType: "market" }] },
  { name: "Sell 50%", icon: "trending-down", color: "#f0506e", actions: [{ type: "sell_pct", amount: 50, orderType: "market" }] },
  { name: "Close", icon: "x", color: "#f0506e", actions: [{ type: "close_position", orderType: "market" }] },
  { name: "Protect 8%", icon: "shield", color: "#f5b84a", actions: [{ type: "set_stop_loss_pct", amount: 8, orderType: "market" }] },
  { name: "TP +20%", icon: "target", color: "#4aa8ff", actions: [{ type: "set_take_profit_pct", amount: 20, orderType: "market" }] },
  { name: "Cancel orders", icon: "x", color: "", actions: [{ type: "cancel_open_orders", orderType: "market" }] },
  { name: "Pause bots", icon: "pause", color: "", actions: [{ type: "pause_all_bots", orderType: "market" }] },
  { name: "Analyze", icon: "sparkles", color: "#14c3bb", actions: [{ type: "analyze_asset", orderType: "market" }] },
];

type Draft = {
  id?: string; name: string; icon: string; color: string; folderId: string; assetId: string | null; assetLabel: string; assetCategory: string; accountId: string;
  actions: any[]; maxSpendUsd: string; maxSlippageBps: string; requireConfirmation: boolean; conditions: { type: string; value: string }[]; expiresAt: string; placement: string[];
};
const blank = (): Draft => ({ name: "", icon: "zap", color: "", folderId: "", assetId: null, assetLabel: "", assetCategory: "", accountId: "", actions: [{ type: "buy_usd", amount: 100, orderType: "market" }],
  maxSpendUsd: "", maxSlippageBps: "", requireConfirmation: true, conditions: [], expiresAt: "", placement: ["terminal"] });

function toDraft(s: any): Draft {
  return { id: s.id, name: s.name, icon: s.icon, color: s.color ?? "", folderId: s.folder_id ?? "", assetId: s.asset_id, assetLabel: s.asset_symbol ?? "", assetCategory: s.asset_category ?? "",
    accountId: s.account_id ?? "", actions: s.actions, maxSpendUsd: s.max_spend_usd?.toString() ?? "", maxSlippageBps: s.max_slippage_bps?.toString() ?? "",
    requireConfirmation: s.require_confirmation, conditions: (s.conditions ?? []).map((c: any) => ({ type: c.type, value: c.value?.toString() ?? "" })),
    expiresAt: s.expires_at ? new Date(s.expires_at).toISOString().slice(0, 16) : "", placement: s.placement };
}

export default function ShortcutsPage() {
  usePageTitle({ section: "Automate · Shortcuts", title: "One-tap shortcuts", accent: "shortcuts" });
  const { data, refresh } = useApi<any>("/api/shortcuts");
  const bots = useApi<any>("/api/bots");
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [folder, setFolder] = useState<string>("all");
  const [newFolder, setNewFolder] = useState("");
  const [promptText, setPromptText] = useState("");
  const [busy, setBusy] = useState(false);

  const shortcuts: any[] = data?.shortcuts ?? [];
  const folders: any[] = data?.folders ?? [];
  const shown = shortcuts.filter((s) => folder === "all" || (folder === "none" ? !s.folder_id : s.folder_id === folder));

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const body = {
        name: draft.name, icon: draft.icon, color: draft.color || null, folderId: draft.folderId || null, assetId: draft.assetId, assetCategory: draft.assetCategory || null,
        accountId: draft.accountId || null, actions: draft.actions.map((a) => ({ ...a, amount: a.amount === "" || a.amount == null ? null : Number(a.amount), limitOffsetPct: a.limitOffsetPct === "" || a.limitOffsetPct == null ? null : Number(a.limitOffsetPct) })),
        maxSpendUsd: draft.maxSpendUsd ? Number(draft.maxSpendUsd) : null, maxSlippageBps: draft.maxSlippageBps ? Number(draft.maxSlippageBps) : null,
        requireConfirmation: draft.requireConfirmation, conditions: draft.conditions.map((c) => ({ type: c.type, value: c.value === "" ? null : Number(c.value) })),
        expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null, placement: draft.placement,
      };
      if (draft.id) await api(`/api/shortcuts/${draft.id}`, { method: "PUT", json: body });
      else await api("/api/shortcuts", { method: "POST", json: body });
      toast(draft.id ? "Shortcut updated" : "Shortcut created", "up");
      setDraft(null); refresh();
    } catch (e: any) { toast(e.body?.issues?.[0] ? `${e.body.issues[0].path}: ${e.body.issues[0].message}` : e.message, "down"); } finally { setBusy(false); }
  }
  async function fromPrompt() {
    if (!promptText.trim()) return;
    setBusy(true);
    try {
      const { draft: d } = await api("/api/shortcuts/from-prompt", { method: "POST", json: { text: promptText } });
      setDraft({ ...blank(), name: d.name || "New shortcut", actions: d.actions, assetId: d.assetId, assetLabel: d.symbol ?? "", icon: d.actions[0]?.type?.startsWith("buy") ? "trending-up" : d.actions[0]?.type?.startsWith("sell") ? "trending-down" : "zap" });
      setPromptText("");
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  async function addFolder() {
    if (!newFolder.trim()) return;
    await api("/api/shortcuts/folders", { method: "POST", json: { name: newFolder.trim() } });
    setNewFolder(""); refresh();
  }

  const history: any[] = data?.history ?? [];
  const totalRuns = shortcuts.reduce((s, x) => s + Number(x.executions ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-panel/60 p-1">
          {[{ id: "all", name: "All" }, { id: "none", name: "Unfiled" }, ...folders].map((f: any) => (
            <span key={f.id} className={cx("group flex items-center rounded-lg text-[12.5px]", folder === f.id ? "nav-active" : "text-muted hover:text-text")}>
              <button className="px-3 py-1.5" onClick={() => setFolder(f.id)}>{f.name}<span className="num ml-1.5 text-[10.5px] text-faint">{f.id === "all" ? shortcuts.length : f.id === "none" ? shortcuts.filter((s) => !s.folder_id).length : shortcuts.filter((s) => s.folder_id === f.id).length}</span></button>
              {f.user_id && <button className="pr-2 opacity-0 group-hover:opacity-100" title="Delete folder" onClick={async () => { await api("/api/shortcuts/folders", { method: "DELETE", json: { id: f.id } }); if (folder === f.id) setFolder("all"); refresh(); }}><X className="size-3" /></button>}
            </span>
          ))}
          <span className="flex items-center gap-1 pl-1">
            <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFolder()} placeholder="New folder" className="h-7 w-24 rounded-md border border-line bg-bg-2 px-2 text-[11.5px] outline-none focus:border-accent" />
            <button onClick={addFolder} className="rounded-md p-1.5 text-faint hover:text-text" title="Add folder"><FolderPlus className="size-3.5" /></button>
          </span>
        </div>
        <span className="text-[12px] text-muted"><b className="num text-text">{shortcuts.length}</b> shortcuts · <b className="num text-text">{totalRuns}</b> runs</span>
        <Button variant="primary" size="sm" className="ml-auto" onClick={() => setDraft(blank())}><Plus className="size-4" /> New shortcut</Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {shown.map((s) => {
              const sel = draft?.id === s.id;
              const tone = s.color || "#d6b37a";
              return (
                <div key={s.id} role="button" tabIndex={0} onClick={() => setDraft(toDraft(s))} onKeyDown={(e) => e.key === "Enter" && setDraft(toDraft(s))}
                  className={cx("surface surface-hover group relative cursor-pointer rounded-2xl p-3.5 transition-colors", sel && "gold-ring")}>
                  <div className="flex items-start justify-between">
                    <span className="flex size-9 items-center justify-center rounded-xl" style={{ background: `${tone}22`, color: tone }}><ShortcutIcon name={s.icon} className="size-4" /></span>
                    <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                      <IconBtn title="Duplicate" onClick={async () => { await api(`/api/shortcuts/${s.id}`, { method: "POST" }); refresh(); }}><Copy className="size-3.5" /></IconBtn>
                      <IconBtn title="Delete" onClick={async () => { if (confirm(`Delete “${s.name}”?`)) { await api(`/api/shortcuts/${s.id}`, { method: "DELETE" }); if (sel) setDraft(null); refresh(); } }}><Trash2 className="size-3.5" /></IconBtn>
                    </div>
                  </div>
                  <div className="mt-3 truncate text-[13.5px] font-semibold">{s.name}</div>
                  <div className="mt-0.5 line-clamp-2 min-h-[30px] text-[11.5px] text-muted">
                    {s.actions.map((a: any) => `${ACTIONS.find((x) => x.type === a.type)?.label ?? a.type}${a.amount != null ? ` ${a.type.includes("usd") || a.type === "start_recurring_buy" ? "$" : ""}${a.amount}${a.type.includes("pct") ? "%" : ""}` : ""}`).join(" → ")}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-faint">
                    <span>{s.asset_symbol ?? "Current asset"}{s.require_confirmation ? " · confirm" : " · 1-tap"}</span>
                    <span className="num">{s.executions} runs</span>
                  </div>
                </div>
              );
            })}
            <button onClick={() => setDraft(blank())} className="flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-2 text-[12.5px] text-muted hover:border-accent/50 hover:text-text">
              <Plus className="size-5" />New shortcut<span className="text-[10.5px] text-faint">or describe one on the right</span>
            </button>
          </div>
          {shortcuts.length === 0 && <p className="text-[12px] text-faint">Shortcuts appear on the trading terminal and Home. Leave the asset empty to apply one to whatever you're viewing.</p>}

          <section className="surface rounded-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2 text-[14px] font-semibold"><History className="size-4 text-accent-2" /> Recent runs</div>
              <span className="text-[11px] text-muted">{history.length}</span>
            </div>
            {history.length === 0 ? <p className="p-4 text-[12.5px] text-muted">No shortcut runs yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-[10px] uppercase tracking-[0.12em] text-faint"><tr><th className="px-4 py-2 font-semibold">When</th><th className="pr-3 font-semibold">Shortcut</th><th className="pr-3 font-semibold">Asset</th><th className="pr-3 font-semibold">Status</th><th className="pr-4 font-semibold">Result</th></tr></thead>
                  <tbody>
                    {history.map((h: any) => (
                      <tr key={h.id} className="border-t border-line/70">
                        <td className="whitespace-nowrap px-4 py-2 text-muted">{ago(h.created_at)}</td>
                        <td className="pr-3 font-medium">{h.shortcut_name}</td>
                        <td className="pr-3">{h.symbol ?? "—"}</td>
                        <td className="pr-3"><StatusPill status={h.status === "executed" ? "filled" : h.status} /></td>
                        <td className="pr-4 text-[11.5px] text-muted">{(h.detail?.results ?? []).map((r: any) => `${r.description}: ${r.message}`).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {draft ? (
            <section className="surface rounded-2xl p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{draft.id ? "Edit shortcut" : "New shortcut"}</div>
                  <div className="text-[15px] font-semibold">{draft.name || "Untitled"}</div>
                </div>
                <button onClick={() => setDraft(null)} className="rounded-lg p-1.5 text-faint hover:bg-panel-2 hover:text-text" aria-label="Close editor"><X className="size-4" /></button>
              </div>
              <Builder narrow draft={draft} setDraft={setDraft} folders={folders} accounts={data?.accounts ?? []} bots={bots.data?.bots ?? []} onSave={save} busy={busy} />
            </section>
          ) : (
            <>
              <section className="surface rounded-2xl p-4">
                <div className="flex items-center gap-2 text-[14px] font-semibold"><Wand2 className="size-4 text-accent-2" /> Create from a sentence</div>
                <div className="gold-ring mt-3 rounded-xl border border-line-2 bg-bg-2/70 p-2">
                  <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={2} placeholder="e.g. Buy $50 with a 10% take profit" className="w-full resize-none bg-transparent px-1 text-[13px] outline-none placeholder:text-faint" />
                  <div className="flex justify-end"><Button size="sm" variant="primary" loading={busy} disabled={!promptText.trim()} onClick={fromPrompt}>Build shortcut</Button></div>
                </div>
              </section>
              <section className="surface rounded-2xl p-4">
                <div className="text-[14px] font-semibold">Quick presets</div>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {PRESETS.map((p) => (
                    <button key={p.name} onClick={() => setDraft({ ...blank(), name: p.name, icon: p.icon, color: p.color, actions: p.actions })} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-[12px] text-muted hover:border-accent/50 hover:text-text">
                      <ShortcutIcon name={p.icon} className="size-3.5" />{p.name}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-faint">Pick a tile to edit it here. Every run is previewed and checked by the trading engine before anything executes.</p>
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function IconBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className="rounded-lg p-1.5 text-faint hover:bg-panel-2 hover:text-text">{children}</button>;
}

function Builder({ draft, setDraft, folders, accounts, bots, onSave, busy, narrow = false }: { draft: Draft; setDraft: (d: Draft) => void; folders: any[]; accounts: any[]; bots: any[]; onSave: () => void; busy: boolean; narrow?: boolean }) {
  const g = (wide: string, slim = "grid-cols-1") => (narrow ? slim : wide);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const [assetQ, setAssetQ] = useState("");
  const [assetResults, setAssetResults] = useState<any[]>([]);
  useEffect(() => {
    if (!assetQ.trim()) { setAssetResults([]); return; }
    const t = setTimeout(() => api(`/api/assets?q=${encodeURIComponent(assetQ)}&limit=6`).then((r) => setAssetResults(r.assets)).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [assetQ]);
  const setAction = (i: number, patch: any) => set("actions", draft.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const needsAsset = useMemo(() => draft.actions.some((a) => !["cancel_open_orders", "pause_all_bots", "activate_bot", "open_watchlist"].includes(a.type)), [draft.actions]);

  return (
    <div className="space-y-5">
      <div className={cx("grid gap-3", g("sm:grid-cols-[1fr_auto]"))}>
        <Input label="Name" value={draft.name} maxLength={40} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Buy $100" />
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Icon & color</span>
          <div className="flex flex-wrap gap-1">
            {Object.keys(SHORTCUT_ICONS).map((k) => (
              <button key={k} type="button" onClick={() => set("icon", k)} className={cx("flex size-8 items-center justify-center rounded-lg border", draft.icon === k ? "border-accent bg-accent-soft" : "border-line")}><ShortcutIcon name={k} className="size-4" /></button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1">
            {COLORS.map((c) => <button key={c || "none"} type="button" onClick={() => set("color", c)} title={c || "Default"} style={{ background: c || "transparent" }} className={cx("size-6 rounded-full border", draft.color === c ? "ring-2 ring-accent" : "border-line")} />)}
          </div>
        </div>
      </div>

      <div className={cx("grid gap-3", g("sm:grid-cols-3"))}>
        <div className="relative">
          <span className="mb-1 block text-xs font-medium text-muted">Asset</span>
          {draft.assetId ? (
            <div className="flex h-10 items-center justify-between rounded-xl border border-line bg-bg-2 px-3 text-sm">{draft.assetLabel || "Selected"}<button type="button" onClick={() => setDraft({ ...draft, assetId: null, assetLabel: "" })}><X className="size-3.5 text-muted" /></button></div>
          ) : (
            <input value={assetQ} onChange={(e) => setAssetQ(e.target.value)} placeholder="Current asset (dynamic) — or search" className="h-10 w-full rounded-xl border border-line bg-bg-2 px-3 text-sm outline-none focus:border-accent" />
          )}
          {assetResults.length > 0 && !draft.assetId && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
              {assetResults.map((a) => <button type="button" key={a.id} onClick={() => { setDraft({ ...draft, assetId: a.id, assetLabel: `${a.symbol} · ${a.venue}` }); setAssetQ(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-panel-2"><b>{a.symbol}</b> <span className="text-muted">{a.name} · {a.venue}</span></button>)}
            </div>
          )}
          {!draft.assetId && needsAsset && <span className="mt-1 block text-[11px] text-faint">Applies to whatever asset you're viewing.</span>}
        </div>
        <Select label="Asset category (optional)" value={draft.assetCategory} onChange={(e) => set("assetCategory", e.target.value)}>
          <option value="">Any</option><option value="stock">Stocks</option><option value="etf">ETFs</option><option value="crypto">Crypto</option><option value="meme">Meme coins</option>
        </Select>
        <Select label="Account / wallet" value={draft.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">Default for asset</option>
          {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Actions <span className="text-xs text-muted">(run in order)</span></span>
          <Button size="sm" type="button" onClick={() => set("actions", [...draft.actions, { type: "sell_pct", amount: 25, orderType: "market" }])} disabled={draft.actions.length >= 8}><Plus className="size-3.5" /> Add action</Button>
        </div>
        <div className="space-y-2">
          {draft.actions.map((a, i) => {
            const def = ACTIONS.find((x) => x.type === a.type)!;
            return (
              <div key={i} className={cx("grid items-end gap-2 rounded-xl border border-line bg-bg-2/50 p-2.5", g("sm:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_auto]", "grid-cols-2"))}>
                <Select label={`Action ${i + 1}`} value={a.type} onChange={(e) => setAction(i, { type: e.target.value, amount: ACTIONS.find((x) => x.type === e.target.value)?.amount ? a.amount ?? 50 : null })}>
                  {ACTIONS.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
                </Select>
                {def.amount ? <Input label={def.amount === "usd" ? "Amount ($)" : def.amount === "pct" ? "Percent (%)" : "Quantity"} type="number" min="0" step="any" value={a.amount ?? ""} onChange={(e) => setAction(i, { amount: e.target.value })} /> : <div />}
                {def.order ? <Select label="Order type" value={a.orderType} onChange={(e) => setAction(i, { orderType: e.target.value })}><option value="market">Market</option><option value="limit">Limit</option></Select>
                  : a.type === "start_recurring_buy" ? <Select label="Frequency" value={a.frequency ?? "weekly"} onChange={(e) => setAction(i, { frequency: e.target.value })}>{["hourly", "daily", "weekly", "monthly"].map((f) => <option key={f}>{f}</option>)}</Select>
                  : a.type === "activate_bot" ? <Select label="Bot" value={a.botId ?? ""} onChange={(e) => setAction(i, { botId: e.target.value || null })}><option value="">Select…</option>{bots.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select> : <div />}
                {def.order && a.orderType === "limit" ? <Input label="Limit vs market (%)" type="number" step="any" value={a.limitOffsetPct ?? ""} onChange={(e) => setAction(i, { limitOffsetPct: e.target.value })} placeholder="-1" /> : <div />}
                <button type="button" onClick={() => set("actions", draft.actions.filter((_, j) => j !== i))} disabled={draft.actions.length === 1} className="mb-2 rounded-lg p-1.5 text-faint hover:text-down disabled:opacity-30"><Trash2 className="size-4" /></button>
              </div>
            );
          })}
        </div>
      </div>

      <div className={cx("grid gap-3", g("sm:grid-cols-3"))}>
        <Input label="Max spend per run ($)" type="number" min="0" value={draft.maxSpendUsd} onChange={(e) => set("maxSpendUsd", e.target.value)} hint="Blocks buys above this total" />
        <Input label="Max slippage (bps)" type="number" min="1" value={draft.maxSlippageBps} onChange={(e) => set("maxSlippageBps", e.target.value)} hint="100 bps = 1%" />
        <Input label="Expires" type="datetime-local" value={draft.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Execution conditions</span>
          <Button size="sm" type="button" onClick={() => set("conditions", [...draft.conditions, { type: "price_below", value: "" }])} disabled={draft.conditions.length >= 5}><Plus className="size-3.5" /> Add condition</Button></div>
        {draft.conditions.length === 0 && <p className="text-xs text-muted">No conditions — runs whenever clicked.</p>}
        {draft.conditions.map((c, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Select value={c.type} onChange={(e) => set("conditions", draft.conditions.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
              <option value="price_below">Only if price below</option><option value="price_above">Only if price above</option><option value="position_open">Only if I hold a position</option><option value="no_position">Only if I have no position</option>
            </Select>
            {c.type.startsWith("price") ? <Input type="number" step="any" value={c.value} onChange={(e) => set("conditions", draft.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="Price" /> : <div />}
            <button type="button" onClick={() => set("conditions", draft.conditions.filter((_, j) => j !== i))} className="mb-2 p-1.5 text-faint hover:text-down"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Toggle checked={draft.requireConfirmation} onChange={(v) => set("requireConfirmation", v)} label="Require confirmation before orders" />
        <Toggle checked={draft.placement.includes("terminal")} onChange={(v) => set("placement", v ? [...new Set([...draft.placement, "terminal"])] : draft.placement.filter((p) => p !== "terminal"))} label="Show on terminal" />
        <Toggle checked={draft.placement.includes("dashboard")} onChange={(v) => set("placement", v ? [...new Set([...draft.placement, "dashboard"])] : draft.placement.filter((p) => p !== "dashboard"))} label="Show on dashboard" />
        <Select value={draft.folderId} onChange={(e) => set("folderId", e.target.value)} className="w-44"><option value="">No folder</option>{folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
      </div>
      {!draft.requireConfirmation && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Without confirmation, orders follow your automation permission mode — in Manual Approval mode they wait for approval; in automated modes they run only within your preset limits.</p>}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="primary" loading={busy} disabled={!draft.name.trim() || draft.placement.length === 0} onClick={onSave}>{draft.id ? "Save changes" : "Create shortcut"}</Button>
      </div>
    </div>
  );
}
