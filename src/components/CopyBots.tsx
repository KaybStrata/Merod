"use client";
import Link from "next/link";
import { useState } from "react";
import { Copy, Pause, Play, Trash2, Wallet, User, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime, useShell } from "@/components/shell/context";
import { Badge, Button, Card, Empty, Input, Modal, Pills, Select, Toggle, cx, useToast } from "@/components/ui";
import { ago, price, qty, usd, tone } from "@/lib/format";

type Settings = { accountId: string | null; sizing: "fixed" | "percent"; fixedUsd: number; percent: number; maxTradeUsd: number; maxDailyUsd: number; copySells: boolean; includeExternal: boolean; includePaper: boolean };
const DEFAULTS: Settings = { accountId: null, sizing: "fixed", fixedUsd: 50, percent: 10, maxTradeUsd: 250, maxDailyUsd: 1000, copySells: true, includeExternal: true, includePaper: true };

/** Create a copy-trading bot: copy a Merod trader (incl. their outside-Merod broker/exchange trades, with consent) or any public Solana wallet. */
export type CopyPreset = "copy" | "mimic" | "watch";
const PRESET: Record<CopyPreset, Partial<Settings>> = {
  copy: { sizing: "fixed", fixedUsd: 50, copySells: true },
  mimic: { sizing: "percent", percent: 100, maxTradeUsd: 500, copySells: true }, // same size as theirs (within your caps), sells too
  watch: {},
};
export function CopyBotForm({ handle, wallet, preset = "copy", onDone }: { handle?: string; wallet?: string; preset?: CopyPreset; onDone?: () => void }) {
  const toast = useToast();
  const accounts = useApi<any>("/api/wallet/accounts");
  const [kind, setKind] = useState<"user" | "wallet">(wallet ? "wallet" : "user");
  const [who, setWho] = useState(handle ?? wallet ?? "");
  const [s, setS] = useState<Settings>({ ...DEFAULTS, ...PRESET[preset] });
  const watch = preset === "watch";
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const accts = (accounts.data?.accounts ?? []).filter((a: any) => a.status === "active" && a.kind !== "wallet");
  const chosen = accts.find((a: any) => a.id === s.accountId);

  async function create() {
    if (!who.trim()) return toast(kind === "user" ? "Enter the trader's @handle" : "Paste a Solana wallet address", "down");
    setBusy(true);
    try {
      await api("/api/copy", { method: "POST", json: { target: kind === "user" ? { kind, handle: who.trim() } : { kind, network: "solana", address: who.trim() }, settings: s, mode: watch ? "watch" : "copy" } });
      toast(watch ? "Following. You'll be notified of every trade this wallet makes." : "Copy bot is running. New trades will be copied automatically.", "up"); onDone?.();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 text-sm">
      {watch && <p className="text-xs text-muted">Follow this wallet: you'll get a notification for every buy and sell it makes, and see them on the Copy Trading page. Nothing is traded for you. You can switch to Copy or Mimic any time.</p>}
      {watch && <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={create}>Follow wallet</Button></div>}
      {!watch && <>
      {!handle && !wallet && <Pills value={kind} onChange={setKind} options={[{ value: "user", label: <span className="flex items-center gap-1"><User className="size-3.5" /> Merod trader</span> }, { value: "wallet", label: <span className="flex items-center gap-1"><Wallet className="size-3.5" /> Any Solana wallet</span> }]} />}
      {!handle && !wallet && <Input label={kind === "user" ? "Trader's @handle" : "Solana wallet address"} value={who} onChange={(e) => setWho(e.target.value)} placeholder={kind === "user" ? "@trader" : "e.g. 7xKX…"} />}
      <p className="text-[11px] text-muted">{kind === "user"
        ? "Copies the trades they make on Merod, plus the trades they make outside Merod in the Alpaca, Kraken or Coinbase accounts they connected here. They must have turned on “Let others copy my trades”, and they'll be told someone is copying them."
        : <>Copies the swaps this public wallet makes on Solana (any app, not just Merod). Wallet activity is public, so no permission is needed. Needs a Helius API key: paste one on <Link href="/broker-keys" className="text-accent-2">Broker &amp; AI Keys</Link>.</>}</p>

      <Select label="Copy into account" value={s.accountId ?? ""} onChange={(e) => set("accountId", e.target.value || null)}>
        <option value="">Paper account (practice money)</option>
        {accts.filter((a: any) => a.kind !== "paper").map((a: any) => <option key={a.id} value={a.id}>{a.label} (real money)</option>)}
      </Select>
      {chosen && chosen.kind !== "paper" && <p className="flex gap-1.5 text-[11px] text-warn"><AlertTriangle className="size-3.5 shrink-0" /> Real money. Copies only go through when live trading and “automated real money” are switched on in Admin → Compliance &amp; flags, and every copy still passes your risk limits.</p>}

      <div>
        <div className="mb-1 text-xs text-muted">Copy size per trade</div>
        <Pills size="sm" value={s.sizing} onChange={(v) => set("sizing", v)} options={[{ value: "fixed", label: "Fixed $ amount" }, { value: "percent", label: "% of their trade" }]} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          {s.sizing === "fixed" ? <Input label="$ per buy" type="number" min={1} value={s.fixedUsd} onChange={(e) => set("fixedUsd", Number(e.target.value))} />
            : <Input label="% of their trade size" type="number" min={0.1} value={s.percent} onChange={(e) => set("percent", Number(e.target.value))} />}
          <Input label="Max $ per trade" type="number" min={1} value={s.maxTradeUsd} onChange={(e) => set("maxTradeUsd", Number(e.target.value))} />
          <Input label="Max $ per day" type="number" min={1} value={s.maxDailyUsd} onChange={(e) => set("maxDailyUsd", Number(e.target.value))} />
        </div>
      </div>
      <div className="space-y-2">
        <Toggle checked={s.copySells} onChange={(v) => set("copySells", v)} label="Copy their sells too (sells the same share of your position)" />
        {kind === "user" && <Toggle checked={s.includeExternal} onChange={(v) => set("includeExternal", v)} label="Include trades they make outside Merod (connected accounts)" />}
        {kind === "user" && <Toggle checked={s.includePaper} onChange={(v) => set("includePaper", v)} label="Include their paper (practice) trades" />}
      </div>
      <p className="text-[11px] text-faint">Only trades made after you start are copied. Copies are market orders, so your price can differ from theirs. Past results don't guarantee future results.</p>
      {preset === "mimic" && <p className="text-[11px] text-accent-2">Mimic: matches the size of each of their trades (up to your per-trade and daily caps) and mirrors their sells.</p>}
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={create}><Copy className="size-4" /> {preset === "mimic" ? "Start mimicking" : "Start copy bot"}</Button></div>
      </>}
    </div>
  );
}

/** "Copy trade" button for the page header: opens the copy-bot form (owner only). */
export function CopyTradeHeaderButton() {
  const { user } = useShell();
  const [open, setOpen] = useState(false);
  if (user.role !== "super_admin") return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}><Copy className="size-4" /> Copy trade</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New copy-trading bot"><CopyBotForm onDone={() => setOpen(false)} /></Modal>
    </>
  );
}

