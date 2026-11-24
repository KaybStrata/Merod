"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Copy, Trash2, Pencil, FolderPlus, Folder, Wand2, X, History, Zap } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Card, Empty, Input, Modal, Select, Toggle, StatusPill, cx, useToast } from "@/components/ui";
import { ShortcutIcon, SHORTCUT_ICONS } from "@/components/ShortcutBar";
import { ago } from "@/lib/format";

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
const COLORS = ["", "#7c5cff", "#22c993", "#f0506e", "#f5b84a", "#4aa8ff", "#c084fc"];
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
  { name: "Analyze", icon: "sparkles", color: "#7c5cff", actions: [{ type: "analyze_asset", orderType: "market" }] },
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Shortcuts</h1>
          <p className="text-sm text-muted">One-click trading buttons. Every click is previewed and validated by the trading engine before anything executes.</p>
        </div>
        <Button variant="primary" onClick={() => setDraft(blank())}><Plus className="size-4" /> New shortcut</Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <div className="space-y-4">
          <Card title="Folders" icon={<Folder className="size-4 text-accent-2" />}>
            <div className="space-y-1">
              {[{ id: "all", name: "All shortcuts" }, { id: "none", name: "Unfiled" }, ...folders].map((f: any) => (
                <div key={f.id} className={cx("group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm", folder === f.id ? "bg-accent-soft text-text" : "text-muted hover:bg-panel-2")}>
                  <button className="flex-1 text-left" onClick={() => setFolder(f.id)}>{f.name}</button>
                  {f.user_id && <button className="opacity-0 group-hover:opacity-100" title="Delete folder" onClick={async () => { await api("/api/shortcuts/folders", { method: "DELETE", json: { id: f.id } }); if (folder === f.id) setFolder("all"); refresh(); }}><X className="size-3.5" /></button>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-1.5">
              <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFolder()} placeholder="New folder" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg-2 px-2 text-xs outline-none focus:border-accent" />
              <Button size="sm" onClick={addFolder}><FolderPlus className="size-3.5" /></Button>
            </div>
          </Card>
          <Card title="Create from prompt" icon={<Wand2 className="size-4 text-accent-2" />}>
            <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={3} placeholder="e.g. Buy $50 with a 10% take profit" className="w-full rounded-lg border border-line bg-bg-2 p-2 text-sm outline-none focus:border-accent" />
            <Button className="mt-2 w-full" size="sm" loading={busy} onClick={fromPrompt}>Build shortcut</Button>
          </Card>
          <Card title="Quick presets">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => setDraft({ ...blank(), name: p.name, icon: p.icon, color: p.color, actions: p.actions })} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-text">
                  <ShortcutIcon name={p.icon} className="size-3" />{p.name}
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {shown.length === 0 ? (
            <Empty icon={<Zap className="size-6" />} title="No shortcuts yet" action={<Button size="sm" variant="primary" onClick={() => setDraft(blank())}>Create your first shortcut</Button>}>
              Shortcuts appear on the trading terminal and dashboard. Leave the asset empty to apply a shortcut to whatever asset you're viewing.
            </Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((s) => (
                <div key={s.id} className="rounded-2xl border border-line bg-panel/80 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-9 items-center justify-center rounded-xl" style={{ background: `${s.color || "#7c5cff"}22`, color: s.color || "#9b82ff" }}><ShortcutIcon name={s.icon} className="size-4" /></span>
                      <div>
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-xs text-muted">{s.asset_symbol ? s.asset_symbol : "Current asset"}{s.asset_category ? ` · ${s.asset_category}` : ""}</div>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <IconBtn title="Edit" onClick={() => setDraft(toDraft(s))}><Pencil className="size-3.5" /></IconBtn>
                      <IconBtn title="Duplicate" onClick={async () => { await api(`/api/shortcuts/${s.id}`, { method: "POST" }); refresh(); }}><Copy className="size-3.5" /></IconBtn>
                      <IconBtn title="Delete" onClick={async () => { if (confirm(`Delete “${s.name}”?`)) { await api(`/api/shortcuts/${s.id}`, { method: "DELETE" }); refresh(); } }}><Trash2 className="size-3.5" /></IconBtn>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1 text-xs text-muted">
                    {s.actions.map((a: any, i: number) => <li key={i}>• {ACTIONS.find((x) => x.type === a.type)?.label}{a.amount != null ? `: ${a.type.includes("usd") || a.type === "start_recurring_buy" ? "$" : ""}${a.amount}${a.type.includes("pct") ? "%" : ""}` : ""}{a.orderType === "limit" ? ` (limit ${a.limitOffsetPct ?? 0}%)` : ""}</li>)}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.placement.map((p: string) => <Badge key={p}>{p}</Badge>)}
                    {s.require_confirmation ? <Badge tone="accent">confirm</Badge> : <Badge tone="warn">no confirm</Badge>}
                    {s.max_spend_usd && <Badge>max ${s.max_spend_usd}</Badge>}
                    {s.conditions?.length > 0 && <Badge>{s.conditions.length} condition(s)</Badge>}
                    {s.expires_at && <Badge tone={new Date(s.expires_at) < new Date() ? "down" : "neutral"}>expires {new Date(s.expires_at).toLocaleDateString()}</Badge>}
                    <Badge>{s.executions} runs</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Card title="Execution history" icon={<History className="size-4 text-accent-2" />}>
            {(data?.history ?? []).length === 0 ? <p className="text-sm text-muted">No shortcut executions yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-faint"><tr><th className="py-2 pr-3 font-medium">When</th><th className="pr-3 font-medium">Shortcut</th><th className="pr-3 font-medium">Asset</th><th className="pr-3 font-medium">Status</th><th className="font-medium">Result</th></tr></thead>
                  <tbody>
                    {data.history.map((h: any) => (
                      <tr key={h.id} className="border-t border-line">
                        <td className="py-2 pr-3 text-muted">{ago(h.created_at)}</td>
                        <td className="pr-3">{h.shortcut_name}</td>
                        <td className="pr-3">{h.symbol ?? "—"}</td>
                        <td className="pr-3"><StatusPill status={h.status === "executed" ? "filled" : h.status} /></td>
                        <td className="text-xs text-muted">{(h.detail?.results ?? []).map((r: any) => `${r.description}: ${r.message}`).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit shortcut" : "New shortcut"} wide>
        {draft && <Builder draft={draft} setDraft={setDraft} folders={folders} accounts={data?.accounts ?? []} bots={bots.data?.bots ?? []} onSave={save} busy={busy} />}
      </Modal>
    </div>
  );
}

function IconBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className="rounded-lg p-1.5 text-faint hover:bg-panel-2 hover:text-text">{children}</button>;
}

function Builder({ draft, setDraft, folders, accounts, bots, onSave, busy }: { draft: Draft; setDraft: (d: Draft) => void; folders: any[]; accounts: any[]; bots: any[]; onSave: () => void; busy: boolean }) {
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
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
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

      <div className="grid gap-3 sm:grid-cols-3">
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
              <div key={i} className="grid items-end gap-2 rounded-xl border border-line bg-bg-2/50 p-2.5 sm:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_auto]">
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

      <div className="grid gap-3 sm:grid-cols-3">
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
