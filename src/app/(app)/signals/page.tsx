"use client";
import { useState } from "react";
import { Webhook, Copy, Trash2, Pause, Play, KeyRound } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle } from "@/components/shell/context";
import { MimicTabs } from "@/components/MimicTabs";
import { cx, Empty, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

const money = (n: any) => `$${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const STATUS: Record<string, string> = { filled: "text-up", submitted: "text-up", pending_approval: "text-warn", ignored: "text-muted", rejected: "text-down", failed: "text-down" };

/** Signal bots: connect Freqtrade, TradingView, Hummingbot / Jesse / OctoBot scripts (or anything that can POST) to Merod. */
export default function SignalBotsPage() {
  usePageTitle({ section: "Automate · Signal bots", title: "Connect outside trading bots", accent: "outside" });
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/signals/keys", { refreshMs: 15_000 });
  const reload = () => { void refresh(); };
  const [name, setName] = useState("Freqtrade");
  const [perTrade, setPerTrade] = useState("100");
  const [maxOrder, setMaxOrder] = useState("");
  const [maxDaily, setMaxDaily] = useState("");
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const hook = (key: string) => `${origin}/api/signals/hook?key=${key}`;
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast("Copied", "up")).catch(() => {}); };

  async function create() {
    setBusy(true);
    try {
      const r = await api("/api/signals/keys", { method: "POST", json: { name: name.trim() || "Signal bot", perTradeUsd: Number(perTrade) || 100, maxOrderUsd: Number(maxOrder) || 0, maxDailyUsd: Number(maxDaily) || 0 } });
      setFresh({ key: r.key, name: r.signalKey.name });
      reload();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  async function patch(id: string, body: any) {
    try { await api(`/api/signals/keys/${id}`, { method: "PATCH", json: body }); reload(); } catch (e: any) { toast(e.message, "down"); }
  }
  async function remove(id: string, n: string) {
    if (!confirm(`Delete "${n}"? Its URL stops working immediately.`)) return;
    try { await api(`/api/signals/keys/${id}`, { method: "DELETE" }); reload(); } catch (e: any) { toast(e.message, "down"); }
  }

  const keys: any[] = data?.keys ?? [], events: any[] = data?.events ?? [], accounts: any[] = data?.accounts ?? [];
  const sampleKey = fresh?.key ?? "msk_YOUR_KEY";
  return (
    <div className="space-y-4">
      <MimicTabs />
      <section className="surface rounded-2xl p-4">
        <div className="flex items-center gap-2 text-[14px] font-semibold"><Webhook className="size-4 text-accent" />New signal bot</div>
        <p className="mt-1 text-[12.5px] text-muted">Each bot gets its own URL. When it sends a buy or sell, Merod places the order through its normal risk checks. Paper money by default.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          <label className="text-[11px] text-muted sm:col-span-2">Name<input className="mt-1 w-full rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" value={name} onChange={(e) => setName(e.target.value)} placeholder="Freqtrade, TradingView…" /></label>
          <label className="text-[11px] text-muted">$ per buy (if the bot doesn&apos;t say)<input className="mt-1 w-full rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" inputMode="decimal" value={perTrade} onChange={(e) => setPerTrade(e.target.value)} /></label>
          <label className="text-[11px] text-muted">Max $ per order (0 = no limit)<input className="mt-1 w-full rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" inputMode="decimal" value={maxOrder} onChange={(e) => setMaxOrder(e.target.value)} placeholder="0" /></label>
          <label className="text-[11px] text-muted">Max $ per day (0 = no limit)<input className="mt-1 w-full rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" inputMode="decimal" value={maxDaily} onChange={(e) => setMaxDaily(e.target.value)} placeholder="0" /></label>
        </div>
        <button className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-grad px-3 py-1.5 text-[12.5px] font-semibold text-bg disabled:opacity-50" disabled={busy} onClick={create}><KeyRound className="size-4" />{busy ? "Creating…" : "Create signal URL"}</button>
        {fresh && (
          <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3 text-[12.5px]">
            <div className="font-semibold">“{fresh.name}” is ready. Copy this URL now: the key is shown only once.</div>
            <div className="mt-2 flex items-center gap-2"><code className="num min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1">{hook(fresh.key)}</code><button className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-text" onClick={() => copy(hook(fresh.key))}><Copy className="size-3.5" />Copy</button></div>
          </div>
        )}
      </section>

      <section className="surface rounded-2xl p-4">
        <div className="text-[14px] font-semibold">Your signal bots</div>
        {!keys.length ? <Empty icon={<Webhook className="size-6" />} title="No signal bots yet">Create one above, then paste its URL into your bot.</Empty> : (
          <div className="mt-2 divide-y divide-line">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-[12.5px]">
                <span className={cx("size-2 rounded-full", k.enabled ? "bg-up" : "bg-faint")} />
                <div className="min-w-40">
                  <div className="font-semibold">{k.name}</div>
                  <div className="text-[11px] text-faint">{k.key_prefix}… · {k.last_used_at ? `last signal ${ago(k.last_used_at)}` : "no signals yet"} · {k.signals_24h} today, {k.filled_24h} filled</div>
                  {k.last_error && <div className="text-[11px] text-down">⚠ {k.last_error}</div>}
                </div>
                <label className="text-[11px] text-muted">$/buy <input className="ml-1 w-20 rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" defaultValue={Number(k.per_trade_usd)} onBlur={(e) => Number(e.target.value) >= 1 && Number(e.target.value) !== Number(k.per_trade_usd) && patch(k.id, { perTradeUsd: Number(e.target.value) })} /></label>
                <label className="text-[11px] text-muted">max/order <input className="ml-1 w-20 rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" defaultValue={Number(k.max_order_usd)} onBlur={(e) => Number(e.target.value) !== Number(k.max_order_usd) && patch(k.id, { maxOrderUsd: Number(e.target.value) || 0 })} /></label>
                <label className="text-[11px] text-muted">max/day <input className="ml-1 w-20 rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" defaultValue={Number(k.max_daily_usd)} onBlur={(e) => Number(e.target.value) !== Number(k.max_daily_usd) && patch(k.id, { maxDailyUsd: Number(e.target.value) || 0 })} /></label>
                <select className="rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent/60" value={k.account_id ?? ""} onChange={(e) => patch(k.id, { accountId: e.target.value || null })}>
                  <option value="">Paper account</option>
                  {accounts.filter((a) => a.kind !== "paper").map((a) => <option key={a.id} value={a.id}>{a.name} (real money)</option>)}
                </select>
                {k.account_kind && k.account_kind !== "paper" && (
                  <label className="flex items-center gap-1 text-[11px] text-warn"><input type="checkbox" checked={k.allow_live} onChange={(e) => patch(k.id, { allowLive: e.target.checked })} />Allow real money</label>
                )}
                <div className="ml-auto flex gap-1.5">
                  <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-text" onClick={() => patch(k.id, { enabled: !k.enabled })}>{k.enabled ? <><Pause className="size-3.5" />Turn off</> : <><Play className="size-3.5" />Turn on</>}</button>
                  <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-text" onClick={() => remove(k.id, k.name)} aria-label="Delete"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface rounded-2xl p-4">
        <div className="text-[14px] font-semibold">Recent signals</div>
        {!events.length ? <p className="mt-1 text-[12.5px] text-muted">Nothing received yet.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10.5px] uppercase text-faint"><tr><th className="py-1">When</th><th>Bot</th><th>Action</th><th>Coin/stock</th><th>Size</th><th>Result</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="py-1.5 text-faint">{ago(e.created_at)}</td><td>{e.name}</td>
                    <td className={e.action === "buy" ? "text-up" : e.action === "sell" ? "text-down" : "text-muted"}>{e.action ?? "—"}</td>
                    <td>{e.symbol ?? "—"}</td><td className="num">{e.notional ? money(e.notional) : "—"}</td>
                    <td><span className={STATUS[e.status] ?? ""}>{String(e.status).replace("_", " ")}</span>{e.reason && <span className="text-faint"> · {e.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SetupGuides url={hook(sampleKey)} copy={copy} />
    </div>
  );
}

function Snippet({ title, note, code, copy }: { title: string; note: string; code: string; copy: (t: string) => void }) {
  return (
    <details className="rounded-xl border border-line p-3">
      <summary className="cursor-pointer text-[13px] font-semibold">{title}</summary>
      <p className="mt-2 text-[12px] text-muted">{note}</p>
      <div className="relative mt-2">
        <pre className="num overflow-x-auto rounded-lg bg-black/40 p-3 text-[11.5px] leading-relaxed">{code}</pre>
        <button className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-line bg-bg-2 px-2 py-1 text-[11px] text-muted hover:text-text" onClick={() => copy(code)}><Copy className="size-3.5" />Copy</button>
      </div>
    </details>
  );
}

function SetupGuides({ url, copy }: { url: string; copy: (t: string) => void }) {
  const freqtrade = `"webhook": {
  "enabled": true,
  "url": "${url}",
  "format": "json",
  "retries": 2,
  "entry": { "action": "buy", "pair": "{pair}", "amount_usd": "{stake_amount}", "id": "{trade_id}" },
  "exit":  { "action": "sell", "pair": "{pair}", "id": "{trade_id}" }
}`;
  const tradingview = `{"action": "{{strategy.order.action}}", "ticker": "{{ticker}}", "amount_usd": 50}`;
  const python = `import requests

MEROD = "${url}"

def merod_signal(action, symbol, usd=None, percent=None):
    """action: "buy" or "sell"; symbol: "BTC", "BTC/USDT", "SOL-USD"…"""
    body = {"action": action, "symbol": symbol}
    if usd: body["amount_usd"] = usd
    if percent: body["percent"] = percent      # sells: % of the position (default 100)
    r = requests.post(MEROD, json=body, timeout=10)
    print("Merod:", r.json())

# Jesse:      call merod_signal("buy", self.symbol, 50) in go_long(), merod_signal("sell", self.symbol) when closing
# Hummingbot: call it from your script's did_fill_order() / on_tick() in a scripts/*.py strategy
# OctoBot:    call it from a custom tentacle, or use OctoBot's TradingView/webhook alerts pointed at this URL`;
  const curl = `curl -X POST "${url}" -H "content-type: application/json" -d '{"action":"buy","pair":"BTC/USDT","amount_usd":25}'`;
  return (
    <section className="surface space-y-2 rounded-2xl p-4">
      <div className="text-[14px] font-semibold">How to hook up each program</div>
      <p className="text-[12px] text-muted">Merod accepts JSON with <code>action</code> (buy/sell), a coin or stock (<code>pair</code>, <code>symbol</code> or <code>ticker</code>, or a token <code>address</code> + <code>chain</code>), and optionally <code>amount_usd</code>, <code>quantity</code> or <code>percent</code>. Plain text like <code>buy BTC 50</code> works too. Repeats of the same signal never double-order.</p>
      <Snippet title="Freqtrade (no code changes)" note="Paste into your Freqtrade config.json (replace any existing webhook block) and restart the bot. Use dry_run: true in Freqtrade if you only want Merod to trade." code={freqtrade} copy={copy} />
      <Snippet title="TradingView alerts" note="Create an alert → Notifications → Webhook URL: paste your Merod URL. Put this in the alert Message box." code={tradingview} copy={copy} />
      <Snippet title="Jesse, Hummingbot, OctoBot or any Python bot" note="Drop this helper into your strategy and call it wherever the bot opens or closes a trade." code={python} copy={copy} />
      <Snippet title="Test it with curl" note="Places a small paper buy so you can see it arrive in Recent signals." code={curl} copy={copy} />
    </section>
  );
}