/** Follow / Copy / Mimic buttons for an identified trader (Merod handle or public wallet). */
export function TraderActions({ handle, wallet, copyable = true, following, onFollow }: { handle?: string; wallet?: string; copyable?: boolean; following?: boolean; onFollow?: () => void }) {
  const { user } = useShell();
  const [open, setOpen] = useState<CopyPreset | null>(null);
  const owner = user.role === "super_admin";
  const who = handle ? `@${handle}` : wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "";
  const btn = "rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <span className="flex shrink-0 items-center gap-1">
      {handle ? <button className={btn} onClick={onFollow}>{following ? "Following" : "Follow"}</button>
        : owner && <button className={btn} onClick={() => setOpen("watch")}>Follow</button>}
      {owner && <button className={btn} disabled={!copyable} title={copyable ? "Copy with a fixed $ amount per trade" : "This trader hasn't allowed copy trading"} onClick={() => setOpen("copy")}>Copy</button>}
      {owner && <button className={btn} disabled={!copyable} title={copyable ? "Match their trade sizes and sells" : "This trader hasn't allowed copy trading"} onClick={() => setOpen("mimic")}>Mimic</button>}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open === "watch" ? `Follow ${who}` : open === "mimic" ? `Mimic ${who}` : `Copy ${who}`}>
        {open && <CopyBotForm handle={handle} wallet={wallet} preset={open} onDone={() => setOpen(null)} />}
      </Modal>
    </span>
  );
}

/** "Copy trade" button for a trader's profile (super admin). */
export function CopyTradeButton({ handle, allowed }: { handle: string; allowed: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={!allowed} title={allowed ? "Automatically copy this trader's trades" : "This trader hasn't allowed copy trading"}><Copy className="size-4" /> Copy trade</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Copy @${handle}`}><CopyBotForm handle={handle} onDone={() => setOpen(false)} /></Modal>
    </>
  );
}

/** List + manage copy bots and see every copied trade. */
export function CopyBotsPanel({ compact = false, variant = "copy" }: { compact?: boolean; variant?: "copy" | "mimic" }) {
  const { data, refresh } = useApi<any>("/api/copy", { refreshMs: 10000 });
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  useRealtime((e) => { if (e.type === "copy") refresh(); });
  const isMimic = (f: any) => f.mode !== "watch" && f.sizing === "percent" && Number(f.percent) >= 100;
  const all: any[] = data?.follows ?? [];
  const follows: any[] = variant === "mimic" ? all.filter(isMimic) : all;
  const ids = new Set(follows.map((f) => f.id));
  const events: any[] = (data?.events ?? []).filter((e: any) => variant !== "mimic" || ids.has(e.follow_id));

  async function patch(id: string, body: any) {
    try { await api(`/api/copy/${id}`, { method: "PATCH", json: body }); refresh(); } catch (e: any) { toast(e.message, "down"); }
  }
  async function remove(id: string, label: string) {
    if (!confirm(`Stop and delete the copy bot for ${label}? Positions it opened stay in your account.`)) return;
    try { await api(`/api/copy/${id}`, { method: "DELETE" }); refresh(); } catch (e: any) { toast(e.message, "down"); }
  }

  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-2">{variant === "mimic" ? "Mimic bots" : "Copy-trading bots"} <Badge tone="accent">{follows.filter((f) => f.status === "active").length} running</Badge></span>} icon={<Copy className="size-4 text-accent-2" />}
        action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Copy className="size-3.5" /> {variant === "mimic" ? "New mimic bot" : "New copy bot"}</Button>}>
        {!data ? <div className="text-xs text-muted">Loading…</div> : follows.length === 0 ? (
          <Empty icon={<Copy className="size-6" />} title={variant === "mimic" ? "No mimic bots yet" : "No copy bots yet"}>{variant === "mimic"
            ? "Mimic a trader or public Solana wallet: every trade they make is repeated at the same size (within your caps), sells included."
            : "Copy a Merod trader (including their trades outside Merod, with their permission) or any public Solana wallet."}</Empty>
        ) : (
          <div className="space-y-2">
            {follows.map((f) => (
              <div key={f.id} className="rounded-xl border border-line bg-panel-2/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {f.kind === "wallet" ? <Wallet className="size-4 text-muted" /> : <User className="size-4 text-muted" />}
                    {f.kind === "user" ? <Link href={`/social/${f.leader_handle}`} className="truncate font-medium hover:text-accent-2">{f.label}</Link> : <span className="truncate font-mono text-sm">{f.label}</span>}
                    <Badge tone={f.status === "active" ? "up" : "neutral"}>{f.status === "active" ? (f.mode === "watch" ? "following" : "running") : "paused"}</Badge>
                    {f.mode === "watch" ? <Badge tone="info">notify only</Badge> : f.sizing === "percent" && Number(f.percent) >= 100 ? <Badge tone="accent">mimic</Badge> : null}
                    {f.kind === "user" && f.leader_allows === false && <Badge tone="warn">trader turned copying off</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => patch(f.id, { status: f.status === "active" ? "paused" : "active" })} className="rounded-lg p-1.5 text-muted hover:text-text" title={f.status === "active" ? "Pause" : "Resume"}>{f.status === "active" ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
                    <button onClick={() => remove(f.id, f.label)} className="rounded-lg p-1.5 text-muted hover:text-down" title="Delete"><Trash2 className="size-4" /></button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
                  {f.mode !== "watch" && <span>{f.sizing === "fixed" ? `${usd(f.fixed_usd)} per buy` : `${Number(f.percent)}% of their size`} · max {usd(f.max_trade_usd)}/trade · {usd(f.spent_today)} of {usd(f.max_daily_usd)} today</span>}
                  {f.mode !== "watch" && <span>Into: {f.account_label ?? "Paper account"}</span>}
                  <span>{f.copied} copied · {f.skipped} skipped</span>
                  <span>{f.kind === "user" ? [f.include_external && "incl. outside-Merod trades", f.include_paper && "incl. paper", f.copy_sells ? "copies sells" : "buys only"].filter(Boolean).join(" · ") : f.copy_sells ? "copies sells" : "buys only"}</span>
                  {f.last_checked_at && <span>checked {ago(f.last_checked_at)}</span>}
                </div>
                {f.last_error && <p className="mt-1 text-[11px] text-warn">{f.last_error}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {!compact && (
        <Card title="Copied trades" icon={<Clock className="size-4 text-accent-2" />}>
          {events.length === 0 ? <div className="text-xs text-muted">Trades will appear here as soon as the people you copy make them.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[11px] text-faint"><tr><th className="py-1.5 pr-2 font-medium">When</th><th className="pr-2 font-medium">Copied from</th><th className="pr-2 font-medium">Their trade</th><th className="pr-2 font-medium">Where</th><th className="pr-2 font-medium">Your copy</th><th className="font-medium">Result</th></tr></thead>
                <tbody className="divide-y divide-line/60">
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="py-1.5 pr-2 text-faint">{ago(e.created_at)}</td>
                      <td className="pr-2">{e.label}</td>
                      <td className="pr-2"><span className={e.side === "buy" ? "text-up" : "text-down"}>{e.side.toUpperCase()}</span> {e.symbol ?? "?"} <span className="text-faint">{e.leader_qty ? qty(e.leader_qty) : ""}{e.leader_price ? ` @ ${price(e.leader_price)}` : ""}</span></td>
                      <td className="pr-2 text-muted">{e.venue}</td>
                      <td className="pr-2">{e.copy_notional ? usd(e.copy_notional) : e.side === "sell" ? "matching share" : "—"}</td>
                      <td>{e.status === "copied" ? <span className="flex items-center gap-1 text-up"><CheckCircle2 className="size-3.5" /> Copied</span>
                        : e.status === "pending_approval" ? <Link href="/portfolio?tab=orders" className="flex items-center gap-1 text-warn"><Clock className="size-3.5" /> Needs approval</Link>
                        : e.status === "watched" ? <span className="text-muted">Followed (not traded)</span>
                        : <span className={cx("flex items-center gap-1", e.status === "failed" ? "text-down" : "text-muted")} title={e.reason ?? ""}><XCircle className="size-3.5" /> {e.status === "failed" ? "Failed" : "Skipped"}: {e.reason}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!compact && (data?.leaders ?? []).length > 0 && (
        <Card title="Traders you can copy" icon={<User className="size-4 text-accent-2" />}>
          <ul className="divide-y divide-line">
            {data.leaders.map((l: any) => (
              <li key={l.handle} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/social/${l.handle}`} className="min-w-0 truncate hover:text-accent-2">{l.display_name} <span className="text-faint">@{l.handle}</span></Link>
                <span className="flex items-center gap-3 text-xs"><span className={cx("num", tone(l.pnl_30d))}>{usd(l.pnl_30d, { sign: true })} 30d</span><span className="text-faint">{l.trades_30d} trades</span>
                  <TraderActions handle={l.handle} copyable /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={variant === "mimic" ? "New mimic bot" : "New copy-trading bot"}><CopyBotForm preset={variant === "mimic" ? "mimic" : "copy"} onDone={() => { setCreating(false); refresh(); }} /></Modal>
    </div>
  );
}
